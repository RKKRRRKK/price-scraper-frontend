// groovy-monitor — entry point and command line.
//
//   groovy-monitor --list
//   groovy-monitor [--backend auto|asio|wasapi] [--device <name part>]
//                  [--in-channel N] [--out-channel N] [--rate 48000]
//                  [--port 47391] [--origin host]... [--monitor]
//                  [--seconds N] [--quiet]
//
// Channels are 1-based on the command line because that is how they are
// printed on the interface. --seconds is for tests: run, report, exit.

using System.Globalization;

namespace GroovyMonitor;

static class Program
{
    // ASIO drivers are apartment-threaded COM objects; NAudio refuses to open
    // one from an MTA thread. WASAPI does not care, and its own threads are
    // background MTA threads anyway.
    [STAThread]
    static int Main(string[] args)
    {
        var a = Args.Parse(args);
        if (a.Help)
        {
            Console.WriteLine(Usage);
            return 0;
        }

        if (a.List)
        {
            Console.WriteLine("ASIO drivers:");
            var drivers = AsioBackend.Drivers();
            if (drivers.Length == 0) Console.WriteLine("  (none registered — install the interface's own driver for ASIO)");
            foreach (var d in drivers) Console.WriteLine("  " + d);
            Console.WriteLine("WASAPI endpoints:");
            foreach (var line in WasapiBackend.Describe()) Console.WriteLine(line);
            return 0;
        }

        var initial = new AmpParams(Monitor: a.Monitor);
        Amp? amp = null;
        Amp Factory(int rate) => amp = new Amp(rate, initial);

        IBackend backend;
        try
        {
            string choice = a.Backend;
            if (choice == "auto") choice = AsioBackend.Drivers().Length > 0 ? "asio" : "wasapi";
            backend = choice switch
            {
                "asio" => new AsioBackend(a.Device, a.InChannel, a.OutChannel, a.Rate, Factory),
                "wasapi" => new WasapiBackend(a.Device, a.InChannel, null, Factory),
                _ => throw new ArgumentException($"unknown backend {choice}"),
            };
        }
        catch (Exception e)
        {
            Console.Error.WriteLine("Could not open the audio device: " + e.Message);
            return 2;
        }

        var info = backend.Info;
        Console.WriteLine($"groovy-monitor {ControlServer.Version}");
        Console.WriteLine($"  backend     {info.Backend}");
        Console.WriteLine($"  device      {info.Device}");
        Console.WriteLine($"  rate        {info.SampleRate} Hz, {info.BufferFrames} frames per period ({1000.0 * info.BufferFrames / info.SampleRate:F1} ms)");
        Console.WriteLine($"  latency     in {info.InputLatencyMs:F1} ms + out {info.OutputLatencyMs:F1} ms → about {info.RoundTripMs:F0} ms through this process");
        if (info.Note.Length > 0) Console.WriteLine($"  note        {info.Note}");

        var hosts = new List<string> { "localhost", "127.0.0.1", "quanticart.web.app", "quanticart.firebaseapp.com" };
        hosts.AddRange(a.Origins);
        ControlServer server;
        try
        {
            server = new ControlServer(a.Port, amp!, backend, hosts);
        }
        catch (Exception e)
        {
            Console.Error.WriteLine($"Could not listen on 127.0.0.1:{a.Port}: {e.Message}");
            backend.Dispose();
            return 3;
        }
        if (!a.Quiet) server.Log += s => Console.WriteLine("  ws          " + s);
        Console.WriteLine($"  control     ws://127.0.0.1:{server.Port}  (origins: {string.Join(", ", hosts)})");
        Console.WriteLine($"  monitor     {(a.Monitor ? "on from the start" : "muted until the web app unmutes it")}");

        try { backend.Start(); }
        catch (Exception e)
        {
            Console.Error.WriteLine("Could not start the stream: " + e.Message);
            server.Stop(); backend.Dispose();
            return 4;
        }

        var stop = new ManualResetEventSlim(false);
        Console.CancelKeyPress += (_, ev) => { ev.Cancel = true; stop.Set(); };
        Console.WriteLine("  running — Ctrl+C to stop");

        var t0 = DateTime.UtcNow;
        long lastX = 0;
        while (!stop.IsSet)
        {
            stop.Wait(1000);
            if (a.Seconds > 0 && (DateTime.UtcNow - t0).TotalSeconds >= a.Seconds) break;
            if (a.Quiet) continue;
            long x = backend.Xruns;
            string xs = x == lastX ? "" : $"  xruns {x}";
            lastX = x;
            Console.Write($"\r  in {Db(amp!.InRms),6} dB rms  peak {Db(amp.InPeak),6} dB  out peak {Db(amp.OutPeak),6} dB  clients {server.Clients}{xs}   ");
        }
        Console.WriteLine();
        Console.WriteLine($"  stopped after {(DateTime.UtcNow - t0).TotalSeconds:F0} s, {backend.Xruns} xruns");
        server.Stop();
        backend.Dispose();
        return 0;
    }

