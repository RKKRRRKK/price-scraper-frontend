// Bawu score conversion.
//
// convertImageStream(): stream a photo/screenshot of jianpu or western notation
// through the `bawu-ai` Supabase Edge Function — a thin OpenRouter proxy that
// holds the "Jianpu" key server-side (same pattern as canvy-ai). The model
// replies as NDJSON (one meta line, then one line per melody row) so the caller
// can render the score progressively and start playing before it finishes.
// continueTranscription(): resume a truncated stream (prefix-cached).
// convertLyricsStream(): a SECOND, separate pass over the same picture that
//   reads only the sung words. Notes and lyrics used to share one request; on a
//   long score that request ran out of time, and splitting the model's
//   attention cost accuracy on both jobs. The lyrics pass is handed the melody
//   it has to line up against, so it only has to read words.
// parseManualJianpu(): the offline path — type jianpu as text.
// buildMidiFile(): tiny type-0 MIDI writer for the Export .mid button.

import { supabase } from '@/lib/supabase'
import { jianpuDuration, canonicalKey, flattenScore, readExpr } from './notes'

// Reasoning effort. Higher can improve accuracy at the cost of latency/tokens.
// "Off" sends no reasoning parameter at all, which is not the same as "low".
export const EFFORTS = [
  { id: 'off', label: 'Off', note: 'no reasoning param' },
  { id: 'low', label: 'Low', note: 'fastest' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High', note: 'most thorough' },
]
export const DEFAULT_EFFORT = 'low'

// Curated, vision-capable models offered in the import dropdown (extensible).
// `efforts` optionally limits the reasoning settings a model is offered;
// `effortWarning` flags a combination that has misbehaved without blocking it.
export const MODELS = [
  {
    id: 'x-ai/grok-4.6',
    label: 'Grok 4.6',
    note: '6 (out)',
    effortWarning: 'Above Low, grok-4.5 has been seen to stop using the answer channel and trickle the '
      + 'transcription out as "reasoning" at a few tokens a second. The rows are still read, but open '
      + 'Details and check the throughput and the provider it routed to — a rate that low is a routing '
      + 'problem, not the model.',
  },
  { id: 'google/gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash Lite', note: 'faster & cheaper' },
  { id: 'google/gemini-3.8-flash', label: 'Gemini 3.8 Flash', note: '3.75 (out) / 0.75 (img)' },
    { id: 'deepseek/deepseek-v4.1-flash', label: 'DeepSeek 4.1 Flash', note: '0.60 (out)' },
]
export const DEFAULT_MODEL = MODELS[0].id

// The effort choices a given model is offered, and a safe fallback when the
// remembered one isn't among them.
export function effortsFor(modelId) {
  const allowed = MODELS.find((m) => m.id === modelId)?.efforts
  return allowed ? EFFORTS.filter((e) => allowed.includes(e.id)) : EFFORTS
}
export function clampEffort(modelId, effort) {
  const list = effortsFor(modelId)
  return list.some((e) => e.id === effort) ? effort : (list[0]?.id || DEFAULT_EFFORT)
}
// A caveat worth showing for this model at this effort, or ''.
export function effortWarning(modelId, effort) {
  if (effort === 'off' || effort === 'low') return ''
  return MODELS.find((m) => m.id === modelId)?.effortWarning || ''
}

// The transcription prompt is assembled from parts so the two source notations
// (jianpu vs western staff) share one output schema. Both modes emit the SAME
// NDJSON jianpu data model — western staff is converted to jianpu degrees
// relative to the detected key on the way out. Lyrics are NOT part of this
// prompt; they have their own pass further down.

const JIANPU_INTRO = `Transcribe the MAIN melody of this jianpu (Chinese numbered notation) score, exactly as printed. The image may be photographed at an angle. Read it row by row, left to right, and reply with JSON objects — one per line, nothing else: no prose, no markdown fences, no summary.`

const WESTERN_INTRO = `Transcribe the MAIN melody of this western sheet music — usually the top staff or the vocal line; ignore piano accompaniment and chord symbols — and convert it to Chinese jianpu numbered notation, exactly as printed. The image may be photographed at an angle. Read it row by row, left to right, and reply with JSON objects — one per line, nothing else: no prose, no markdown fences, no summary.`

const META_SPEC = `FIRST object — the header:
{"type":"meta","title":"","titleEnglish":"","key":"F","timeSignature":"4/4","bpm":88,"rowCount":11,"musicTop":0.10,"musicBottom":0.66}
- title: the printed title in its original script, "" if there is none. titleEnglish: an English translation or romanisation, "" if the title is already English.
- key: {{KEY_HINT}} Spell it as C C# D D# E F F# G G# A A# B — give a flat key as its sharp equivalent (♭B→A#, ♭E→D#, ♭A→G#, ♭D→C#, ♭G→F#).
- timeSignature: as printed (the first one if the meter changes).
- bpm: from a printed metronome mark (♩=120) if there is one; otherwise from the tempo word — 慢板/柔板/Adagio 60, 行板/Andante 76, 中速/中板/Moderato 88, 小快板/稍快/Allegretto 112, 快板/Allegro 132, 急板/Presto 160. Mood words like 深情地 or 欢快地 are not tempo.
- rowCount: how many melody rows follow (an estimate — it drives a progress bar).
- musicTop / musicBottom: where the printed music block sits on the image, as fractions of its height (0 = top edge, 1 = bottom). From the top of the first row of music to the bottom of the last, excluding the title and the blank margin.`

const KEY_HINT_JIANPU = 'read the "1=X" marking.'
const KEY_HINT_WESTERN = 'the tonic of the key signature (2 sharps → D major → "D"; 1 flat → F major → "F"). It becomes jianpu degree 1.'

const ROW_SPEC_JIANPU = `THEN one object per printed melody row, in reading order:
{"row":0,"notes":[{"degree":5,"octave":0,"beats":1}]}
- row: 0-based index of the printed row.
- degree: the printed digit 1-7. Use 0 for a rest.
- octave: octave dots. A dot ABOVE the digit is 1, two dots 2; a dot BELOW is -1, two -2; no dot is 0, the octave of the tonic. These are octave marks, never staccato.
- beats: how long the note lasts. A plain digit is 1 beat, and then:
    · each underline UNDERNEATH the digit halves it — one underline 0.5, two 0.25, three 0.125;
    · each dash "−" printed AFTER the digit adds one beat, so 5 − is 2 beats and 5 − − is 3;
    · an augmentation dot "·" printed AFTER the digit multiplies it by 1.5.
  Underlines and dashes are the two marks most often missed. Check every digit for both.
- accidental: include only when one is printed on that note — 1 sharp (♯), -1 flat (♭), 2 natural (♮).
- articulation: include only when marked — "T" (吐), "TK", "tr", or "grace".

Worked example. A row printed as    5   6̲ 6̲  |  1̇   2̇ −  |  3 ·  5̲    comes out as:
{"row":0,"notes":[{"degree":5,"octave":0,"beats":1},{"degree":6,"octave":0,"beats":0.5},{"degree":6,"octave":0,"beats":0.5},{"degree":1,"octave":1,"beats":1},{"degree":2,"octave":1,"beats":2},{"degree":3,"octave":0,"beats":1.5},{"degree":5,"octave":0,"beats":0.5}]}
because the two 6s carry one underline each (0.5 beats), the 1 and 2 carry a dot above them (octave 1), the 2 is followed by a dash (1+1 = 2), the 3 is followed by an augmentation dot (1 × 1.5), and the last 5 carries an underline. Barlines are not notes and produce nothing.`

const ROW_SPEC_WESTERN = `THEN one object per printed melody row (system), in reading order:
{"row":0,"notes":[{"degree":5,"octave":0,"beats":1}]}
- row: 0-based index of the printed row.
- degree: the jianpu degree. Read the notehead's letter pitch from the clef and its line or space, apply the key signature and any accidental earlier in that bar, then number it from the tonic — in D major D→1, E→2, F♯→3, G→4, A→5, B→6, C♯→7. Use 0 for a rest.
- octave: 0 in the tonic's own octave, 1 an octave above, -1 an octave below.
- beats: from the note value and its dots — whole 4, dotted half 3, half 2, dotted quarter 1.5, quarter 1, eighth 0.5, sixteenth 0.25.
- accidental: a note outside the key's major scale takes its nearest degree and sets this — 1 sharp, -1 flat, 2 natural. F♮ in D major is {"degree":3,"accidental":-1}.
- articulation: include only when marked — "tr" or "grace".

Worked example. In G major (one sharp, tonic G = degree 1), a bar of  G4 quarter · B4 eighth · B4 eighth · D5 half  comes out as:
{"row":0,"notes":[{"degree":1,"octave":0,"beats":1},{"degree":3,"octave":0,"beats":0.5},{"degree":3,"octave":0,"beats":0.5},{"degree":5,"octave":0,"beats":2}]}`

// Expression is opt-in. Asking for it costs attention that is better spent on
// getting the pitches and rhythms right, and it visibly widened the spread
// between models on clean printed scores — so the default pass reads notes only
// and the marks are added by hand, or by turning this on deliberately.
const EXPRESSION_SPEC = `Also record these, but ONLY where you can actually see the mark. Leave the field out otherwise and never guess:
- "tie": true — a curved line joins this note to the next AND both are the same pitch. Keep both notes with their own "beats"; do not merge them.
- "slur": true — the same curved line joins this note to the next at a DIFFERENT pitch. Set it on every note of the group except the last.
- "slideIn": true — a short slanted line runs into this note (a slide onto it).
- "slideOut": "off" — a slanted line trails off the end of the note into nothing. "slideOut": "to" — a slanted line runs across to the next digit.
- "bend": -1 or 1 — a bend down or up and back (压音).
- "vibrato": 1, 2 or 3 — a vibrato mark; 3 is flutter tongue (花舌).`

const RULE_TIES_FOLDED = `Notes joined by a tie count as one note: add their beats together and emit a single note.`
const RULE_TIES_SPLIT = `Notes joined by a curved line stay separate — emit each printed digit and record the link as "tie" or "slur", including across a barline.`

const TAIL = `How to work:
- Go row by row, and within a row measure by measure between the barlines. Finish a row, emit its object immediately, then start the next one. Do not hold the whole score back until the end.
- Transcribe every printed note in order. Never skip one, never reorder them, never invent one, and do not guess at a digit that is perfectly legible.
- Include rests as {"degree":0}. Report the duration each note is printed with and move on — do NOT add beats up, do not reconcile a row against the time signature, and do not try to make bars balance. An uneven bar is fine and is not your problem to fix.
- Keep going to the LAST printed row. Do not stop early or summarise.
- Skip staves that carry no melody, such as a piano-only intro.
- Ignore lyrics, fingering charts and dynamics text: the sung words are read separately.
- Reply with the JSON objects and nothing else — no prose, no code fences, no commentary before or after.`

// Free-text guidance from the person requesting the job, shared by both passes.
function guidanceClause(notes) {
  const g = String(notes || '').trim()
  if (!g) return ''
  return `Extra instructions from the person requesting this — follow them unless they conflict with the output format:\n"""\n${g.slice(0, 1000)}\n"""`
}

// Assemble the transcription prompt for a given source notation.
function buildPrompt({ mode = 'jianpu', expression = false, notes = '' } = {}) {
  const western = mode === 'western'
  return [
    western ? WESTERN_INTRO : JIANPU_INTRO,
    META_SPEC.replace('{{KEY_HINT}}', western ? KEY_HINT_WESTERN : KEY_HINT_JIANPU),
    western ? ROW_SPEC_WESTERN : ROW_SPEC_JIANPU,
    expression ? EXPRESSION_SPEC : '',
    `${TAIL}\n- ${expression ? RULE_TIES_SPLIT : RULE_TIES_FOLDED}`,
    guidanceClause(notes),
  ].filter(Boolean).join('\n\n')
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

// ── Reply validators ─────────────────────────────────────────────────────────
const clampFrac = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Math.min(1, Number(v))) : null)

