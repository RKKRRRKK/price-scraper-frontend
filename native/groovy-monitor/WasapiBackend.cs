// WASAPI, shared mode, at the smallest engine period the driver allows.
//
// This is the path for a machine on Microsoft's USB Audio 2.0 class driver
// (no ASIO). It is written against IAudioClient3 directly because that is the
// interface that exposes low-latency shared mode — IAudioClient only ever gets
// the default 10 ms period, and NAudio wraps IAudioClient. Shared mode is what
// lets the browser keep its own streams on the same interface: exclusive mode
// would give smaller buffers still, and take the device away from Groovy.
//
// Two event-driven threads, one per endpoint, joined by a ring buffer that is
// kept as close to one period deep as it will go. Latency through here is
// roughly capture period + ring + render period, three periods in all.

using System.Runtime.InteropServices;
using NAudio.CoreAudioApi;

namespace GroovyMonitor;

public sealed class WasapiBackend : IBackend
{
    const int CLSCTX_ALL = 23;
    const uint AUDCLNT_STREAMFLAGS_EVENTCALLBACK = 0x00040000;
    const uint AUDCLNT_BUFFERFLAGS_SILENT = 0x2;
    const int AUDCLNT_E_ENGINE_PERIODICITY_LOCKED = unchecked((int)0x88890019);

    readonly Amp amp;
    readonly int inChannel;
    IAudioClient3 capClient = null!, renClient = null!;
    IAudioCaptureClient capture = null!;
    IAudioRenderClient render = null!;
    AutoResetEvent capEvent = new(false), renEvent = new(false);
    int capChannels, renChannels, sampleRate, periodFrames;
    uint capBufFrames, renBufFrames;
    FloatRing ring = null!;
    float[] block = Array.Empty<float>();
    Thread? capThread, renThread;
    volatile bool running;
    long xruns, startedAt;

    // The first callbacks after Start() are the two streams finding their
    // spacing, not dropouts; only count from here on.
    void CountXrun()
    {
        if (Environment.TickCount64 - startedAt > 250) Interlocked.Increment(ref xruns);
    }

    public BackendInfo Info { get; private set; } = null!;
    public LoopbackProbe Probe { get; private set; } = null!;
    public long Xruns => Interlocked.Read(ref xruns);

    public WasapiBackend(string? deviceMatch, int inChannel, Amp? ampFactoryResult, Func<int, Amp> ampFactory)
    {
        this.inChannel = inChannel;
        var (capDev, renDev) = PickDevices(deviceMatch);

        capClient = Activate(capDev);
        renClient = Activate(renDev);

        // Both endpoints run at the engine's mix rate; the two are the same
        // device, so they agree. If they do not, refuse — a resampler here is
        // exactly the latency we came to avoid.
        var capFmt = MixFormat(capClient, out capChannels, out int capRate);
        var renFmt = MixFormat(renClient, out renChannels, out int renRate);
        if (capRate != renRate)
            throw new InvalidOperationException($"Capture runs at {capRate} Hz and render at {renRate} Hz. Set both to the same rate in Windows sound settings.");
        sampleRate = capRate;
        if (inChannel >= capChannels)
            throw new InvalidOperationException($"Input channel {inChannel + 1} requested but the capture endpoint has {capChannels}.");

        // Ask for the smallest shared-mode period on each side. If another
        // stream (the browser, say) already holds the engine at a different
        // period we are told so, and take the period in force instead.
        uint capPeriod = InitLowLatency(capClient, capFmt, out string capNote);
        uint renPeriod = InitLowLatency(renClient, renFmt, out string renNote);
        periodFrames = (int)Math.Max(capPeriod, renPeriod);

        capClient.SetEventHandle(capEvent.SafeWaitHandle.DangerousGetHandle());
        renClient.SetEventHandle(renEvent.SafeWaitHandle.DangerousGetHandle());
        capClient.GetBufferSize(out capBufFrames);
        renClient.GetBufferSize(out renBufFrames);

        var iidCap = typeof(IAudioCaptureClient).GUID;
        Check(capClient.GetService(ref iidCap, out object capSvc), "GetService(capture)");
        capture = (IAudioCaptureClient)capSvc;
        var iidRen = typeof(IAudioRenderClient).GUID;
        Check(renClient.GetService(ref iidRen, out object renSvc), "GetService(render)");
        render = (IAudioRenderClient)renSvc;

        Marshal.FreeCoTaskMem(capFmt);
        Marshal.FreeCoTaskMem(renFmt);

        ring = new FloatRing(Math.Max(4096, periodFrames * 16));
        block = new float[Math.Max(renBufFrames, 512)];
        amp = ampFactory(sampleRate);
        Probe = new LoopbackProbe(sampleRate);

        capClient.GetStreamLatency(out long capLat);
        renClient.GetStreamLatency(out long renLat);
        double perMs = 1000.0 * periodFrames / sampleRate;
        double inMs = Math.Max(perMs, capLat / 10000.0);
        double outMs = Math.Max(perMs, renLat / 10000.0);
        string note = string.Join(" ", new[] { capNote, renNote }.Where(s => s.Length > 0));
        Info = new BackendInfo(
            "wasapi", $"{capDev.FriendlyName} → {renDev.FriendlyName}", sampleRate, periodFrames,
            inMs, outMs,
            // capture period + one to two periods in the ring + about a period
            // queued for the DAC, plus converters and USB, which nobody
            // reports. Measure it — this is a guess with a name.
            inMs + perMs * 1.5 + outMs + 4.0,
            (note.Length > 0 ? note + " " : "") + $"shared mode, periods {capPeriod}/{renPeriod} frames, buffers {capBufFrames}/{renBufFrames}");
    }

