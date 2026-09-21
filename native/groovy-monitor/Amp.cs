// The amp, ported stage for stage from src/lib/groovy/amp.js so the two sound
// alike:
//
//   in → gain → rumble HPF → [compressor, in or out] → clean ∥ drive
//      → bass / mid / treble → cabinet LPF → presence → level → monitor
//
// Mono in, one sample at a time, no allocation on the audio thread. Every
// gain-like control is smoothed so a slider drag never clicks; the filter
// coefficients are recomputed on the audio thread whenever a new parameter
// set arrives, which is cheap enough not to matter.

using System.Runtime.CompilerServices;

namespace GroovyMonitor;

/// <summary>Immutable snapshot of the knobs. The control thread builds a new one
/// and swaps the reference; the audio thread picks it up at the next block.</summary>
public sealed record AmpParams(
    float Gain = 1f,       // 0…2
    float Drive = 0f,      // 0…1
    float Compress = 0f,   // 0…1
    float Bass = 0f,       // dB, −12…12
    float Mid = 0f,
    float Treble = 0f,
    float Level = 0.8f,    // 0…1.6
    bool Monitor = false)
{
    public static float Clamp(float v, float lo, float hi) => v < lo ? lo : v > hi ? hi : v;

    public AmpParams Sanitised() => new(
        Clamp(Gain, 0f, 2f), Clamp(Drive, 0f, 1f), Clamp(Compress, 0f, 1f),
        Clamp(Bass, -12f, 12f), Clamp(Mid, -12f, 12f), Clamp(Treble, -12f, 12f),
        Clamp(Level, 0f, 1.6f), Monitor);
}

/// <summary>Audio EQ Cookbook biquad, transposed direct form II.</summary>
public sealed class Biquad
{
    float b0 = 1, b1, b2, a1, a2, z1, z2;

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public float Process(float x)
    {
        float y = b0 * x + z1;
        z1 = b1 * x - a1 * y + z2;
        z2 = b2 * x - a2 * y;
        return y;
    }

    void Set(double B0, double B1, double B2, double A0, double A1, double A2)
    {
        b0 = (float)(B0 / A0); b1 = (float)(B1 / A0); b2 = (float)(B2 / A0);
        a1 = (float)(A1 / A0); a2 = (float)(A2 / A0);
    }

    public void LowPass(double fs, double f0, double q)
    {
        double w = 2 * Math.PI * f0 / fs, c = Math.Cos(w), a = Math.Sin(w) / (2 * q);
        Set((1 - c) / 2, 1 - c, (1 - c) / 2, 1 + a, -2 * c, 1 - a);
    }

    public void HighPass(double fs, double f0, double q)
    {
        double w = 2 * Math.PI * f0 / fs, c = Math.Cos(w), a = Math.Sin(w) / (2 * q);
        Set((1 + c) / 2, -(1 + c), (1 + c) / 2, 1 + a, -2 * c, 1 - a);
    }

    public void Peaking(double fs, double f0, double q, double gainDb)
    {
        double A = Math.Pow(10, gainDb / 40);
        double w = 2 * Math.PI * f0 / fs, c = Math.Cos(w), a = Math.Sin(w) / (2 * q);
        Set(1 + a * A, -2 * c, 1 - a * A, 1 + a / A, -2 * c, 1 - a / A);
    }

    // Shelves use the Web Audio convention: S = 1 (the gentlest slope that stays
    // monotonic), which is what the browser's BiquadFilterNode does.
    public void LowShelf(double fs, double f0, double gainDb)
    {
        double A = Math.Pow(10, gainDb / 40);
        double w = 2 * Math.PI * f0 / fs, c = Math.Cos(w), s = Math.Sin(w);
        double a = s / 2 * Math.Sqrt((A + 1 / A) * (1 / 1.0 - 1) + 2);
        double k = 2 * Math.Sqrt(A) * a;
        Set(A * ((A + 1) - (A - 1) * c + k), 2 * A * ((A - 1) - (A + 1) * c), A * ((A + 1) - (A - 1) * c - k),
            (A + 1) + (A - 1) * c + k, -2 * ((A - 1) + (A + 1) * c), (A + 1) + (A - 1) * c - k);
    }