// The wire schema uses spelled-out field names — "degree", "beats", "octave" —
// because single letters are an odd, low-frequency shape for a model to emit and
// it shows in the output. The stored shape stays short; this is where the two
// meet. Every reader also accepts the old abbreviations so scores and replies
// from before the rename still load.
function pick(obj, names, fallback) {
  for (const n of names) {
    const v = obj?.[n]
    if (v !== undefined && v !== null && v !== '') return v
  }
  return fallback
}

// The meta object → { title, key, bpm, timeSig, expectedLines, contentTop, contentBottom }.
function normalizeMeta(raw) {
  // Any spelling (sharp/flat/enharmonic) folds to its canonical sharp name; an
  // unreadable key falls back to F rather than silently mislabelling the score.
  const key = canonicalKey(pick(raw, ['key'])) || 'F'
  const expected = Math.max(0, Math.min(400, Math.round(Number(pick(raw, ['rowCount', 'lines'], 0))) || 0))
  // Vertical span of the printed music block — positions the on-image marker.
  let top = clampFrac(pick(raw, ['musicTop', 'top']))
  let bottom = clampFrac(pick(raw, ['musicBottom', 'bottom']))
  if (top != null && bottom != null && bottom < top) [top, bottom] = [bottom, top]
  const hasBlock = top != null && bottom != null && bottom - top > 0.05
  const timeSig = String(pick(raw, ['timeSignature', 'timeSig'], '') || '')
  return {
    title: buildTitle(pick(raw, ['title'], ''), pick(raw, ['titleEnglish', 'title_en'], '')),
    key,
    bpm: Math.max(30, Math.min(220, Math.round(Number(pick(raw, ['bpm', 'tempo'], 80))) || 80)),
    timeSig: /^\d+\/\d+$/.test(timeSig) ? timeSig : '4/4',
    expectedLines: expected || null,
    contentTop: hasBlock ? top : null,
    contentBottom: hasBlock ? bottom : null,
  }
}

