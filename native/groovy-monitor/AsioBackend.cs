// ASIO, through NAudio's driver wrapper.
//
// This is the path that actually reaches "play through it" latency, and it
// needs the interface's own driver installed (on a Scarlett, Focusrite Control
// 2) — the Microsoft class driver has no ASIO at all. The browser meanwhile
// keeps its WDM streams on the same device; whether the vendor driver allows
// both at once is the thing to verify first, see NATIVE-BRIDGE-BRIEF.md.
//
// One callback does everything: read the selected input channel, hand a copy
// to the input tap, run the amp, mix in any booked voices, write both output
// channels. Nothing here allocates once running.
//
// Every input channel is opened, not just one, so the web app can move the tap
// between them (the bass on input 1, the Loopback channel for a measurement)
// without reopening the driver.

using System.Reflection;
using NAudio.Wave;
using NAudio.Wave.Asio;

namespace GroovyMonitor;

public sealed class AsioBackend : IBackend
{
    readonly AsioOut asio;
    readonly Amp amp;
    readonly float[] mono;
    readonly int inputCount;
    long xruns;
    long frame;
    volatile int inChannel;

    public BackendInfo Info { get; }
    public LoopbackProbe Probe { get; }
    public long Xruns => Interlocked.Read(ref xruns);

    public bool SupportsEngine => true;
    public InputTap Tap { get; }
    InputTap? IBackend.Tap => Tap;
    public VoiceBank Voices { get; } = new();
    VoiceBank? IBackend.Voices => Voices;
    public string[] InputChannelNames { get; }
    public int InputChannel
    {
        get => inChannel;
        set { if (value >= 0 && value < inputCount) inChannel = value; }
    }

    public static string[] Drivers()
    {
        try { return AsioOut.GetDriverNames(); } catch { return Array.Empty<string>(); }
    }

    public AsioBackend(string? driverMatch, int inChannel, int outChannel, int sampleRate, Func<int, Amp> ampFactory)
    {
        var names = Drivers();
        if (names.Length == 0) throw new InvalidOperationException("No ASIO driver is registered on this machine.");
        // Focusrite registers a Thunderbolt driver and a USB driver whether or
        // not either interface is plugged in; with no name given, prefer USB.
        string name = string.IsNullOrWhiteSpace(driverMatch)
            ? names.FirstOrDefault(n => n.Contains("USB", StringComparison.OrdinalIgnoreCase)) ?? names[0]
            : names.FirstOrDefault(n => n.Contains(driverMatch, StringComparison.OrdinalIgnoreCase))
              ?? throw new InvalidOperationException($"No ASIO driver matches \"{driverMatch}\". Have: {string.Join(", ", names)}");

        asio = new AsioOut(name)
        {
            InputChannelOffset = 0,
            ChannelOffset = outChannel,
        };
        if (!asio.IsSampleRateSupported(sampleRate))
            throw new InvalidOperationException($"{name} does not support {sampleRate} Hz.");
        inputCount = Math.Max(1, asio.DriverInputChannelCount);
        if (inChannel >= inputCount)
            throw new InvalidOperationException($"Input channel {inChannel + 1} requested but {name} has {inputCount}.");
        this.inChannel = inChannel;
        InputChannelNames = Enumerable.Range(0, inputCount).Select(i =>
        {
            try { return asio.AsioInputChannelName(i); } catch { return $"Input {i + 1}"; }
        }).ToArray();

        // The provider only tells NAudio the output format; we write the
        // buffers ourselves in the callback and flag them as written.
        var fmt = WaveFormat.CreateIeeeFloatWaveFormat(sampleRate, 2);
        asio.InitRecordAndPlayback(new SilenceProvider(fmt), inputCount, sampleRate);
        asio.AudioAvailable += OnAudio;

        amp = ampFactory(sampleRate);
        Probe = new LoopbackProbe(sampleRate);
        mono = new float[Math.Max(asio.FramesPerBuffer, 64) * 4];
        Tap = new InputTap(sampleRate);

        double perMs = 1000.0 * asio.FramesPerBuffer / sampleRate;
        double outMs = 1000.0 * asio.PlaybackLatency / sampleRate;
        int? inFrames = DriverInputLatency(asio);
        // Drivers normally report both; if the input figure cannot be read,
        // the input is the same buffer depth plus a converter, so assume
        // symmetry rather than 0.
        double inMs = inFrames is int f ? 1000.0 * f / sampleRate : outMs;
        Info = new BackendInfo(
            "asio", name, sampleRate, asio.FramesPerBuffer,
            inMs, outMs,
            inMs + outMs,
            $"driver buffer {asio.FramesPerBuffer} frames ({perMs:F1} ms); {inputCount} inputs, out ch {outChannel + 1}-{outChannel + 2}"
            + (inFrames == null ? "; input latency assumed equal to output" : ""));
    }