    // ── Device selection ──────────────────────────────────────────────────
    static (MMDevice cap, MMDevice ren) PickDevices(string? match)
    {
        using var en = new MMDeviceEnumerator();
        MMDevice? cap = null, ren = null;
        if (!string.IsNullOrWhiteSpace(match))
        {
            foreach (var d in en.EnumerateAudioEndPoints(DataFlow.All, DeviceState.Active))
            {
                if (!d.FriendlyName.Contains(match, StringComparison.OrdinalIgnoreCase)) continue;
                if (d.DataFlow == DataFlow.Capture) cap ??= d;
                else if (d.DataFlow == DataFlow.Render) ren ??= d;
            }
            if (cap == null || ren == null)
                throw new InvalidOperationException($"No active {(cap == null ? "capture" : "render")} endpoint matches \"{match}\". Run --list.");
        }
        cap ??= en.GetDefaultAudioEndpoint(DataFlow.Capture, Role.Console);
        ren ??= en.GetDefaultAudioEndpoint(DataFlow.Render, Role.Console);
        return (cap, ren);
    }

    static readonly Guid ClsidEnumerator = new("BCDE0395-E52F-467C-8E3D-C4579291692E");

    static IAudioClient3 Activate(MMDevice dev)
    {
        // Created by CLSID and cast to the interface, not `new`-ed through a
        // coclass: NAudio has usually already wrapped this same COM object, and
        // the runtime hands back its wrapper, which a coclass cast rejects.
        var en = (IMMDeviceEnumerator)Activator.CreateInstance(Type.GetTypeFromCLSID(ClsidEnumerator)!)!;
        Check(en.GetDevice(dev.ID, out IMMDevice d), "GetDevice");
        var iid = typeof(IAudioClient3).GUID;
        Check(d.Activate(ref iid, CLSCTX_ALL, IntPtr.Zero, out object o), "Activate(IAudioClient3)");
        return (IAudioClient3)o;
    }

    static IntPtr MixFormat(IAudioClient3 c, out int channels, out int rate)
    {
        Check(c.GetMixFormat(out IntPtr fmt), "GetMixFormat");
        var wf = Marshal.PtrToStructure<WaveFormatExtensible>(fmt);
        channels = wf.nChannels;
        rate = (int)wf.nSamplesPerSec;
        bool isFloat = wf.wFormatTag == 3 || (wf.wFormatTag == 0xFFFE && wf.SubFormat == KsFloat);
        if (!isFloat || wf.wBitsPerSample != 32)
            throw new InvalidOperationException("The shared-mode mix format is not 32-bit float, which this build assumes.");
        return fmt;
    }

    static uint InitLowLatency(IAudioClient3 c, IntPtr fmt, out string note)
    {
        note = "";
        Check(c.GetSharedModeEnginePeriod(fmt, out uint def, out uint fund, out uint min, out uint max), "GetSharedModeEnginePeriod");
        uint want = min;
        int hr = c.InitializeSharedAudioStream(AUDCLNT_STREAMFLAGS_EVENTCALLBACK, want, fmt, IntPtr.Zero);
        if (hr == AUDCLNT_E_ENGINE_PERIODICITY_LOCKED)
        {
            Check(c.GetCurrentSharedModeEnginePeriod(out IntPtr cur, out uint inForce), "GetCurrentSharedModeEnginePeriod");
            Marshal.FreeCoTaskMem(cur);
            note = $"engine period locked at {inForce} frames by another stream (wanted {min});";
            want = inForce;
            hr = c.InitializeSharedAudioStream(AUDCLNT_STREAMFLAGS_EVENTCALLBACK, want, fmt, IntPtr.Zero);
        }
        Check(hr, $"InitializeSharedAudioStream({want} frames; driver offers {min}…{max}, default {def})");
        return want;
    }