// A row object → { notes }, or null when it carries no notes.
function normalizeLine(raw) {
  const notes = []
  for (const n of raw?.notes || []) {
    const deg = Math.max(0, Math.min(7, Math.round(Number(pick(n, ['degree', 'deg', 'd'], 0))) || 0))
    const oct = Math.max(-2, Math.min(2, Math.round(Number(pick(n, ['octave', 'oct', 'o'], 0))) || 0))
    const beats = Math.max(0.125, Math.min(16, Number(pick(n, ['beats', 'b'], 1)) || 1))
    const accRaw = Math.round(Number(pick(n, ['accidental', 'acc'], 0)) || 0)
    const acc = accRaw === 1 ? 1 : accRaw === -1 ? -1 : accRaw === 2 ? 2 : 0
    const ly = String(pick(n, ['lyric', 'ly'], '') || '').trim().slice(0, 32)
    const py = String(pick(n, ['pinyin', 'py'], '') || '').trim().slice(0, 32)
    const note = { deg, oct, beats }
    if (acc) note.acc = acc
    if (ly) note.ly = ly
    if (py) note.py = py
    if (deg) {
      // Fold the wire names onto the stored ones, then validate in one place.
      Object.assign(note, readExpr({
        art: pick(n, ['articulation', 'art'], ''),
        ti: pick(n, ['tie', 'ti'], 0),
        sl: pick(n, ['slur', 'sl'], 0),
        gi: pick(n, ['slideIn', 'gi'], 0),
        go: pick(n, ['slideOut', 'go'], ''),
        bd: pick(n, ['bend', 'bd'], 0),
        vb: pick(n, ['vibrato', 'vb'], 0),
      }))
    }
    notes.push(note)
  }
  if (!notes.length) return null
  // A tie whose partner is a different pitch is really a slur — the two print
  // as the same arc, so the model can only guess. flattenScore settles this
  // across row boundaries as well; doing it here keeps the stored data honest.
  for (let i = 0; i < notes.length - 1; i++) {
    const a = notes[i]
    const b = notes[i + 1]
    if (!a.ti) continue
    const samePitch = b.deg === a.deg && (b.oct || 0) === (a.oct || 0) && (b.acc || 0) === (a.acc || 0)
    if (!samePitch) {
      delete a.ti
      if (b.deg) a.sl = 1
    }
  }
  return { notes }
}

// A lyrics-pass row → { i, ly, py, fitted }, or null when it carries no words.
// The arrays are forced to the row's known sounding-note count so a miscounted
// reply lands on the right notes as far as it goes instead of shifting the
// whole row; `fitted` tells the UI that happened.
function normalizeLyricRow(raw, countByRow, pinyin) {
  const i = Math.round(Number(pick(raw, ['row', 'i'], NaN)))
  if (!Number.isInteger(i) || !countByRow.has(i)) return null
  const want = countByRow.get(i)
  const fit = (arr) =>
    Array.from({ length: want }, (_, k) => {
      const v = arr?.[k]
      return typeof v === 'string' ? v.trim().slice(0, 32) : ''
    })
  const rawLy = pick(raw, ['lyrics', 'ly'], null)
  const rawPy = pick(raw, ['pinyin', 'py'], null)
  const ly = fit(rawLy)
  const py = pinyin ? fit(rawPy) : []
  if (!ly.some(Boolean) && !py.some(Boolean)) return null
  const got = Array.isArray(rawLy) ? rawLy.length : 0
  return { i, ly, py, fitted: got !== want }
}