    public void HighShelf(double fs, double f0, double gainDb)
    {
        double A = Math.Pow(10, gainDb / 40);
        double w = 2 * Math.PI * f0 / fs, c = Math.Cos(w), s = Math.Sin(w);
        double a = s / 2 * Math.Sqrt((A + 1 / A) * (1 / 1.0 - 1) + 2);
        double k = 2 * Math.Sqrt(A) * a;
        Set(A * ((A + 1) + (A - 1) * c + k), -2 * A * ((A - 1) + (A + 1) * c), A * ((A + 1) + (A - 1) * c - k),
            (A + 1) - (A - 1) * c + k, 2 * ((A - 1) - (A + 1) * c), (A + 1) - (A - 1) * c - k);
    }
}

/// <summary>One-pole smoother: setTargetAtTime, in effect.</summary>
public struct Smooth
{
    public float Value, Target, Coef;
    public Smooth(float v, double tauSec, double fs)
    {
        Value = Target = v;
        Coef = (float)(1 - Math.Exp(-1 / (tauSec * fs)));
    }
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public float Next()
    {
        Value += (Target - Value) * Coef;
        return Value;
    }
}

/// <summary>Feed-forward compressor with the same knobs the browser exposes.
/// No look-ahead, on purpose: the whole point of this process is latency.</summary>
public sealed class Compressor
{
    readonly float attackCoef, releaseCoef;
    float thresholdDb, slope, kneeDb = 12f, makeupDb, envDb;

    public Compressor(double fs)
    {
        attackCoef = (float)(1 - Math.Exp(-1 / (0.008 * fs)));
        releaseCoef = (float)(1 - Math.Exp(-1 / (0.160 * fs)));
        Configure(0f, 1f);
    }