    // NAudio reads the driver's input latency into its capabilities but only
    // exposes the output half. It sits on a private field; read it there, and
    // fall back quietly if a future NAudio moves it.
    static int? DriverInputLatency(AsioOut o)
    {
        try
        {
            var ext = typeof(AsioOut).GetField("driver", BindingFlags.NonPublic | BindingFlags.Instance)?.GetValue(o) as AsioDriverExt;
            if (ext == null) return null;
            ext.Driver.GetLatencies(out int input, out _);
            return input > 0 ? input : null;
        }
        catch { return null; }
    }

    unsafe void OnAudio(object? sender, AsioAudioAvailableEventArgs e)
    {
        int n = e.SamplesPerBuffer;
        if (n > mono.Length) { Interlocked.Increment(ref xruns); n = mono.Length; }
        var span = mono.AsSpan(0, n);
        long f0 = frame;

        int ch = inChannel;
        ReadInput(e.InputBuffers[ch < e.InputBuffers.Length ? ch : 0], e.AsioSampleType, span);
        // Input and output blocks of this callback carry the same frame
        // numbers; the browser relies on it.
        Tap.Push(span, f0);
        fixed (float* p = span) Probe.CaptureHook(p, n, 1, 0, System.Diagnostics.Stopwatch.GetTimestamp());
        amp.Process(span);
        Probe.RenderHook(span);
        Voices.Mix(span, f0);
        for (int c = 0; c < e.OutputBuffers.Length && c < 2; c++)
            WriteOutput(e.OutputBuffers[c], e.AsioSampleType, span);
        e.WrittenToOutputBuffers = true;
        frame = f0 + n;
    }

    static unsafe void ReadInput(IntPtr buf, AsioSampleType type, Span<float> dst)
    {
        switch (type)
        {
            case AsioSampleType.Float32LSB: { float* p = (float*)buf; for (int i = 0; i < dst.Length; i++) dst[i] = p[i]; break; }
            case AsioSampleType.Int32LSB: { int* p = (int*)buf; for (int i = 0; i < dst.Length; i++) dst[i] = p[i] / 2147483648f; break; }
            case AsioSampleType.Int16LSB: { short* p = (short*)buf; for (int i = 0; i < dst.Length; i++) dst[i] = p[i] / 32768f; break; }
            case AsioSampleType.Int24LSB:
            {
                byte* p = (byte*)buf;
                for (int i = 0; i < dst.Length; i++)
                {
                    int v = (p[i * 3] << 8) | (p[i * 3 + 1] << 16) | (p[i * 3 + 2] << 24);
                    dst[i] = v / 2147483648f;
                }
                break;
            }
            default: throw new NotSupportedException($"ASIO sample type {type} is not handled.");
        }
    }

    static unsafe void WriteOutput(IntPtr buf, AsioSampleType type, ReadOnlySpan<float> src)
    {
        switch (type)
        {
            case AsioSampleType.Float32LSB: { float* p = (float*)buf; for (int i = 0; i < src.Length; i++) p[i] = src[i]; break; }
            case AsioSampleType.Int32LSB:
            {
                int* p = (int*)buf;
                for (int i = 0; i < src.Length; i++) p[i] = (int)(Clip(src[i]) * 2147483647f);
                break;
            }
            case AsioSampleType.Int16LSB:
            {
                short* p = (short*)buf;
                for (int i = 0; i < src.Length; i++) p[i] = (short)(Clip(src[i]) * 32767f);
                break;
            }
            case AsioSampleType.Int24LSB:
            {
                byte* p = (byte*)buf;
                for (int i = 0; i < src.Length; i++)
                {
                    int v = (int)(Clip(src[i]) * 8388607f);
                    p[i * 3] = (byte)v; p[i * 3 + 1] = (byte)(v >> 8); p[i * 3 + 2] = (byte)(v >> 16);
                }
                break;
            }
            default: throw new NotSupportedException($"ASIO sample type {type} is not handled.");
        }
    }

    static float Clip(float v) => v > 1f ? 1f : v < -1f ? -1f : v;

    public void Start() => asio.Play();
    public void Stop() { try { asio.Stop(); } catch { } }

    public void Dispose()
    {
        Stop();
        asio.AudioAvailable -= OnAudio;
        asio.Dispose();
    }
}