// ── Pulling objects out of the reply ────────────────────────────────────────
// We ask for NDJSON, but models improvise: they pretty-print across several
// lines, they put two objects on one line, they wrap the lot in an array, they
// open with a ```json fence. Splitting the stream on newlines silently dropped
// every one of those — the score came out empty or one row short with no way to
// see why. Matching braces instead reads all of them, and leaves a half-arrived
// object in the buffer for the next chunk.
//
// Returns { objects, rest }: complete JSON object texts, and what's left over.
const MAX_SCAN_BUF = 262144 // give up rather than grow forever on runaway prose

function scanObjects(buf) {
  const objects = []
  let depth = 0
  let start = -1
  let inStr = false
  let esc = false
  let consumed = 0
  for (let i = 0; i < buf.length; i++) {
    const c = buf[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') {
      inStr = true
    } else if (c === '{') {
      if (depth === 0) start = i
      depth++
    } else if (c === '}' && depth > 0) {
      depth--
      if (depth === 0 && start >= 0) {
        objects.push(buf.slice(start, i + 1))
        consumed = i + 1
        start = -1
      }
    }
  }
  // Keep an object that's still arriving; otherwise drop everything up to the
  // next opening brace, so prose and fences between rows don't accumulate.
  let rest
  if (start >= 0) {
    rest = buf.slice(start)
  } else {
    rest = buf.slice(consumed)
    const nextBrace = rest.indexOf('{')
    rest = nextBrace >= 0 ? rest.slice(nextBrace) : ''
  }
  return { objects, rest }
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

// How long the stream may go silent before we call it dead. A reasoning model
// can legitimately think for a while before the first token, so this is
// generous — but not "wait forever", which is what it used to do.
const STALL_MS = 150000

// A model can fall into a repetition loop and sit there emitting the same
// fragment until the request dies — "0.5 0.5 0.5 …" for five minutes. Catching
// it needs no cleverness: if the last stretch of output is one short unit
// repeated exactly, end to end, it is not writing music any more.
//
// Exact periodicity is what keeps this from firing on real output: consecutive
// notes share long substrings but always differ somewhere in the digits.
const LOOP_WINDOW = 240
function loopedPattern(tail) {
  if (tail.length < LOOP_WINDOW) return ''
  const s = tail.slice(-LOOP_WINDOW)
  for (let unit = 1; unit <= 12; unit++) {
    if (LOOP_WINDOW % unit) continue
    const pat = s.slice(-unit)
    if (!pat.trim()) continue
    let repeats = true
    for (let at = s.length - unit * 2; at >= 0; at -= unit) {
      if (s.slice(at, at + unit) !== pat) { repeats = false; break }
    }
    if (repeats) return pat
  }
  return ''
}

// Open the streamed function, parse SSE → JSON objects, dispatch meta/lines.
// Resolves { meta, lines, truncated, usage, stats }. `expectMeta:false` treats
// every object as a line (used by continuations, which must not re-emit meta).
// `normalize` swaps in a different row validator — that is all the lyrics pass
// needs to reuse this transport.
//
// `onTrace` gets every event on the wire: what was sent, when the first byte
// came back, each reasoning/content delta, each object parsed and each one that
// failed to. Without it a stalled or malformed stream is indistinguishable from
// a slow model, which is exactly the hole this used to have.
async function runStream({
  prompt, dataUri, model, effort, signal, label = 'transcription',
  expectMeta = true, normalize = normalizeLine,
  onMeta, onLine, onProgress, onReasoning, onTrace, onReset,
}) {
  const t0 = Date.now()
  const stats = {
    label,
    model,
    effort,
    promptChars: prompt.length,
    imageChars: dataUri?.length || 0,
    startedAt: t0,
    firstByteMs: null,
    firstContentMs: null,
    lastByteAt: t0,
    bytes: 0,
    sseEvents: 0,
    contentChars: 0,
    reasoningChars: 0,
    objects: 0,
    badObjects: 0,
    rows: 0,
    rowsFromReasoning: 0,
    requestId: '',
    provider: '',
    servedModel: '',
    finishReason: null,
    looped: '',
    outputTokens: 0,
    reasoningTokens: 0,
    promptTokens: 0,
    error: '',
  }
  const trace = (kind, text) => onTrace?.({ at: Date.now() - t0, kind, text: text ?? '', stats })

  trace('request', `POST ${functionUrl()}\nmodel=${model} effort=${effort} image=${fmtBytes(stats.imageChars)} prompt=${prompt.length} chars`)
  trace('prompt', prompt)

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
    stats.error = String(e?.message || e)
    trace('error', `Could not reach the edge function: ${stats.error}`)
    throw new Error(`Could not reach the transcription service: ${e?.message || e}`)
  }

  // The function forwards OpenRouter's request id — the one thing that lets a
  // run be looked up in their dashboard when no generation was recorded.
  // OpenRouter doesn't put its id on the streaming response headers, so the
  // header is only a bonus — the reliable source is `id` on the first chunk.
  stats.requestId = res.headers.get('x-openrouter-id') || ''
  stats.upstreamMs = Number(res.headers.get('x-upstream-ms')) || null
  const proxied = res.headers.has('x-upstream-ms')
  trace('response', `HTTP ${res.status} ${res.headers.get('content-type') || ''}`
    + (stats.requestId
      ? `\nOpenRouter id: ${stats.requestId}`
      : `\nOpenRouter id: arrives with the first chunk${proxied ? '' : ' — bawu-ai is out of date, run: npm run deploy:bawu-ai'}`)
    + (stats.upstreamMs ? `\nupstream connect: ${stats.upstreamMs} ms` : ''))

  if (!res.ok || !res.body) {
    let detail = ''
    let raw = ''
    try {
      raw = await res.text()
      detail = JSON.parse(raw)?.error || ''
    } catch { /* not JSON */ }
    console.error('[Bawu] bawu-ai error', res.status, detail || raw)
    stats.error = detail || raw
    trace('error', `HTTP ${res.status}\n${(detail || raw).slice(0, 2000)}`)
    throw new Error(detail ? `${detail} (HTTP ${res.status})` : `AI request failed (HTTP ${res.status}).`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let sseBuf = '' // raw SSE text buffer
  let contentBuf = '' // answer channel, waiting to be scanned for objects
  let reasonBuf = '' // reasoning channel, ditto — see below
  let contentSeen = '' // a tail of everything the model said, for error reports
  let usage = null
  let meta = null
  let metaSource = ''
  let sawReasoning = false
  let rowsFromReasoning = 0
  const lines = []

  const dispatchObject = (raw, source) => {
    let obj
    try {
      obj = JSON.parse(raw)
    } catch {
      stats.badObjects++
      trace('bad', raw.slice(0, 400))
      return
    }
    stats.objects++
    // Some models answer with one wrapper object holding every row instead of
    // streaming them — read that too rather than losing the whole reply.
    const nested = obj?.lines || obj?.rows || obj?.data
    if (Array.isArray(nested) && !Array.isArray(obj.notes)) {
      trace('note', `unwrapping ${nested.length} rows from a wrapper object`)
      for (const item of nested) dispatchParsed(item, source)
      return
    }
    dispatchParsed(obj, source)
  }

  const dispatchParsed = (obj, source) => {
    if (!obj || typeof obj !== 'object') return
    // The answer channel is authoritative. If it starts producing after the
    // reasoning channel already did, what came out of reasoning was scratch
    // work — bin it and start the score again from the real answer.
    if (source === 'content' && rowsFromReasoning) {
      trace('note', `answer channel took over — discarding ${rowsFromReasoning} row(s) read out of the reasoning channel`)
      lines.length = 0
      stats.rows = 0
      rowsFromReasoning = 0
      if (metaSource === 'reasoning') { meta = null; metaSource = '' }
      onReset?.()
    }
    if (expectMeta && meta === null && looksLikeMeta(obj)) {
      meta = normalizeMeta(obj)
      metaSource = source
      trace('meta', JSON.stringify(meta))
      onMeta?.(meta)
      return
    }
    const line = normalize(obj)
    if (line) {
      if (source === 'reasoning') rowsFromReasoning++
      lines.push(line)
      stats.rows = lines.length
      stats.rowsFromReasoning = rowsFromReasoning
      trace('row', `row ${lines.length}${source === 'reasoning' ? ' (from reasoning)' : ''}: ${JSON.stringify(line).slice(0, 300)}`)
      onLine?.(line, lines.length)
    } else {
      trace('skip', `object produced no row: ${JSON.stringify(obj).slice(0, 300)}`)
    }
  }

  const drain = (source) => {
    if (source === 'content') {
      const { objects, rest } = scanObjects(contentBuf)
      contentBuf = rest.length > MAX_SCAN_BUF ? '' : rest
      for (const raw of objects) dispatchObject(raw, 'content')
    } else {
      const { objects, rest } = scanObjects(reasonBuf)
      reasonBuf = rest.length > MAX_SCAN_BUF ? '' : rest
      for (const raw of objects) dispatchObject(raw, 'reasoning')
    }
  }

  // Watchdog: cancel a stream that has gone quiet, so a dead connection surfaces
  // as an error instead of an indefinite spinner.
  let stalled = false
  const watchdog = setInterval(() => {
    if (Date.now() - stats.lastByteAt < STALL_MS) return
    stalled = true
    trace('error', `no data for ${Math.round((Date.now() - stats.lastByteAt) / 1000)}s — giving up`)
    reader.cancel().catch(() => {})
  }, 5000)

  // Loop guard: watch the tail of whichever channel is producing and stop the
  // moment it degenerates into repetition, instead of paying for minutes of it.
  let loopTail = ''
  let looped = ''
  const checkLoop = (text) => {
    if (looped) return
    loopTail = (loopTail + text).slice(-LOOP_WINDOW * 2)
    const pat = loopedPattern(loopTail)
    if (!pat) return
    looped = pat
    stats.looped = pat
    trace('error', `stuck repeating ${JSON.stringify(pat)} — ending the request`)
    reader.cancel().catch(() => {})
  }

  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      stats.lastByteAt = Date.now()
      stats.bytes += value.byteLength
      if (stats.firstByteMs == null) {
        stats.firstByteMs = Date.now() - t0
        trace('open', `first byte after ${stats.firstByteMs} ms`)
      }
      sseBuf += decoder.decode(value, { stream: true })
      let idx
      while ((idx = sseBuf.indexOf('\n')) >= 0) {
        const rawLine = sseBuf.slice(0, idx).replace(/\r$/, '')
        sseBuf = sseBuf.slice(idx + 1)
        if (!rawLine) continue
        if (rawLine.startsWith(':')) {
          trace('keepalive', rawLine.slice(0, 120)) // ": OPENROUTER PROCESSING"
          continue
        }
        if (!rawLine.startsWith('data:')) {
          trace('sse', rawLine.slice(0, 200))
          continue
        }
        const payload = rawLine.slice(5).trim()
        if (payload === '[DONE]') {
          trace('done', '[DONE]')
          continue
        }
        stats.sseEvents++
        let chunk
        try {
          chunk = JSON.parse(payload)
        } catch {
          trace('bad', `unparseable SSE payload: ${payload.slice(0, 300)}`)
          continue
        }
        if (chunk?.error) {
          const msg = chunk.error?.message || JSON.stringify(chunk.error)
          stats.error = msg
          trace('error', `error inside the stream: ${msg}`)
        }
        if (chunk?.id && !stats.requestId) stats.requestId = chunk.id
        // Which provider OpenRouter actually routed to, and the model it
        // resolved. A silent reroute is the likeliest explanation for a fast
        // model suddenly generating at a crawl, so it belongs on screen.
        if (chunk?.provider && chunk.provider !== stats.provider) {
          stats.provider = chunk.provider
          trace('note', `served by provider: ${chunk.provider}${chunk.model && chunk.model !== model ? ` (as ${chunk.model})` : ''}`)
        }
        if (chunk?.model && !stats.servedModel) stats.servedModel = chunk.model
        if (chunk?.usage) {
          usage = chunk.usage
          // Real token counts beat the chars÷4 estimate for judging throughput,
          // and the reasoning split shows where a slow run spent itself.
          stats.outputTokens = Number(usage.completion_tokens) || 0
          stats.reasoningTokens = Number(usage.completion_tokens_details?.reasoning_tokens) || 0
          stats.promptTokens = Number(usage.prompt_tokens) || 0
          trace('usage', JSON.stringify(usage))
        }
        const choice = chunk?.choices?.[0]
        const delta = choice?.delta
        // Some providers put the whole answer in the REASONING channel and never
        // emit a content token at all — grok-4.5 through OpenRouter does exactly
        // that at higher efforts, streaming rows of JSON labelled as reasoning.
        // Reading only `content` threw all of it away, so the run looked like an
        // endless think that produced nothing. Mine reasoning too, but only
        // while the answer channel is silent.
        const reasoning = delta?.reasoning || delta?.reasoning_content
        if (typeof reasoning === 'string' && reasoning) {
          stats.reasoningChars += reasoning.length
          trace('reasoning', reasoning)
          if (!sawReasoning) {
            sawReasoning = true
            onReasoning?.()
          }
          if (!stats.contentChars) {
            reasonBuf += reasoning
            contentSeen = (contentSeen + reasoning).slice(-4000)
            drain('reasoning')
            if (lines.length) onProgress?.({ lines: lines.length })
          }
          checkLoop(reasoning)
        }
        if (typeof delta?.content === 'string' && delta.content) {
          if (stats.firstContentMs == null) {
            stats.firstContentMs = Date.now() - t0
            trace('open', `first content token after ${stats.firstContentMs} ms`)
            reasonBuf = '' // the answer channel is live; stop mining reasoning
          }
          stats.contentChars += delta.content.length
          trace('content', delta.content)
          contentBuf += delta.content
          contentSeen = (contentSeen + delta.content).slice(-4000)
          drain('content')
          onProgress?.({ lines: lines.length })
          checkLoop(delta.content)
        }
        if (choice?.finish_reason) {
          stats.finishReason = choice.finish_reason
          trace('finish', choice.finish_reason)
        }
      }
    }
  } finally {
    clearInterval(watchdog)
  }

  // Whatever is left may still be a complete object the stream ended without a
  // trailing newline; a genuinely truncated one simply won't parse.
  drain('content')
  if (!stats.contentChars) drain('reasoning')
  const leftover = contentBuf.trim() || reasonBuf.trim()
  if (leftover) trace('note', `${leftover.length} chars left unparsed at the end`)
  if (rowsFromReasoning) {
    trace('note', `${rowsFromReasoning} row(s) were recovered from the reasoning channel — this model never used the answer channel`)
  }

  if (looped) {
    throw new Error(
      `${model} fell into a repetition loop, emitting ${JSON.stringify(looped)} over and over, so the request was ended`
      + (lines.length ? ` — ${lines.length} row(s) arrived first.` : '.')
      + ' Try a lower thinking setting or a different model.',
    )
  }
  if (stalled) {
    throw new Error(
      `The model stopped sending data for ${Math.round(STALL_MS / 1000)}s and the request was dropped`
      + (lines.length ? ` — ${lines.length} row(s) arrived first.` : '.'),
    )
  }
  // An error delivered inside the stream (an upstream failure, or bawu-ai
  // closing on its wall-clock deadline) is only fatal if nothing survived it.
  if (stats.error && !lines.length) throw new Error(stats.error)
  // Text arrived but nothing came out of it: that is a format problem, not an
  // empty score, so say so and hand back what the model actually wrote.
  if (!lines.length && (stats.contentChars > 0 || stats.reasoningChars > 0)) {
    const where = stats.contentChars ? 'answer' : 'reasoning'
    trace('error', `${stats.contentChars || stats.reasoningChars} chars in the ${where} channel produced no rows`)
    const sample = contentSeen.trim().slice(-300)
    throw new Error(`The model replied but nothing parsed as a melody row. It ended with: ${sample || '(only whitespace)'}`)
  }

  return { meta, lines, truncated: stats.finishReason === 'length', usage, stats }
}

