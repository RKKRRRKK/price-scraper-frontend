// Bawu score conversion.
//
// convertImageStream(): stream a photo/screenshot of jianpu or western notation
// through the `bawu-ai` Supabase Edge Function — a thin OpenRouter proxy that
// holds the "Jianpu" key server-side (same pattern as canvy-ai). The model
// replies as NDJSON (one meta line, then one line per melody row) so the caller
// can render the score progressively and start playing before it finishes.
// continueTranscription(): resume a truncated stream (prefix-cached).
// parseManualJianpu(): the offline path — type jianpu as text.
// buildMidiFile(): tiny type-0 MIDI writer for the Export .mid button.

import { supabase } from '@/lib/supabase'
import { midiOf, jianpuDuration, canonicalKey } from './notes'

// Curated, vision-capable models offered in the import dropdown (extensible).
export const MODELS = [
  { id: 'x-ai/grok-4.5', label: 'Grok 4.5', note: 'most accurate' },
  { id: 'google/gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash Lite', note: 'faster & cheaper' },
]
export const DEFAULT_MODEL = MODELS[0].id

// Reasoning effort. Higher can improve accuracy (and may coax more out of the
// faster models) at the cost of latency/tokens; low keeps grok from spiralling.
export const EFFORTS = [
  { id: 'low', label: 'Low', note: 'fastest' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High', note: 'most thorough' },
]
export const DEFAULT_EFFORT = 'low'

// The transcription prompt is assembled from parts so the two source notations
// (jianpu vs western staff) and the optional lyrics pass share one output
// schema. Both modes emit the SAME NDJSON jianpu data model — western staff is
// converted to jianpu degrees relative to the detected key on the way out.

const JIANPU_INTRO = `You are an expert music transcription engine specialising in Chinese jianpu (numbered notation) for wind instruments (dizi/bawu). The image is a JIANPU (numbered-notation) score, possibly photographed at an angle. Read the MAIN melody EXACTLY as printed and stream it as NDJSON: newline-delimited JSON, ONE complete JSON object per line, no markdown fences, no commentary, nothing else.`

const WESTERN_INTRO = `You are an expert music transcription engine that reads WESTERN STAFF notation (five-line staff) and converts it to Chinese jianpu (numbered notation) for wind instruments (dizi/bawu). The image is western sheet music, possibly photographed at an angle. Read the MAIN melody (usually the top staff / vocal line — skip piano accompaniment and chord symbols) EXACTLY as printed, convert every note to a jianpu degree, and stream it as NDJSON: newline-delimited JSON, ONE complete JSON object per line, no markdown fences, no commentary, nothing else.`

const META_SPEC = `FIRST line — the metadata object:
{"type":"meta","title":"exact printed title in its original script, else empty","title_en":"English translation, or a romanization for a proper name; empty if already English or none","key":"F","timeSig":"4/4","bpm":88,"lines":11,"top":0.10,"bottom":0.66}
- "key": {{KEY_HINT}} Report it as one of these spellings: C, C#, D, D#, E, F, F#, G, G#, A, A#, B. If the score is printed with a flat key (e.g. 1=♭B, 1=♭E), give the ENHARMONIC SHARP equivalent instead (♭B→A#, ♭E→D#, ♭A→G#, ♭D→C#, ♭G→F#).
- "timeSig": the printed time signature (give the first one if the meter changes).
- "bpm": if a numeric metronome mark (e.g. ♩=120) is printed, use it. OTHERWISE infer from the printed tempo term: 慢板/柔板/Adagio≈60, 行板/Andante≈76, 中速/中板/Moderato≈88, 小快板/稍快/Allegretto≈112, 快板/Allegro≈132, 急板/极快/Presto≈160. Expression words (深情地/优美地/热烈地/欢快地) are NOT tempo — ignore them for bpm.
- "lines": how many melody rows follow (best estimate; drives a progress bar).
- "top"/"bottom": the vertical span of the PRINTED MUSIC BLOCK on the image, as fractions of image height (0=top edge, 1=bottom edge) — from the top of the first staff row to the bottom of the LAST staff row. Exclude the title and the blank margin below the music. Estimate the block edges carefully; a marker is drawn over the image using them.`

const KEY_HINT_JIANPU = 'read the "1=X" marking.'
const KEY_HINT_WESTERN = 'the tonic of the printed key signature (e.g. 2 sharps → D major → "D"; 1 flat → F major → "F"). This becomes jianpu degree 1.'

const NOTE_FIELDS_COMMON = `Note fields:
- "d": the jianpu digit 1-7 (scale degree relative to the key's "1"). Use 0 for a rest.
- "o": octave dots — 0 = the octave of the tonic, +1/+2 = one/two octaves above, -1/-2 = below.
- "b": duration in beats, where a plain quarter note / plain digit = 1 beat. Half = 2, dotted-half = 3, whole = 4; eighth = 0.5, sixteenth = 0.25. A dotted note multiplies by 1.5. Fold ties/dashes into ONE note's "b" (a note held 3 beats → b:3).
- "acc": accidental on THIS note: 0 none, 1 sharp (♯/#), -1 flat (♭/b), 2 natural (♮).
- "art": articulation — "T" (single tongue 吐), "TK" (double tongue), "tr" (trill/tremolo), "grace" (grace note), or "" none. If unsure, use "".`

const HOW_TO_JIANPU = `Read carefully, MEASURE BY MEASURE between barlines. For each printed digit:
- "o" comes from octave dots ABOVE (+) or BELOW (−) the digit (these are octave marks, not staccato).
- "b": underline(s) UNDER the digit halve it (1 underline = 0.5, 2 = 0.25, 3 = 0.125); a dash "−" AFTER the digit adds 1 beat each (digit then "− −" = 3 beats); an augmentation dot "·" AFTER the digit multiplies by 1.5.
Transcribe every printed digit in order — never skip, reorder, or invent notes; do not guess when a digit is legible. Include rests. Merge tie/slur arcs across barlines into ONE longer note (sum the beats).`

const HOW_TO_WESTERN = `Read carefully, MEASURE BY MEASURE between barlines. For each note head on the melody staff:
- Identify its letter pitch from the clef + its line/space (apply the key signature, plus any accidental for that bar). Then convert to a jianpu degree relative to the key's tonic = 1: e.g. in D major, D→1, E→2, F♯→3, G→4, A→5, B→6, C♯→7. Set "o" by octave: notes in the tonic's own octave → 0, an octave up → +1, an octave down → −1.
- A note NOT in the key's major scale keeps the nearest degree with "acc" set (e.g. F♮ in D major → d:3, acc:-1).
- "b" comes from the note value (whole/half/quarter/eighth/…, dots, and ties) as described above.
Transcribe every melody note in order — never skip, reorder, or invent notes. Include rests. Merge tied notes into ONE longer note (sum the beats). Ignore chord symbols, accompaniment staves, and fingering.`

const LYRICS_ON = `Also transcribe the SUNG LYRICS. Add an "ly" field to each note holding the syllable/word printed under that note (keep the original script; one syllable per note, aligned left-to-right). A note with no syllable of its own (a melisma continuation, or an instrumental note) gets "ly":"". Rests get "ly":"".`
const LYRICS_ON_PINYIN = `${LYRICS_ON} ALSO add a "py" field with the tone-marked Hanyu Pinyin romanization of that same "ly" syllable (e.g. "ly":"月" → "py":"yuè"; use the tone marks ā á ǎ à, not tone numbers). When "ly" is empty, "py" is "". If the lyric is already in a Latin script, copy it into "py" unchanged.`
const LYRICS_OFF = `Ignore lyrics, fingering diagrams, and expression/dynamics text.`

const TAIL = `Skip staves that carry no melody (e.g. piano-only intros). Output ONLY NDJSON — no prose, no code fences, no trailing summary.`

// Assemble the full prompt for a given source notation + lyrics/pinyin choice
// and optional free-text user guidance.
function buildPrompt({ mode = 'jianpu', lyrics = false, pinyin = false, notes = '' } = {}) {
  const western = mode === 'western'
  const pin = lyrics && pinyin
  const intro = western ? WESTERN_INTRO : JIANPU_INTRO
  const meta = META_SPEC.replace('{{KEY_HINT}}', western ? KEY_HINT_WESTERN : KEY_HINT_JIANPU)
  const rowExample = `THEN one object per printed melody row, in reading order:
{"i":0,"notes":[{"d":5,"o":0,"b":1,"acc":0,"art":""${lyrics ? ',"ly":""' : ''}${pin ? ',"py":""' : ''}}]}
- "i": 0-based row index.`
  const fields = NOTE_FIELDS_COMMON
    + (lyrics ? `\n- "ly": the sung syllable printed at this note (see below), or "".` : '')
    + (pin ? `\n- "py": tone-marked pinyin for this note's "ly" syllable (see below), or "".` : '')
  const howto = western ? HOW_TO_WESTERN : HOW_TO_JIANPU
  const lyricsClause = lyrics ? (pin ? LYRICS_ON_PINYIN : LYRICS_ON) : LYRICS_OFF
  const guidance = String(notes || '').trim()
  const guidanceClause = guidance
    ? `User guidance — follow these extra instructions from the person requesting this transcription, as long as they don't conflict with producing valid NDJSON:\n"""\n${guidance.slice(0, 1000)}\n"""`
    : ''
  return [intro, meta, rowExample, fields, howto, lyricsClause, guidanceClause, TAIL].filter(Boolean).join('\n\n')
}

// Combine the printed title with its English rendering as "Original (English)".
// Skips the parenthetical when there's no translation, it matches the original,
// or the title is already English (the model returns an empty title_en then).
function buildTitle(rawTitle, rawTitleEn) {
  const orig = String(rawTitle || '').trim()
  const en = String(rawTitleEn || '').trim()
  if (!orig) return en
  if (!en || en.toLowerCase() === orig.toLowerCase()) return orig
  // Guard against the model echoing the English inside the parenthetical twice.
  if (orig.toLowerCase().includes(en.toLowerCase())) return orig
  return `${orig} (${en})`
}

// ── NDJSON validators ────────────────────────────────────────────────────────
const clampFrac = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Math.min(1, Number(v))) : null)

