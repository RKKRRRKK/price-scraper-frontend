// What a backend has to provide, and the numbers the control server reports.

namespace GroovyMonitor;

public sealed record BackendInfo(
    string Backend,          // "asio" | "wasapi"
    string Device,
    int SampleRate,
    int BufferFrames,        // one callback / period, in frames
    double InputLatencyMs,   // as the driver or engine reports it
    double OutputLatencyMs,
    double RoundTripMs,      // our best estimate of in → out through this process
    string Note = "");

public interface IBackend : IDisposable
{
    BackendInfo Info { get; }
    LoopbackProbe Probe { get; }
    /// <summary>Buffer underruns or overruns since start.</summary>
    long Xruns { get; }
    void Start();
    void Stop();
}

/// <summary>Single-producer / single-consumer float ring for the WASAPI path,
/// where capture and render are two event-driven threads.</summary>
public sealed class FloatRing
{
    readonly float[] buf;
    long write, read;

    public FloatRing(int capacity) { buf = new float[capacity]; }
    public int Capacity => buf.Length;
    public int Available => (int)(Volatile.Read(ref write) - Volatile.Read(ref read));

    public void Push(float v)
    {
        long w = write;
        buf[(int)(w % buf.Length)] = v;
        Volatile.Write(ref write, w + 1);
    }

    /// <summary>Drops the oldest samples so at most <paramref name="keep"/> remain.</summary>
    public void TrimTo(int keep)
    {
        long w = Volatile.Read(ref write);
        long r = Volatile.Read(ref read);
        if (w - r > keep) Volatile.Write(ref read, w - keep);
    }

    public bool TryPop(out float v)
    {
        long r = read;
        if (r >= Volatile.Read(ref write)) { v = 0; return false; }
        v = buf[(int)(r % buf.Length)];
        Volatile.Write(ref read, r + 1);
        return true;
    }
}

/// <summary>
/// Round-trip measurement through this process, the same idea as the web app's
/// loopback test: emit a pulse on the output, catch it on the input, time the
/// gap. Needs the output physically looped to the input (a cable, or the
/// interface's loopback channel). Both hooks run on audio threads; nothing here
/// allocates.
/// </summary>
public sealed class LoopbackProbe
{
    const int Pulses = 6;
    const float Gate = 0.06f;
    readonly double fs;
    readonly double[] results = new double[Pulses];
    int want, got, failed;
    volatile bool armed;
    long tWrite, tArmedTicks, cooldownUntil;
    int pulseLeft;
    double phase;
    static readonly double TickMs = 1000.0 / System.Diagnostics.Stopwatch.Frequency;

    public LoopbackProbe(double sampleRate) { fs = sampleRate; }

    public bool Running => Volatile.Read(ref want) > 0;

    /// <summary>Start a run. Results arrive through <see cref="TryTakeResult"/>.</summary>
    public void Request()
    {
        got = 0; failed = 0; armed = false;
        cooldownUntil = System.Diagnostics.Stopwatch.GetTimestamp();
        Volatile.Write(ref want, Pulses);
    }

    /// <summary>Called by the render side after the amp, once per block. Adds the
    /// pulse when one is due and stamps the moment it entered the buffer.</summary>
    public void RenderHook(Span<float> buf)
    {
        if (Volatile.Read(ref want) == 0) return;
        long now = System.Diagnostics.Stopwatch.GetTimestamp();
        if (!armed && pulseLeft == 0 && now >= cooldownUntil && got + failed < Pulses)
        {
            pulseLeft = (int)(fs * 0.004);   // 4 ms of 1 kHz, a sharp edge
            phase = 0;
            tWrite = now;
            tArmedTicks = now;
            armed = true;
        }
        if (pulseLeft > 0)
        {
            for (int i = 0; i < buf.Length && pulseLeft > 0; i++, pulseLeft--)
            {
                buf[i] += 0.5f * (float)Math.Sin(phase);
                phase += 2 * Math.PI * 1000 / fs;
            }
        }
        // Nothing back within a second: count the miss and move on.
        if (armed && (now - tArmedTicks) * TickMs > 1000)
        {
            armed = false;
            failed++;
            cooldownUntil = now + (long)(200 / TickMs);
            if (got + failed >= Pulses) Finish();
        }
    }

    /// <summary>Called by the capture side with each packet, before the samples
    /// go anywhere else. <paramref name="tPacket"/> is when the packet was read.</summary>
    public unsafe void CaptureHook(float* samples, int frames, int stride, int channel, long tPacket)
    {
        if (!armed) return;
        for (int i = 0; i < frames; i++)
        {
            float v = samples[i * stride + channel];
            if (v > Gate || v < -Gate)
            {
                // The packet was read after its last sample arrived; the onset
                // sits (frames - i) samples before that.
                double tDetect = tPacket * TickMs - (frames - i) * 1000.0 / fs;
                double ms = tDetect - tWrite * TickMs;
                armed = false;
                if (ms > 0 && got < Pulses) results[got++] = ms;
                else failed++;
                cooldownUntil = tPacket + (long)(250 / TickMs);
                if (got + failed >= Pulses) Finish();
                return;
            }
        }
    }

    // ── Results ───────────────────────────────────────────────────────────
    volatile int ready;
    double resultMs, resultJitter;
    int resultN;

    void Finish()
    {
        Volatile.Write(ref want, 0);
        int n = got;
        if (n >= 3)
        {
            var a = results.AsSpan(0, n).ToArray();
            Array.Sort(a);
            double med = n % 2 == 1 ? a[n / 2] : (a[n / 2 - 1] + a[n / 2]) / 2;
            double sq = 0; foreach (var x in a) sq += (x - med) * (x - med);
            resultMs = med; resultJitter = Math.Sqrt(sq / (n - 1)); resultN = n;
        }
        else { resultMs = 0; resultJitter = 0; resultN = n; }
        Volatile.Write(ref ready, 1);
    }

    public bool TryTakeResult(out double ms, out double jitterMs, out int n, out int misses)
    {
        ms = resultMs; jitterMs = resultJitter; n = resultN; misses = failed;
        return Interlocked.Exchange(ref ready, 0) == 1;
    }
}

internal static class Mmcss
{
    [System.Runtime.InteropServices.DllImport("avrt.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode)]
    static extern IntPtr AvSetMmThreadCharacteristicsW(string taskName, ref uint taskIndex);

    /// <summary>Ask the scheduler for Pro Audio priority on the calling thread.</summary>
    public static void ProAudio()
    {
        try { uint idx = 0; AvSetMmThreadCharacteristicsW("Pro Audio", ref idx); }
        catch { /* not fatal; we just run at normal priority */ }
    }
}
