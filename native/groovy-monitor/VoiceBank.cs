// Engine mode: the two things that make this process a sound card for the web
// app rather than only its amp.
//
// VoiceBank plays short sounds (the click, the drums, the probe pulse) that the
// browser rendered and uploaded, each on the exact frame it asked for. InputTap
// keeps the last second of the input so the control server can stream it to
// the browser, stamped with the frame it was captured on.
//
// Both are driven from the ASIO callback, where a single running frame counter
// covers the input block and the output block alike. That shared counter is
// the whole reason engine mode exists: a sound booked for frame F and a note
// captured at frame F are the same instant, offset by nothing but the driver's
// own latencies. No timing logic lives here; the browser decides every frame.

namespace GroovyMonitor;

public sealed class VoiceBank
{
    public const int MaxVoices = 32;
    const int QueueLen = 512;
    const int Slots = 64;

    struct Ev
    {
        public int Voice;
        public long Frame;
        public float Gain;
        public bool Started;
    }

    readonly float[]?[] voices = new float[MaxVoices][];
    readonly Ev[] queue = new Ev[QueueLen];
    long qHead, qTail;
    readonly object pushLock = new();
    readonly Ev[] slots = new Ev[Slots];
    readonly bool[] used = new bool[Slots];
    long late, dropped;

    /// <summary>Plays that started after their frame had already gone out.</summary>
    public long Late => Interlocked.Read(ref late);
    /// <summary>Plays thrown away because the queue or the slots were full.</summary>
    public long Dropped => Interlocked.Read(ref dropped);

    /// <summary>Any thread. Replaces the voice wholesale, so a play already
    /// sounding keeps the buffer it started with.</summary>
    public void Upload(int id, float[] pcm)
    {
        if (id >= 0 && id < MaxVoices) Volatile.Write(ref voices[id], pcm);
    }

    /// <summary>Any thread. Books voice <paramref name="voice"/> to start on
    /// <paramref name="frame"/>.</summary>
    public bool Enqueue(int voice, long frame, float gain)
    {
        if (voice < 0 || voice >= MaxVoices) return false;
        lock (pushLock)
        {
            long t = qTail;
            if (t - Volatile.Read(ref qHead) >= QueueLen)
            {
                Interlocked.Increment(ref dropped);
                return false;
            }
            queue[t % QueueLen] = new Ev { Voice = voice, Frame = frame, Gain = gain };
            Volatile.Write(ref qTail, t + 1);
        }
        return true;
    }

    /// <summary>Audio thread. Adds every booked voice that overlaps
    /// [frame0, frame0 + buf.Length) into <paramref name="buf"/>.</summary>
    public void Mix(Span<float> buf, long frame0)
    {
        // Move newly booked plays into free slots. Nothing here allocates.
        long h = qHead, t = Volatile.Read(ref qTail);
        while (h < t)
        {
            int free = -1;
            for (int s = 0; s < Slots; s++) if (!used[s]) { free = s; break; }
            if (free < 0) { Interlocked.Increment(ref dropped); }
            else { slots[free] = queue[h % QueueLen]; used[free] = true; }
            h++;
        }
        Volatile.Write(ref qHead, h);

        int n = buf.Length;
        for (int s = 0; s < Slots; s++)
        {
            if (!used[s]) continue;
            ref Ev ev = ref slots[s];
            var pcm = Volatile.Read(ref voices[ev.Voice]);
            if (pcm == null || ev.Frame + pcm.Length <= frame0)
            {
                // Unknown voice, or one that finished (or expired unheard).
                if (pcm != null && !ev.Started) Interlocked.Increment(ref late);
                used[s] = false;
                continue;
            }
            long start = ev.Frame - frame0;
            if (start >= n) continue;
            if (!ev.Started)
            {
                ev.Started = true;
                if (start < 0) Interlocked.Increment(ref late);
            }
            int i0 = start < 0 ? 0 : (int)start;
            long src = frame0 + i0 - ev.Frame;
            float g = ev.Gain;
            for (int i = i0; i < n && src < pcm.Length; i++, src++) buf[i] += pcm[src] * g;
            if (ev.Frame + pcm.Length <= frame0 + n) used[s] = false;
        }
    }
}

/// <summary>
/// The input as captured, addressed by absolute frame number. One writer (the
/// audio thread), any number of readers, each keeping its own position. A
/// reader that falls more than the capacity behind simply skips ahead; the
/// frame stamp on what it reads tells the browser there was a gap.
/// </summary>
public sealed class InputTap
{
    readonly float[] buf;
    long written;
    AutoResetEvent[] subs = Array.Empty<AutoResetEvent>();
    readonly object subLock = new();

    public InputTap(int capacity) { buf = new float[capacity]; }

    /// <summary>The frame after the last one written.</summary>
    public long Written => Volatile.Read(ref written);

    /// <summary>Audio thread.</summary>
    public void Push(ReadOnlySpan<float> src, long frame0)
    {
        int cap = buf.Length;
        for (int i = 0; i < src.Length; i++) buf[(int)((frame0 + i) % cap)] = src[i];
        Volatile.Write(ref written, frame0 + src.Length);
        foreach (var e in Volatile.Read(ref subs)) e.Set();
    }

    public AutoResetEvent Subscribe()
    {
        var e = new AutoResetEvent(false);
        lock (subLock) subs = subs.Append(e).ToArray();
        return e;
    }

    public void Unsubscribe(AutoResetEvent e)
    {
        lock (subLock) subs = subs.Where(x => x != e).ToArray();
        e.Dispose();
    }

    /// <summary>Copies frames from <paramref name="from"/> onward into
    /// <paramref name="dst"/>. Returns how many, and the frame the first one
    /// belongs to — later than <paramref name="from"/> if the reader fell behind.</summary>
    public int Read(long from, Span<float> dst, out long start)
    {
        int cap = buf.Length;
        long w = Written;
        // Keep a margin from the write head: those slots may be mid-overwrite.
        long oldest = w - cap + 1024;
        start = Math.Max(from, Math.Max(0, oldest));
        int n = (int)Math.Min(dst.Length, Math.Max(0, w - start));
        for (int i = 0; i < n; i++) dst[i] = buf[(int)((start + i) % cap)];
        return n;
    }
}