const ART_TAGS = ['T', 'TK', 'tr', 'grace']

// The meta line → { title, key, bpm, timeSig, expectedLines, contentTop, contentBottom }.
function normalizeMeta(raw) {
  // Any spelling (sharp/flat/enharmonic) folds to its canonical sharp name; an
  // unreadable key falls back to F rather than silently mislabelling the score.
  const key = canonicalKey(raw?.key) || 'F'
  const expected = Math.max(0, Math.min(400, Math.round(Number(raw?.lines) || 0)))
  // Vertical span of the printed music block — positions the on-image marker.
  let top = clampFrac(raw?.top)
  let bottom = clampFrac(raw?.bottom)
  if (top != null && bottom != null && bottom < top) [top, bottom] = [bottom, top]
  const hasBlock = top != null && bottom != null && bottom - top > 0.05
  return {
    title: buildTitle(raw?.title, raw?.title_en),
    key,
    bpm: Math.max(30, Math.min(220, Math.round(Number(raw?.bpm) || 80))),
    timeSig: /^\d+\/\d+$/.test(raw?.timeSig || '') ? raw.timeSig : '4/4',
    expectedLines: expected || null,
    contentTop: hasBlock ? top : null,
    contentBottom: hasBlock ? bottom : null,
  }
}

// A line object → { notes }, or null when it carries no notes.
function normalizeLine(raw) {
  const notes = []
  for (const n of raw?.notes || []) {
    const deg = Math.max(0, Math.min(7, Math.round(Number(n.d ?? n.deg) || 0)))
    const oct = Math.max(-2, Math.min(2, Math.round(Number(n.o ?? n.oct) || 0)))
    const beats = Math.max(0.125, Math.min(16, Number(n.b ?? n.beats) || 1))
    const accRaw = Math.round(Number(n.acc) || 0)
    const acc = accRaw === 1 ? 1 : accRaw === -1 ? -1 : accRaw === 2 ? 2 : 0
    const art = ART_TAGS.includes(n.art) ? n.art : ''
    const ly = typeof n.ly === 'string' ? n.ly.trim().slice(0, 32) : ''
    const py = typeof n.py === 'string' ? n.py.trim().slice(0, 32) : ''
    const note = { deg, oct, beats }
    if (acc) note.acc = acc
    if (art) note.art = art
    if (ly) note.ly = ly
    if (py) note.py = py
    notes.push(note)
  }
  if (!notes.length) return null
  return { notes }
}

