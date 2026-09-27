// The control surface: a WebSocket on 127.0.0.1 that the web app's amp panel
// talks to. No HttpListener — that needs a URL reservation to run unelevated —
// so the HTTP upgrade is parsed by hand and the socket is then handed to
// .NET's own WebSocket implementation.
//
// Protocol, all JSON text frames:
//   → {"type":"params", gain?, drive?, compress?, bass?, mid?, treble?, level?, monitor?}
//   → {"type":"ping"}
//   → {"type":"test"}      play a short tone from this process's output
//   → {"type":"loopback"}  measure out → in through this process (needs a
//                          cable or loopback channel); answered by
//   ← {"type":"loopback", ok, ms, jitterMs, n, misses}
//   ← {"type":"hello", backend, device, sampleRate, bufferFrames,
//        inputLatencyMs, outputLatencyMs, roundTripMs, note, version, params,
//        engine, inputChannels: [names], inputChannel}
//   ← {"type":"status", inRms, inPeak, outPeak, xruns, late, dropped}   ~10×/s
//   ← {"type":"pong"}
//
// Engine mode (only when hello says engine: true; see VoiceBank.cs):
//   → {"type":"input", channel}      move the input tap, 0-based; answered by
//   ← {"type":"input", channel}
//   → {"type":"stream", on}          start or stop streaming the input
//   ← binary: [int64 LE startFrame][float32 LE × n]   the input, as captured
//   → binary: [int32 LE voiceId][float32 LE × n]      upload a voice
//   → {"type":"play", v, f, g}       voice v starts on frame f at gain g
//
// Origins are checked: only the app's own hosts (and localhost for dev) may
// drive the amp, because any page in the browser could otherwise open this
// socket. A client with no Origin header (not a browser) is allowed.

using System.Net;
using System.Net.Sockets;
using System.Net.WebSockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace GroovyMonitor;

public sealed class ControlServer
{
    public const string Version = "0.2";
    readonly Amp amp;
    readonly IBackend backend;
    readonly HashSet<string> hosts;
    readonly TcpListener listener;
    readonly CancellationTokenSource cts = new();
    int clients;

    public int Port { get; }
    public int Clients => Volatile.Read(ref clients);
    public event Action<string>? Log;

    public ControlServer(int port, Amp amp, IBackend backend, IEnumerable<string> allowedHosts)
    {
        this.amp = amp;
        this.backend = backend;
        hosts = new HashSet<string>(allowedHosts, StringComparer.OrdinalIgnoreCase);
        listener = new TcpListener(IPAddress.Loopback, port);
        listener.Start();
        Port = ((IPEndPoint)listener.LocalEndpoint).Port;
        _ = AcceptLoop();
    }

    public void Stop() { cts.Cancel(); try { listener.Stop(); } catch { } }

    async Task AcceptLoop()
    {
        while (!cts.IsCancellationRequested)
        {
            TcpClient tcp;
            try { tcp = await listener.AcceptTcpClientAsync(cts.Token); }
            catch { break; }
            _ = Serve(tcp);
        }
    }