    // ── Running ───────────────────────────────────────────────────────────
    public void Start()
    {
        if (running) return;
        running = true;
        startedAt = Environment.TickCount64;
        capThread = new Thread(CaptureLoop) { IsBackground = true, Priority = ThreadPriority.Highest, Name = "wasapi-capture" };
        renThread = new Thread(RenderLoop) { IsBackground = true, Priority = ThreadPriority.Highest, Name = "wasapi-render" };
        Check(capClient.Start(), "capture Start");
        capThread.Start();
        // Let the ring reach one period before the render side starts pulling,
        // or the first callbacks are all underruns.
        var t0 = Environment.TickCount64;
        while (ring.Available < periodFrames && Environment.TickCount64 - t0 < 500) Thread.Sleep(1);
        // One period of silence in the render buffer before it starts, so the
        // first event asks for one period rather than the whole buffer — which
        // the ring could not have supplied, and which would have been latency
        // for the rest of the run had it been.
        uint pre = Math.Min(renBufFrames, (uint)periodFrames);
        if (render.GetBuffer(pre, out IntPtr silence) >= 0)
        {
            unsafe { new Span<float>((void*)silence, (int)(pre * renChannels)).Clear(); }
            render.ReleaseBuffer(pre, 0);
        }
        // Whatever piled up while the render side was being readied is startup
        // alignment, not a dropout: trim it and start the count from zero.
        ring.TrimTo(periodFrames);
        startedAt = Environment.TickCount64;
        Check(renClient.Start(), "render Start");
        renThread.Start();
    }

    public void Stop()
    {
        if (!running) return;
        running = false;
        capEvent.Set(); renEvent.Set();
        capThread?.Join(500); renThread?.Join(500);
        try { capClient.Stop(); } catch { }
        try { renClient.Stop(); } catch { }
    }

    unsafe void CaptureLoop()
    {
        Mmcss.ProAudio();
        while (running)
        {
            if (!capEvent.WaitOne(200)) continue;
            while (running)
            {
                if (capture.GetNextPacketSize(out uint packet) < 0 || packet == 0) break;
                if (capture.GetBuffer(out IntPtr data, out uint frames, out uint flags, out _, out _) < 0) break;
                long tPacket = System.Diagnostics.Stopwatch.GetTimestamp();
                bool silent = (flags & AUDCLNT_BUFFERFLAGS_SILENT) != 0;
                float* p = (float*)data;
                int stride = capChannels;
                if (!silent) Probe.CaptureHook(p, (int)frames, stride, inChannel, tPacket);
                for (uint i = 0; i < frames; i++)
                    ring.Push(silent ? 0f : p[i * stride + inChannel]);
                capture.ReleaseBuffer(frames);
            }
            // Never let the ring grow: if the render side stalled, the extra
            // samples are latency, and latency is the one thing we are here to
            // not have. Two periods is the ceiling.
            if (ring.Available > periodFrames * 2)
            {
                ring.TrimTo(periodFrames);
                CountXrun();
            }
        }
    }

    unsafe void RenderLoop()
    {
        Mmcss.ProAudio();
        while (running)
        {
            if (!renEvent.WaitOne(200)) continue;
            if (renClient.GetCurrentPadding(out uint padding) < 0) continue;
            uint frames = renBufFrames - padding;
            if (frames == 0) continue;
            // One period per event, not "fill the buffer". The buffer is two
            // periods deep and filling it keeps a whole extra period queued in
            // front of the DAC — 7 ms of latency for nothing. Writing a period
            // at a time leaves the queue hovering around one period, which is
            // enough to cover a late wake-up and no more.
            if (frames > periodFrames) frames = (uint)periodFrames;
            if (frames > block.Length) frames = (uint)block.Length;

            var span = block.AsSpan(0, (int)frames);
            bool under = false;
            for (int i = 0; i < span.Length; i++)
            {
                if (!ring.TryPop(out span[i])) { span[i] = 0f; under = true; }
            }
            if (under) CountXrun();

            amp.Process(span);
            Probe.RenderHook(span);

            if (render.GetBuffer(frames, out IntPtr data) < 0) continue;
            float* p = (float*)data;
            int ch = renChannels;
            for (int i = 0; i < span.Length; i++)
            {
                float v = span[i];
                for (int c = 0; c < ch; c++) p[i * ch + c] = c < 2 ? v : 0f;
            }
            render.ReleaseBuffer(frames, 0);
        }
    }

    public void Dispose()
    {
        Stop();
        capEvent.Dispose(); renEvent.Dispose();
    }

    static void Check(int hr, string what)
    {
        if (hr < 0) throw new COMException($"{what} failed: 0x{hr:X8}", hr);
    }