    static string Db(float lin) => lin <= 1e-6f ? "-inf" : (20 * MathF.Log10(lin)).ToString("F1", CultureInfo.InvariantCulture);

    const string Usage = """
        groovy-monitor — Groovy's native monitoring path for Windows.

          --list               show ASIO drivers and WASAPI endpoints, then exit
          --backend X          auto (default), asio, or wasapi
          --device NAME        part of the driver / endpoint name (default: first ASIO driver,
                               or the Windows default capture + playback devices)
          --in-channel N       input channel the bass is on, 1-based (default 1)
          --out-channel N      first output channel, 1-based; N and N+1 are used (ASIO only, default 1)
          --rate HZ            ASIO sample rate (default 48000; WASAPI uses the engine's rate)
          --port P             WebSocket port on 127.0.0.1 (default 47391)
          --origin HOST        extra browser origin host to accept (repeatable)
          --monitor            start unmuted instead of waiting for the web app
          --seconds N          exit after N seconds (for tests)
          --quiet              no per-second meter line
        """;

    sealed class Args
    {
        public bool Help, List, Monitor, Quiet;
        public string Backend = "auto";
        public string? Device;
        public int InChannel = 0, OutChannel = 0, Rate = 48000, Port = 47391, Seconds = 0;
        public List<string> Origins = new();

        public static Args Parse(string[] argv)
        {
            var a = new Args();
            for (int i = 0; i < argv.Length; i++)
            {
                string k = argv[i];
                string Next() => i + 1 < argv.Length ? argv[++i] : throw new ArgumentException($"{k} needs a value");
                switch (k)
                {
                    case "-h": case "--help": a.Help = true; break;
                    case "--list": a.List = true; break;
                    case "--monitor": a.Monitor = true; break;
                    case "--quiet": a.Quiet = true; break;
                    case "--backend": a.Backend = Next().ToLowerInvariant(); break;
                    case "--device": a.Device = Next(); break;
                    case "--in-channel": a.InChannel = Math.Max(0, int.Parse(Next(), CultureInfo.InvariantCulture) - 1); break;
                    case "--out-channel": a.OutChannel = Math.Max(0, int.Parse(Next(), CultureInfo.InvariantCulture) - 1); break;
                    case "--rate": a.Rate = int.Parse(Next(), CultureInfo.InvariantCulture); break;
                    case "--port": a.Port = int.Parse(Next(), CultureInfo.InvariantCulture); break;
                    case "--origin": a.Origins.Add(Next()); break;
                    case "--seconds": a.Seconds = int.Parse(Next(), CultureInfo.InvariantCulture); break;
                    default: throw new ArgumentException($"unknown option {k} (try --help)");
                }
            }
            return a;
        }
    }
}