function fmtBytes(n) {
  if (!n) return '0 B'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

// Stream a fresh conversion. Callbacks fire as data arrives; the promise
// resolves with the assembled score. `signal` aborts the request.
// Returns { title, data, meta, truncated, expectedLines }.
export async function convertImageStream(dataUri, {
  model = DEFAULT_MODEL,
  effort = DEFAULT_EFFORT,
  mode = 'jianpu',
  expression = false,
  notes = '',
  signal,
  onMeta,
  onLine,
  onProgress,
  onReasoning,
  onTrace,
  onReset,
} = {}) {
  const { meta, lines, truncated, usage, stats } = await runStream({
    prompt: buildPrompt({ mode, expression, notes }),
    dataUri, model, effort, signal, label: 'notes',
    onMeta, onLine, onProgress, onReasoning, onTrace, onReset,
  })
  if (!lines.length && !truncated) throw new Error('The AI found no notes in the image.')
  const m = meta || normalizeMeta({})
  return {
    title: m.title,
    truncated,
    stats,
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
  expression = false,
  notes = '',
  signal,
  onLine,
  onProgress,
  onReasoning,
  onTrace,
} = {}) {
  const done = existing?.data?.lines?.length || 0
  const prompt = `${buildPrompt({ mode, expression, notes })}

CONTINUATION: You already transcribed the first ${done} melody row(s) of this exact image. Do NOT repeat them and do NOT output the meta line again. Resume at row index ${done} (0-based) and continue in the SAME format — one object per row — until the piece ends.`
  const { lines, truncated, usage, stats } = await runStream({
    prompt, dataUri, model, effort, signal, expectMeta: false, label: 'continue',
    onLine, onProgress, onReasoning, onTrace,
  })
  return { lines, truncated, usage, stats }
}

// ── Lyrics pass ─────────────────────────────────────────────────────────────
// A second look at the SAME picture that reads only the sung words. The melody
// is already known, so it goes into the prompt as an outline: the model is told
// exactly how many syllables each row needs, which is what makes the reply
// line up without any fuzzy matching on this side.

// One entry per row that actually has notes: { i, count, text }. Rows of pure
// rests drop out, but every row keeps its real index so the result still maps
// straight back onto data.lines.
function lyricRowOutline(data) {
  return (data?.lines || [])
    .map((line, i) => ({
      i,
      count: (line.notes || []).filter((n) => n.deg).length,
      text: lineToTokens(line).join(' '),
    }))
    .filter((r) => r.count > 0)
}

function buildLyricsPrompt({ rows, pinyin = false, notes = '' }) {
  const intro = `You are reading the SUNG LYRICS printed underneath the melody of this score, which may be photographed at an angle. The melody has ALREADY been transcribed — do not re-read the notes, do not report pitches, rhythms or a key. Your ONLY job is the words, and lining them up with the notes that are already known.`

  const outline = `The melody, row by row. Each row shows the digits as printed and how many SOUNDING notes it contains (rests are not counted and never take a syllable):
${rows.map((r) => `Row ${r.i} (${r.count} notes): ${r.text}`).join('\n')}`

  const shape = pinyin
    ? `{"row":0,"lyrics":["月","亮","",""],"pinyin":["yuè","liàng","",""]}`
    : `{"row":0,"lyrics":["月","亮","",""]}`

  const spec = `Reply with JSON objects, one per line, one line per melody row, in reading order — no markdown fences, no commentary, nothing else:
${shape}
- "row": the row index from the list above. Use those exact numbers, and skip a row entirely if it carries no words.
- "lyrics": one entry per SOUNDING note in that row, left to right. The array MUST contain exactly as many entries as that row's note count above.
- A note with no syllable of its own gets "" — that covers a melisma continuation (the word before is held across it), an instrumental note, and any note printed with no text under it.
- Keep the original script exactly as printed. One syllable per entry; never merge two syllables into one entry or split one across two.`

  const pinyinClause = pinyin
    ? `ALSO give "pinyin": the tone-marked Hanyu Pinyin for that same syllable (so "lyrics":"月" → "pinyin":"yuè"). Use the tone marks ā á ǎ à, not tone numbers. Where "lyrics" is "", "pinyin" is "". If the lyric is already in a Latin script, copy it across unchanged. The two arrays must be the same length.`
    : `Do not output a "pinyin" field.`

  const tail = `If a row's words are illegible, emit "" for those notes rather than guessing or shifting the rest of the row. Count the entries against the note count before you emit each line. Output ONLY NDJSON.`

  return [intro, outline, spec, pinyinClause, guidanceClause(notes), tail].filter(Boolean).join('\n\n')
}

// Read the lyrics for an already-transcribed score. Resolves
// { rows, truncated, meta }; `rows` is what mergeLyrics() consumes.
export async function convertLyricsStream(dataUri, data, {
  model = DEFAULT_MODEL,
  effort = DEFAULT_EFFORT,
  pinyin = true,
  notes = '',
  signal,
  onRow,
  onProgress,
  onReasoning,
  onTrace,
} = {}) {
  const rows = lyricRowOutline(data)
  if (!rows.length) throw new Error('There are no notes here to attach lyrics to.')
  const countByRow = new Map(rows.map((r) => [r.i, r.count]))
  const { lines, truncated, usage, stats } = await runStream({
    prompt: buildLyricsPrompt({ rows, pinyin, notes }),
    dataUri,
    model,
    effort,
    signal,
    label: 'lyrics',
    expectMeta: false,
    normalize: (obj) => normalizeLyricRow(obj, countByRow, pinyin),
    onLine: onRow,
    onProgress,
    onReasoning,
    onTrace,
  })
  if (!lines.length) throw new Error('The AI found no lyrics printed under these notes.')
  return { rows: lines, expectedRows: rows.length, truncated, stats, meta: { model, effort, usage: usage || null, truncated } }
}

// ── Manual jianpu text ──────────────────────────────────────────────────────
// One line of text per printed line of music. Tokens separated by spaces;
// barlines (|) are ignored. Syntax per token:
//   1..7   note        0      rest
//   '      high-octave dot (5')      ,   low-octave dot (5,)
//   -      as its own token: extend the previous note by 1 beat
//   .      dotted, 1.5x (5.)         _   halve, may repeat (5_ = ½, 5__ = ¼)
//   #5 b5 n5   sharp / flat / natural accidental prefix
// Expression:
//   /5     glissando INTO the note      5\   glide off the end of the note
//   5>     glissando to the next note   5=   tied to the next note (same pitch)
//   5~     slurred to the next note (different pitch)
//   5(…)   comma-separated tags: an articulation (T, TK, tr, grace/gr),
//          bd±N (bend in semitones) and vbN (vibrato depth 0-3) — e.g. 5(tr,bd-1,vb2)
// Optional header anywhere: 1=F  4/4  bpm=80
//
// scoreToJianpuText() is the exact inverse — it serialises score data back into
// this format, so a copy → hand-edit → paste round-trip is lossless.
// A token match's expression groups → the raw object readExpr() validates.
function parseExprToken(m) {
  const e = {}
  if (m[1]) e.gi = 1
  if (m[8] === '\\') e.go = 'off'
  else if (m[8] === '>') e.go = 'to'
  if (m[9] === '=') e.ti = 1
  else if (m[9] === '~') e.sl = 1
  for (const raw of String(m[10] || '').split(',')) {
    const tag = raw.trim()
    if (!tag) continue
    const bd = tag.match(/^bd\s*([+-]?\d+(?:\.\d+)?)$/i)
    const vb = tag.match(/^vb\s*(\d)$/i)
    if (bd) e.bd = Number(bd[1])
    else if (vb) e.vb = Number(vb[1])
    else e.art = tag === 'gr' ? 'grace' : tag
  }
  return e
}

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
    const isHeader = (keyM || bpmM) && !/^[\w\s|'’,.()#+/\\>=~-]+$/.test(line.replace(/1\s*=\s*[A-Ga-g][b#♭♯]?/g, '').replace(/bpm\s*=?\s*\d+/gi, ''))
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
      //          gi  acc     deg     oct-hi  oct-lo dot  halves  go     link  tags
      const m = tok.match(/^(\/?)([#bn]?)([0-7])(['’]*)(,*)(\.?)(_*)([\\>]?)([=~]?)(?:\(([^()]*)\))?$/)
      if (!m) continue
      const deg = Number(m[3])
      const oct = m[4].length - m[5].length
      let beats = 1
      if (m[7]) beats = 1 / Math.pow(2, m[7].length)
      if (m[6]) beats *= 1.5
      const note = { deg, oct, beats }
      const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : m[2] === 'n' ? 2 : 0
      if (acc) note.acc = acc
      if (deg) Object.assign(note, readExpr(parseExprToken(m)))
      notes.push(note)
    }
    if (notes.length) lines.push({ notes })
  }
  if (!lines.length) throw new Error('No notes found — type jianpu like:  5, 6, 1 2 | 3 - 5 3')
  return { data: { key, bpm, timeSig, lines } }
}

// One stored line → its manual-jianpu tokens. Shared by scoreToJianpuText()
// and the lyrics pass, which shows the model the row it has to align against.
export function lineToTokens(line) {
  const toks = []
  for (const n of line?.notes || []) {
    const d = jianpuDuration(n.beats)
    let core
    if (!n.deg) {
      core = '0'
    } else {
      const acc = n.acc === 1 ? '#' : n.acc === -1 ? 'b' : n.acc === 2 ? 'n' : ''
      const oct = n.oct > 0 ? "'".repeat(n.oct) : n.oct < 0 ? ','.repeat(-n.oct) : ''
      core = acc + n.deg + oct
    }
    // Order matches parseManualJianpu's token regex: gliss-in prefix, then the
    // core, dot, underlines, release glide, link, tags.
    if (d.dot) core += '.'
    if (d.underlines) core += '_'.repeat(d.underlines)
    if (n.deg) {
      if (n.gi) core = '/' + core
      if (n.go === 'off') core += '\\'
      else if (n.go === 'to') core += '>'
      if (n.ti) core += '='
      else if (n.sl) core += '~'
      const tags = []
      if (n.art) tags.push(n.art)
      if (n.bd) tags.push(`bd${n.bd > 0 ? '+' : ''}${n.bd}`)
      if (n.vb) tags.push(`vb${n.vb}`)
      if (tags.length) core += `(${tags.join(',')})`
    }
    toks.push(core)
    for (let i = 0; i < d.dashes; i++) toks.push('-')
  }
  return toks
}

// Serialise score data back into the manual-jianpu text above. The duration
// decorations come from jianpuDuration() so they decode to the same beat values
// parseManualJianpu() produces — a clean round-trip for copy → edit → paste.
export function scoreToJianpuText(data) {
  const key = data?.key || 'F'
  const bpm = data?.bpm || 80
  const timeSig = data?.timeSig || '4/4'
  const body = (data?.lines || []).map((line) => lineToTokens(line).join(' '))
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
  // Walk the flattened timeline rather than the raw lines: ties are printed as
  // separate notes but sound as one, so a chain has to export as a single
  // note-on/note-off pair instead of re-articulating on every printed digit.
  const { notes } = flattenScore(data, key || data?.key || 'F')
  for (const n of notes) {
    const dur = Math.round((Number(n.beats) || 1) * TPQ)
    if (!n.rest && n.midi != null && !n.tiedIn) {
      const sound = Math.round((n.soundBeats || n.beats) * TPQ)
      push(tick, [0x90, n.midi, 88])
      push(tick + Math.max(1, sound - 10), [0x80, n.midi, 0])
    }
    tick += dur
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