    async Task Serve(TcpClient tcp)
    {
        using (tcp)
        {
            tcp.NoDelay = true;
            var stream = tcp.GetStream();
            var headers = await ReadRequest(stream);
            if (headers == null) return;

            if (!headers.TryGetValue("upgrade", out var up) || !up.Equals("websocket", StringComparison.OrdinalIgnoreCase)
                || !headers.TryGetValue("sec-websocket-key", out var key))
            {
                await Reply(stream, "426 Upgrade Required", "text/plain", $"groovy-monitor {Version}: this port speaks WebSocket.\n");
                return;
            }
            if (headers.TryGetValue("origin", out var origin) && !OriginAllowed(origin))
            {
                Log?.Invoke($"refused origin {origin}");
                await Reply(stream, "403 Forbidden", "text/plain", "origin not allowed\n");
                return;
            }

            string accept = Convert.ToBase64String(SHA1.HashData(Encoding.ASCII.GetBytes(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")));
            var resp = Encoding.ASCII.GetBytes(
                "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
                $"Sec-WebSocket-Accept: {accept}\r\n\r\n");
            await stream.WriteAsync(resp);

            using var ws = WebSocket.CreateFromStream(stream, new WebSocketCreationOptions { IsServer = true, KeepAliveInterval = TimeSpan.FromSeconds(20) });
            Interlocked.Increment(ref clients);
            Log?.Invoke($"client connected ({origin ?? "no origin"})");
            try { await Session(ws); }
            catch (Exception e) when (e is WebSocketException or IOException or OperationCanceledException) { }
            finally
            {
                Interlocked.Decrement(ref clients);
                Log?.Invoke("client left");
            }
        }
    }

    async Task Session(WebSocket ws)
    {
        var sendLock = new SemaphoreSlim(1, 1);
        async Task SendBytes(ReadOnlyMemory<byte> bytes, WebSocketMessageType kind)
        {
            await sendLock.WaitAsync();
            try { if (ws.State == WebSocketState.Open) await ws.SendAsync(bytes, kind, true, cts.Token); }
            finally { sendLock.Release(); }
        }
        Task Send(object o) => SendBytes(JsonSerializer.SerializeToUtf8Bytes(o), WebSocketMessageType.Text);

        var info = backend.Info;
        await Send(new
        {
            type = "hello",
            backend = info.Backend, device = info.Device, sampleRate = info.SampleRate, bufferFrames = info.BufferFrames,
            inputLatencyMs = info.InputLatencyMs, outputLatencyMs = info.OutputLatencyMs, roundTripMs = info.RoundTripMs,
            note = info.Note, version = Version, @params = ParamsJson(amp.Current),
            engine = backend.SupportsEngine, inputChannels = backend.InputChannelNames, inputChannel = backend.InputChannel,
        });

        // The input stream runs on its own thread so it can wake on every
        // callback; Task.Delay is only good to the 15.6 ms system tick.
        var streamStop = new CancellationTokenSource();
        Thread? streamThread = null;
        void StartStream()
        {
            if (streamThread != null || backend.Tap is not InputTap tap) return;
            streamStop = new CancellationTokenSource();
            var token = streamStop.Token;
            streamThread = new Thread(() => StreamLoop(tap, token, SendBytes)) { IsBackground = true, Name = "input stream" };
            streamThread.Start();
        }
        void StopStream()
        {
            streamStop.Cancel();
            streamThread?.Join(500);
            streamThread = null;
        }

        var statusTask = Task.Run(async () =>
        {
            while (ws.State == WebSocketState.Open && !cts.IsCancellationRequested)
            {
                await Task.Delay(100, cts.Token);
                await Send(new
                {
                    type = "status", inRms = amp.InRms, inPeak = amp.InPeak, outPeak = amp.OutPeak, xruns = backend.Xruns, probing = backend.Probe.Running,
                    late = backend.Voices?.Late ?? 0, dropped = backend.Voices?.Dropped ?? 0,
                });
                if (backend.Probe.TryTakeResult(out double ms, out double jit, out int n, out int misses))
                {
                    Log?.Invoke(n >= 3 ? $"loopback {ms:F1} ms ±{jit:F1} ({n} pulses, {misses} missed)" : $"loopback failed: {n} of {n + misses} pulses came back");
                    await Send(new { type = "loopback", ok = n >= 3, ms, jitterMs = jit, n, misses });
                }
            }
        });

        var buf = new byte[8192];
        var msgBytes = new MemoryStream();
        try
        {
            while (ws.State == WebSocketState.Open)
            {
                var r = await ws.ReceiveAsync(buf, cts.Token);
                if (r.MessageType == WebSocketMessageType.Close)
                {
                    await ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "bye", cts.Token);
                    break;
                }
                msgBytes.Write(buf, 0, r.Count);
                if (!r.EndOfMessage) continue;
                var bytes = msgBytes.ToArray();
                msgBytes.SetLength(0);

                if (r.MessageType == WebSocketMessageType.Binary)
                {
                    ReceiveVoice(bytes);
                    continue;
                }
                try
                {
                    using var doc = JsonDocument.Parse(bytes);
                    var root = doc.RootElement;
                    var type = root.TryGetProperty("type", out var t) ? t.GetString() : null;
                    if (type == "params") amp.Set(Merge(amp.Current, root));
                    else if (type == "ping") await Send(new { type = "pong" });
                    else if (type == "test") amp.TriggerTest();
                    else if (type == "loopback") backend.Probe.Request();
                    else if (type == "play")
                    {
                        if (root.TryGetProperty("v", out var v) && root.TryGetProperty("f", out var f))
                            backend.Voices?.Enqueue(v.GetInt32(), f.GetInt64(), root.TryGetProperty("g", out var g) ? g.GetSingle() : 1f);
                    }
                    else if (type == "input")
                    {
                        if (root.TryGetProperty("channel", out var c) && c.ValueKind == JsonValueKind.Number)
                            backend.InputChannel = c.GetInt32();
                        await Send(new { type = "input", channel = backend.InputChannel });
                    }
                    else if (type == "stream")
                    {
                        if (root.TryGetProperty("on", out var on) && on.ValueKind == JsonValueKind.True) StartStream();
                        else StopStream();
                    }
                }
                catch (Exception e) when (e is JsonException or InvalidOperationException or FormatException) { /* ignore garbage */ }
            }
        }
        finally { StopStream(); }
        try { await statusTask; } catch { }
    }

    void ReceiveVoice(byte[] bytes)
    {
        if (backend.Voices is not VoiceBank bank || bytes.Length < 4 || (bytes.Length - 4) % 4 != 0) return;
        int id = BitConverter.ToInt32(bytes, 0);
        var pcm = new float[(bytes.Length - 4) / 4];
        Buffer.BlockCopy(bytes, 4, pcm, 0, pcm.Length * 4);
        bank.Upload(id, pcm);
    }

    // Sends the input as it arrives, from the moment the stream starts. Each
    // message carries the frame of its first sample, so a gap (this thread
    // falling behind, or the browser being slow to read) is visible to the
    // browser rather than silently spliced.
    static void StreamLoop(InputTap tap, CancellationToken token, Func<ReadOnlyMemory<byte>, WebSocketMessageType, Task> send)
    {
        var wake = tap.Subscribe();
        try
        {
            long pos = tap.Written;
            var tmp = new float[8192];
            while (!token.IsCancellationRequested)
            {
                wake.WaitOne(50);
                int n = tap.Read(pos, tmp, out long start);
                if (n == 0) continue;
                var msg = new byte[8 + n * 4];
                BitConverter.TryWriteBytes(msg.AsSpan(0, 8), start);
                Buffer.BlockCopy(tmp, 0, msg, 8, n * 4);
                pos = start + n;
                try { send(msg, WebSocketMessageType.Binary).GetAwaiter().GetResult(); }
                catch { break; }
            }
        }
        finally { tap.Unsubscribe(wake); }
    }

    static AmpParams Merge(AmpParams p, JsonElement e)
    {
        float F(string k, float cur) => e.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetSingle() : cur;
        bool B(string k, bool cur) => e.TryGetProperty(k, out var v) && (v.ValueKind == JsonValueKind.True || v.ValueKind == JsonValueKind.False) ? v.GetBoolean() : cur;
        return new AmpParams(F("gain", p.Gain), F("drive", p.Drive), F("compress", p.Compress),
            F("bass", p.Bass), F("mid", p.Mid), F("treble", p.Treble), F("level", p.Level), B("monitor", p.Monitor));
    }

    static object ParamsJson(AmpParams p) => new
    {
        gain = p.Gain, drive = p.Drive, compress = p.Compress, bass = p.Bass, mid = p.Mid, treble = p.Treble, level = p.Level, monitor = p.Monitor,
    };

    bool OriginAllowed(string origin)
    {
        if (!Uri.TryCreate(origin, UriKind.Absolute, out var u)) return false;
        if (u.Scheme != "http" && u.Scheme != "https") return false;
        return hosts.Contains(u.Host);
    }

    static async Task<Dictionary<string, string>?> ReadRequest(NetworkStream s)
    {
        var buf = new byte[8192];
        int n = 0;
        using var timeout = new CancellationTokenSource(5000);
        while (n < buf.Length)
        {
            int r;
            try { r = await s.ReadAsync(buf.AsMemory(n), timeout.Token); } catch { return null; }
            if (r <= 0) return null;
            n += r;
            if (n >= 4 && buf.AsSpan(0, n).IndexOf("\r\n\r\n"u8) >= 0) break;
        }
        var lines = Encoding.ASCII.GetString(buf, 0, n).Split("\r\n");
        var h = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var line in lines.Skip(1))
        {
            int i = line.IndexOf(':');
            if (i > 0) h[line[..i].Trim().ToLowerInvariant()] = line[(i + 1)..].Trim();
        }
        return h;
    }

    static async Task Reply(NetworkStream s, string status, string type, string body)
    {
        var b = Encoding.UTF8.GetBytes(body);
        var head = Encoding.ASCII.GetBytes($"HTTP/1.1 {status}\r\nContent-Type: {type}\r\nContent-Length: {b.Length}\r\nConnection: close\r\n\r\n");
        await s.WriteAsync(head);
        await s.WriteAsync(b);
    }
}