    // ── COM plumbing ──────────────────────────────────────────────────────
    static readonly Guid KsFloat = new("00000003-0000-0010-8000-00aa00389b71");

    [StructLayout(LayoutKind.Sequential, Pack = 2)]
    struct WaveFormatExtensible
    {
        public ushort wFormatTag;
        public ushort nChannels;
        public uint nSamplesPerSec;
        public uint nAvgBytesPerSec;
        public ushort nBlockAlign;
        public ushort wBitsPerSample;
        public ushort cbSize;
        public ushort wValidBitsPerSample;
        public uint dwChannelMask;
        public Guid SubFormat;
    }

    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceEnumerator
    {
        [PreserveSig] int EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr devices);
        [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
        [PreserveSig] int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice device);
        [PreserveSig] int RegisterEndpointNotificationCallback(IntPtr client);
        [PreserveSig] int UnregisterEndpointNotificationCallback(IntPtr client);
    }

    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDevice
    {
        [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
        [PreserveSig] int OpenPropertyStore(int access, out IntPtr props);
        [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
        [PreserveSig] int GetState(out int state);
    }

    // IAudioClient3 with its two base interfaces flattened in vtable order —
    // .NET's COM interop does not inherit slots from base interfaces.
    [ComImport, Guid("7ED4EE07-8E67-4CD4-8C1A-2B7A5987AD42"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioClient3
    {
        // IAudioClient
        [PreserveSig] int Initialize(int shareMode, uint streamFlags, long bufferDuration, long periodicity, IntPtr format, IntPtr sessionGuid);
        [PreserveSig] int GetBufferSize(out uint frames);
        [PreserveSig] int GetStreamLatency(out long latency);
        [PreserveSig] int GetCurrentPadding(out uint padding);
        [PreserveSig] int IsFormatSupported(int shareMode, IntPtr format, out IntPtr closest);
        [PreserveSig] int GetMixFormat(out IntPtr format);
        [PreserveSig] int GetDevicePeriod(out long defaultPeriod, out long minPeriod);
        [PreserveSig] int Start();
        [PreserveSig] int Stop();
        [PreserveSig] int Reset();
        [PreserveSig] int SetEventHandle(IntPtr handle);
        [PreserveSig] int GetService(ref Guid iid, [MarshalAs(UnmanagedType.IUnknown)] out object service);
        // IAudioClient2
        [PreserveSig] int IsOffloadCapable(int category, out int capable);
        [PreserveSig] int SetClientProperties(IntPtr props);
        [PreserveSig] int GetBufferSizeLimits(IntPtr format, int eventDriven, out long min, out long max);
        // IAudioClient3
        [PreserveSig] int GetSharedModeEnginePeriod(IntPtr format, out uint defaultPeriod, out uint fundamental, out uint min, out uint max);
        [PreserveSig] int GetCurrentSharedModeEnginePeriod(out IntPtr format, out uint currentPeriod);
        [PreserveSig] int InitializeSharedAudioStream(uint streamFlags, uint periodInFrames, IntPtr format, IntPtr sessionGuid);
    }

    [ComImport, Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioCaptureClient
    {
        [PreserveSig] int GetBuffer(out IntPtr data, out uint frames, out uint flags, out ulong devicePosition, out ulong qpcPosition);
        [PreserveSig] int ReleaseBuffer(uint frames);
        [PreserveSig] int GetNextPacketSize(out uint frames);
    }

    [ComImport, Guid("F294ACFC-3146-4483-A7BF-ADDCA7C260E2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioRenderClient
    {
        [PreserveSig] int GetBuffer(uint frames, out IntPtr data);
        [PreserveSig] int ReleaseBuffer(uint frames, uint flags);
    }

    /// <summary>For --list: every active endpoint with its shared-mode period range.</summary>
    public static IEnumerable<string> Describe()
    {
        using var en = new MMDeviceEnumerator();
        foreach (var d in en.EnumerateAudioEndPoints(DataFlow.All, DeviceState.Active))
        {
            string periods;
            try
            {
                var c = Activate(d);
                IntPtr fmt = MixFormat(c, out int ch, out int rate);
                c.GetSharedModeEnginePeriod(fmt, out uint def, out _, out uint min, out uint max);
                Marshal.FreeCoTaskMem(fmt);
                periods = $"{rate} Hz, {ch} ch, period min {min} / default {def} / max {max} frames ({1000.0 * min / rate:F1} ms min)";
            }
            catch (Exception e) { periods = "(" + e.Message + ")"; }
            yield return $"  [{(d.DataFlow == DataFlow.Capture ? "in " : "out")}] {d.FriendlyName}: {periods}";
        }
    }
}