    public void Configure(float thresholdDb, float ratio)
    {
        this.thresholdDb = thresholdDb;
        slope = 1f / MathF.Max(1f, ratio) - 1f; // dB of reduction per dB over
        // Automatic makeup, as Blink does it: measure the reduction at 0 dBFS
        // and put back a bit more than half of it (the 0.6 power).
        makeupDb = -GainDb(0f) * 0.6f;
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    float GainDb(float inDb)
    {
        float over = inDb - thresholdDb;
        if (over <= 0f) return 0f;
        if (over < kneeDb) return slope * over * over / (2f * kneeDb);
        return slope * (over - kneeDb / 2f);
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public float Process(float x)
    {
        float a = x < 0 ? -x : x;
        float inDb = 20f * MathF.Log10(a + 1e-7f);
        float g = GainDb(inDb);
        envDb += (g - envDb) * (g < envDb ? attackCoef : releaseCoef);
        return x * MathF.Pow(10f, (envDb + makeupDb) / 20f);
    }
}

public sealed class Amp
{
    readonly double fs;
    readonly Biquad rumble = new(), bass = new(), mid = new(), treble = new(), cab = new(), presence = new();
    readonly Compressor comp;

    Smooth gain, preDrive, wet, dry, level, monitor, compIn;
    float driveK = 1f, driveNorm = (float)Math.Tanh(1);
    int driveStep = -1;
    AmpParams applied;
    volatile AmpParams pending;

    // Meters, written by the audio thread and read by anyone.
    public float InPeak, InRms, OutPeak;
    float peakAcc, sqAcc, outPeakAcc; int meterN;

    // The test tone: a quarter second of A2 from this process's own output,
    // after the monitor gain so it sounds whether or not the amp is unmuted.
    // Hearing it is proof the native path reaches the speakers.
    volatile int toneLeft;
    int toneTotal;
    double tonePhase;

    public void TriggerTest()
    {
        toneTotal = (int)(fs * 0.25);
        toneLeft = toneTotal;
    }

    public Amp(double sampleRate, AmpParams initial)
    {
        fs = sampleRate;
        comp = new Compressor(fs);
        rumble.HighPass(fs, 32, 0.7);
        cab.LowPass(fs, 4500, 0.6);
        presence.Peaking(fs, 2200, 1.1, 2);
        gain = new Smooth(1f, 0.02, fs);
        preDrive = new Smooth(1f, 0.02, fs);
        wet = new Smooth(0f, 0.02, fs);
        dry = new Smooth(1f, 0.02, fs);
        level = new Smooth(0.8f, 0.02, fs);
        monitor = new Smooth(0f, 0.03, fs);
        compIn = new Smooth(0f, 0.02, fs);
        applied = pending = initial.Sanitised();
        Apply(applied, true);
    }

    public AmpParams Current => pending;

    /// <summary>Called from any thread. Takes effect at the next block.</summary>
    public void Set(AmpParams p) => pending = p.Sanitised();

    void Apply(AmpParams p, bool force)
    {
        gain.Target = p.Gain;
        level.Target = p.Level;
        monitor.Target = p.Monitor ? 1f : 0f;

        float d = p.Drive;
        int step = (int)MathF.Round(d * 8f);
        if (step != driveStep || force)
        {
            driveStep = step;
            driveK = 1f + (step / 8f) * 24f;
            driveNorm = MathF.Tanh(driveK);
        }
        preDrive.Target = 1f + d * 6f;
        wet.Target = d;
        dry.Target = 1f - d * 0.55f;

        // In or out, never a blend — see amp.js for why. The amount lives in
        // the curve, and the curve is flat at the bottom of the slider.
        float c = p.Compress;
        compIn.Target = c > 0f ? 1f : 0f;
        comp.Configure(-c * 32f, 1f + c * 6.5f);

        if (force || p.Bass != applied.Bass) bass.LowShelf(fs, 110, p.Bass);
        if (force || p.Mid != applied.Mid) mid.Peaking(fs, 700, 0.8, p.Mid);
        if (force || p.Treble != applied.Treble) treble.HighShelf(fs, 2800, p.Treble);
        applied = p;
    }

    /// <summary>Process one block in place. Call once per callback; parameters
    /// are picked up at the top.</summary>
    public void Process(Span<float> buf)
    {
        var p = pending;
        if (!ReferenceEquals(p, applied)) Apply(p, false);

        for (int i = 0; i < buf.Length; i++)
        {
            float x = buf[i];
            float ax = x < 0 ? -x : x;
            if (ax > peakAcc) peakAcc = ax;
            sqAcc += x * x;

            x = rumble.Process(x * gain.Next());

            float ci = compIn.Next();
            if (ci > 0.0005f) x = x * (1f - ci) + comp.Process(x) * ci;

            float driven = MathF.Tanh(driveK * x * preDrive.Next()) / driveNorm;
            x = x * dry.Next() + driven * wet.Next();

            x = treble.Process(mid.Process(bass.Process(x)));
            x = presence.Process(cab.Process(x));
            x *= level.Next();

            float ox = x < 0 ? -x : x;
            if (ox > outPeakAcc) outPeakAcc = ox;

            float y = x * monitor.Next();

            if (toneLeft > 0)
            {
                int done = toneTotal - toneLeft;
                float env = MathF.Min(1f, MathF.Min(done / (0.005f * (float)fs), toneLeft / (0.03f * (float)fs)));
                y += 0.25f * env * (float)Math.Sin(tonePhase);
                tonePhase += 2 * Math.PI * 220 / fs;
                if (tonePhase > 2 * Math.PI) tonePhase -= 2 * Math.PI;
                toneLeft--;
            }

            buf[i] = y;
        }
        meterN += buf.Length;
        if (meterN >= fs / 20)
        {
            InPeak = peakAcc;
            InRms = MathF.Sqrt(sqAcc / meterN);
            OutPeak = outPeakAcc;
            peakAcc = sqAcc = outPeakAcc = 0; meterN = 0;
        }
    }
}
