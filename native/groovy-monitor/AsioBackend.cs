// ASIO, through NAudio's driver wrapper.
//
// This is the path that actually reaches "play through it" latency, and it
// needs the interface's own driver installed (on a Scarlett, Focusrite Control
// 2) — the Microsoft class driver has no ASIO at all. The browser meanwhile
// keeps its WDM streams on the same device; whether the vendor driver allows
// both at once is the thing to verify first, see NATIVE-BRIDGE-BRIEF.md.
//
// One callback does everything: read our input channel, run the amp, write
// both output channels. Nothing here allocates once running.

using NAudio.Wave;
using NAudio.Wave.Asio;

namespace GroovyMonitor;

public sealed class AsioBackend : IBackend
{
    readonly AsioOut asio;
    readonly Amp amp;
    readonly float[] mono;
    long xruns;

    public BackendInfo Info { get; }
    public LoopbackProbe Probe { get; }
    public long Xruns => Interlocked.Read(ref xruns);

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
            InputChannelOffset = inChannel,
            ChannelOffset = outChannel,
        };
        if (!asio.IsSampleRateSupported(sampleRate))
            throw new InvalidOperationException($"{name} does not support {sampleRate} Hz.");

        // The provider only tells NAudio the output format; we write the
        // buffers ourselves in the callback and flag them as written.
        var fmt = WaveFormat.CreateIeeeFloatWaveFormat(sampleRate, 2);
        asio.InitRecordAndPlayback(new SilenceProvider(fmt), 1, sampleRate);
        asio.AudioAvailable += OnAudio;

        amp = ampFactory(sampleRate);
        Probe = new LoopbackProbe(sampleRate);
        mono = new float[Math.Max(asio.FramesPerBuffer, 64) * 4];

        double perMs = 1000.0 * asio.FramesPerBuffer / sampleRate;
        double outMs = 1000.0 * asio.PlaybackLatency / sampleRate;
        Info = new BackendInfo(
            "asio", name, sampleRate, asio.FramesPerBuffer,
            // Drivers report output latency; input is normally the same buffer
            // depth plus the converter, so assume symmetry rather than 0.
            outMs, outMs,
            2 * outMs + 1.0,
            $"driver buffer {asio.FramesPerBuffer} frames ({perMs:F1} ms); in ch {inChannel + 1}, out ch {outChannel + 1}-{outChannel + 2}");
    }

    unsafe void OnAudio(object? sender, AsioAudioAvailableEventArgs e)
    {
        int n = e.SamplesPerBuffer;
        if (n > mono.Length) { Interlocked.Increment(ref xruns); n = mono.Length; }
        var span = mono.AsSpan(0, n);

        ReadInput(e.InputBuffers[0], e.AsioSampleType, span);
        fixed (float* p = span) Probe.CaptureHook(p, n, 1, 0, System.Diagnostics.Stopwatch.GetTimestamp());
        amp.Process(span);
        Probe.RenderHook(span);
        for (int c = 0; c < e.OutputBuffers.Length && c < 2; c++)
            WriteOutput(e.OutputBuffers[c], e.AsioSampleType, span);
        e.WrittenToOutputBuffers = true;
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