// A single NDJSON line → parsed object, or null when it isn't a usable object
// (blank, a stray code fence, or an incomplete/partial line from truncation).
function parseNdjsonLine(raw) {
  let s = String(raw || '').trim()
  if (!s || s.startsWith('```')) return null
  if (s.endsWith('```')) s = s.replace(/```+$/, '').trim()
  if (!s.startsWith('{')) return null
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

function looksLikeMeta(obj) {
  return (
    obj &&
    !Array.isArray(obj.notes) &&
    (obj.type === 'meta' || 'key' in obj || 'title' in obj || 'timeSig' in obj)
  )
}

// ── Streaming transport ──────────────────────────────────────────────────────
function functionUrl() {
  const base = String(import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '')
  return `${base}/functions/v1/bawu-ai`
}

async function authHeaders() {
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY
  let token = anon
  try {
    const { data } = await supabase.auth.getSession()
    if (data?.session?.access_token) token = data.session.access_token
  } catch { /* fall back to anon */ }
  return {
    'Content-Type': 'application/json',
    apikey: anon,
    Authorization: `Bearer ${token}`,
  }
}

// Open the streamed function, parse SSE → NDJSON content, dispatch meta/lines.
// Resolves { meta, lines, truncated, usage }. `expectMeta:false` treats every
// object as a line (used by continuations, which must not re-emit meta).
async function runStream({ prompt, dataUri, model, effort, signal, expectMeta = true, onMeta, onLine, onProgress, onReasoning }) {
  let res
  try {
    res = await fetch(functionUrl(), {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify({ prompt, imageBase64: dataUri, model, effort }),
      signal,
    })
  } catch (e) {
    if (e?.name === 'AbortError') throw e
    throw new Error(`Could not reach the transcription service: ${e?.message || e}`)
  }
  if (!res.ok || !res.body) {
    let detail = ''
    try {
      const body = await res.json()
      detail = body?.error || ''
    } catch { /* no JSON body */ }
    console.error('[Bawu] bawu-ai error', res.status, detail)
    throw new Error(detail ? `${detail} (HTTP ${res.status})` : `AI request failed (HTTP ${res.status}).`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let sseBuf = '' // raw SSE text buffer
  let contentBuf = '' // accumulated model content (NDJSON text)
  let finishReason = null
  let usage = null
  let meta = null
  let sawReasoning = false
  const lines = []

  const dispatchLine = (raw) => {
    const obj = parseNdjsonLine(raw)
    if (!obj) return
    if (expectMeta && meta === null && looksLikeMeta(obj)) {
      meta = normalizeMeta(obj)
      onMeta?.(meta)
      return
    }
    const line = normalizeLine(obj)
    if (line) {
      lines.push(line)
      onLine?.(line, lines.length)
    }
  }

  const drainContent = () => {
    let nl
    while ((nl = contentBuf.indexOf('\n')) >= 0) {
      const raw = contentBuf.slice(0, nl)
      contentBuf = contentBuf.slice(nl + 1)
      dispatchLine(raw)
    }
  }

  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    sseBuf += decoder.decode(value, { stream: true })
    let idx
    while ((idx = sseBuf.indexOf('\n')) >= 0) {
      const rawLine = sseBuf.slice(0, idx).replace(/\r$/, '')
      sseBuf = sseBuf.slice(idx + 1)
      if (!rawLine || rawLine.startsWith(':')) continue // blank / keep-alive comment
      if (!rawLine.startsWith('data:')) continue
      const payload = rawLine.slice(5).trim()
      if (payload === '[DONE]') continue
      let chunk
      try {
        chunk = JSON.parse(payload)
      } catch {
        continue
      }
      if (chunk?.usage) usage = chunk.usage
      const choice = chunk?.choices?.[0]
      const delta = choice?.delta
      if (!sawReasoning && (delta?.reasoning || delta?.reasoning_content)) {
        sawReasoning = true
        onReasoning?.()
      }
      if (typeof delta?.content === 'string' && delta.content) {
        contentBuf += delta.content
        drainContent()
        onProgress?.({ lines: lines.length })
      }
      if (choice?.finish_reason) finishReason = choice.finish_reason
    }
  }
  // Flush a trailing complete line (clean end without a final newline). A
  // dangling partial from truncation won't parse and is dropped.
  if (contentBuf.trim()) dispatchLine(contentBuf)

  return { meta, lines, truncated: finishReason === 'length', usage }
}

// Stream a fresh conversion. Callbacks fire as data arrives; the promise
// resolves with the assembled score. `signal` aborts the request.
// Returns { title, data, meta, truncated, expectedLines }.
export async function convertImageStream(dataUri, {
  model = DEFAULT_MODEL,
  effort = DEFAULT_EFFORT,
  mode = 'jianpu',
  lyrics = false,
  pinyin = false,
  notes = '',
  signal,
  onMeta,
  onLine,
  onProgress,
  onReasoning,
} = {}) {
  const { meta, lines, truncated, usage } = await runStream({
    prompt: buildPrompt({ mode, lyrics, pinyin, notes }), dataUri, model, effort, signal, onMeta, onLine, onProgress, onReasoning,
  })
  if (!lines.length && !truncated) throw new Error('The AI found no notes in the image.')
  const m = meta || normalizeMeta({})
  return {
    title: m.title,
    truncated,
    expectedLines: m.expectedLines,
    meta: { model, effort, usage: usage || null, truncated },
    data: {
      key: m.key,
      bpm: m.bpm,
      timeSig: m.timeSig,
      contentTop: m.contentTop,
      contentBottom: m.contentBottom,
      lines,
    },
  }
}

// Resume a truncated transcription: same image + prompt prefix (prefix-cached by
// the provider), plus a note to continue after the lines already collected.
// Returns { lines, truncated, usage } — only the NEW lines.
export async function continueTranscription(dataUri, existing, {
  model = DEFAULT_MODEL,
  effort = DEFAULT_EFFORT,
  mode = 'jianpu',
  lyrics = false,
  pinyin = false,
  notes = '',
  signal,
  onLine,
  onProgress,
} = {}) {
  const done = existing?.data?.lines?.length || 0
  const prompt = `${buildPrompt({ mode, lyrics, pinyin, notes })}

CONTINUATION: You already transcribed the first ${done} melody row(s) of this exact image. Do NOT repeat them and do NOT output the meta line again. Resume at row index ${done} (0-based) and continue in the SAME NDJSON format — one object per row — until the piece ends.`
  const { lines, truncated, usage } = await runStream({
    prompt, dataUri, model, effort, signal, expectMeta: false, onLine, onProgress,
  })
  return { lines, truncated, usage }
}

// ── Manual jianpu text ──────────────────────────────────────────────────────
// One line of text per printed line of music. Tokens separated by spaces;
// barlines (|) are ignored. Syntax per token:
//   1..7   note        0      rest
//   '      high-octave dot (5')      ,   low-octave dot (5,)
//   -      as its own token: extend the previous note by 1 beat
//   .      dotted, 1.5x (5.)         _   halve, may repeat (5_ = ½, 5__ = ¼)
//   #5 b5 n5   sharp / flat / natural accidental prefix
//   5(tr)      articulation tag: (T) (TK) (tr) (grace)
// Optional header anywhere: 1=F  4/4  bpm=80
//
// scoreToJianpuText() is the exact inverse — it serialises score data back into
// this format, so a copy → hand-edit → paste round-trip is lossless.
export function parseManualJianpu(text) {
  const lines = []
  let key = 'F'
  let bpm = 80
  let timeSig = '4/4'
  for (const rawLine of (text || '').split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    const keyM = line.match(/1\s*=\s*([A-Ga-g][b#♭♯]?)/)
    const bpmM = line.match(/bpm\s*=?\s*(\d+)/i)
    const sigM = line.match(/(\d+)\s*\/\s*(\d+)/)
    // A header line contributes settings but no notes.
    const isHeader = (keyM || bpmM) && !/^[\w\s|'’,.()#-]+$/.test(line.replace(/1\s*=\s*[A-Ga-g][b#♭♯]?/g, '').replace(/bpm\s*=?\s*\d+/gi, ''))
    if (keyM) key = canonicalKey(keyM[1]) || key
    if (bpmM) bpm = Math.max(30, Math.min(220, Number(bpmM[1])))
    if (isHeader || (keyM && line.length < 12)) {
      if (sigM && keyM) timeSig = `${sigM[1]}/${sigM[2]}`
      continue
    }
    const notes = []
    for (const tok of line.split(/\s+/)) {
      if (!tok || tok === '|' || tok === '||') continue
      if (/^-+$/.test(tok)) {
        const prev = notes.length ? notes[notes.length - 1] : lines.length ? lines[lines.length - 1].notes.at(-1) : null
        if (prev) prev.beats += tok.length
        continue
      }
      const m = tok.match(/^([#bn]?)([0-7])(['’]*)(,*)(\.?)(_*)(?:\(([A-Za-z]+)\))?$/)
      if (!m) continue
      const deg = Number(m[2])
      const oct = m[3].length - m[4].length
      let beats = 1
      if (m[6]) beats = 1 / Math.pow(2, m[6].length)
      if (m[5]) beats *= 1.5
      const note = { deg, oct, beats }
      const acc = m[1] === '#' ? 1 : m[1] === 'b' ? -1 : m[1] === 'n' ? 2 : 0
      if (acc) note.acc = acc
      if (m[7]) note.art = m[7] === 'gr' ? 'grace' : m[7]
      notes.push(note)
    }
    if (notes.length) lines.push({ notes })
  }
  if (!lines.length) throw new Error('No notes found — type jianpu like:  5, 6, 1 2 | 3 - 5 3')
  return { data: { key, bpm, timeSig, lines } }
}

// Serialise score data back into the manual-jianpu text above. The duration
// decorations come from jianpuDuration() so they decode to the same beat values
// parseManualJianpu() produces — a clean round-trip for copy → edit → paste.
export function scoreToJianpuText(data) {
  const key = data?.key || 'F'
  const bpm = data?.bpm || 80
  const timeSig = data?.timeSig || '4/4'
  const body = (data?.lines || []).map((line) => {
    const toks = []
    for (const n of line.notes || []) {
      const d = jianpuDuration(n.beats)
      let core
      if (!n.deg) {
        core = '0'
      } else {
        const acc = n.acc === 1 ? '#' : n.acc === -1 ? 'b' : n.acc === 2 ? 'n' : ''
        const oct = n.oct > 0 ? "'".repeat(n.oct) : n.oct < 0 ? ','.repeat(-n.oct) : ''
        core = acc + n.deg + oct
      }
      // Order matches parseManualJianpu's token regex: dot then underlines.
      if (d.dot) core += '.'
      if (d.underlines) core += '_'.repeat(d.underlines)
      if (n.art) core += `(${n.art})`
      toks.push(core)
      for (let i = 0; i < d.dashes; i++) toks.push('-')
    }
    return toks.join(' ')
  })
  return [`1=${key} ${timeSig} bpm=${bpm}`, ...body].join('\n')
}

// ── MIDI export ─────────────────────────────────────────────────────────────
const TPQ = 480 // ticks per quarter

function vlq(n) {
  // variable-length quantity
  const bytes = [n & 0x7f]
  n >>= 7
  while (n > 0) {
    bytes.unshift((n & 0x7f) | 0x80)
    n >>= 7
  }
  return bytes
}

// Build a type-0 .mid from score data (concert pitch, in `key`).
export function buildMidiFile(data, key) {
  const bpm = data?.bpm || 80
  const events = []
  // tempo meta
  const uspq = Math.round(60000000 / bpm)
  events.push([0, [0xff, 0x51, 0x03, (uspq >> 16) & 0xff, (uspq >> 8) & 0xff, uspq & 0xff]])
  let tick = 0
  let lastEvTick = 0
  const push = (atTick, bytes) => {
    events.push([atTick, bytes])
  }
  for (const line of data?.lines || []) {
    for (const n of line.notes || []) {
      const dur = Math.round((Number(n.beats) || 1) * TPQ)
      const midi = midiOf(n.deg, n.oct, key || data?.key || 'F', Number(n.acc) || 0)
      if (midi != null) {
        push(tick, [0x90, midi, 88])
        push(tick + Math.max(1, dur - 10), [0x80, midi, 0])
      }
      tick += dur
    }
  }
  // sort by tick (stable) then delta-encode
  events.sort((a, b) => a[0] - b[0])
  const track = []
  lastEvTick = 0
  for (const [t, bytes] of events) {
    track.push(...vlq(Math.max(0, t - lastEvTick)), ...bytes)
    lastEvTick = t
  }
  track.push(0x00, 0xff, 0x2f, 0x00) // end of track

  const header = [
    0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, // MThd len 6
    0, 0, // format 0
    0, 1, // one track
    (TPQ >> 8) & 0xff, TPQ & 0xff,
  ]
  const trkHead = [0x4d, 0x54, 0x72, 0x6b,
    (track.length >> 24) & 0xff, (track.length >> 16) & 0xff, (track.length >> 8) & 0xff, track.length & 0xff]
  return new Uint8Array([...header, ...trkHead, ...track])
}

export function downloadMidi(data, key, name) {
  const bytes = buildMidiFile(data, key)
  const blob = new Blob([bytes], { type: 'audio/midi' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${(name || 'bawu-score').replace(/[\\/:*?"<>|]/g, '_')}.mid`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 5000)
}
