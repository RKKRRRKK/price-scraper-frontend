// Bawu AI proxy — a thin, stateless bridge to OpenRouter for jianpu / staff
// notation transcription (mirrors canvy-ai).
//
// The client (BawuImportModal) sends the transcription prompt + the score
// picture; this function forwards one turn to OpenRouter and STREAMS the model's
// reply straight back (Server-Sent Events) so the client can render the score
// line-by-line. The OpenRouter key stays here as a secret so it never reaches
// the client bundle.
//
// Deploy:  supabase functions deploy bawu-ai
// Secret:  supabase secrets set OPENROUTER_JIANPU_KEY=<the "Jianpu" OpenRouter key>

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
const DEFAULT_MODEL = 'x-ai/grok-4.5'

// Whether a model is worth handing a default `reasoning` param when the client
// doesn't pick an effort (an explicit effort from the client always wins).
function supportsReasoning(model: string) {
  return /grok|gemini|o1|o3|o4|deepseek-r|thinking|reason/i.test(model)
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  // The client reads these to correlate a run with OpenRouter's dashboard and to
  // tell "the model is thinking" apart from "the connection is dead".
  'Access-Control-Expose-Headers': 'x-openrouter-id, x-upstream-ms',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  console.log('[bawu-ai] request received')
  const apiKey = Deno.env.get('OPENROUTER_JIANPU_KEY')
  if (!apiKey) {
    console.error('[bawu-ai] OPENROUTER_JIANPU_KEY secret is missing')
    return json({ error: 'OPENROUTER_JIANPU_KEY is not configured on the server. Run: supabase secrets set OPENROUTER_JIANPU_KEY=<key>' }, 500)
  }

  let payload: { prompt?: string; imageBase64?: string; model?: string; effort?: string }
  try {
    payload = await req.json()
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400)
  }

  const { prompt, imageBase64, model, effort } = payload
  if (!prompt || typeof prompt !== 'string') {
    return json({ error: 'Missing "prompt".' }, 400)
  }
  if (!imageBase64 || typeof imageBase64 !== 'string') {
    return json({ error: 'Missing "imageBase64" — transcription needs the score picture.' }, 400)
  }

  const useModel = model || DEFAULT_MODEL
  const reqId = crypto.randomUUID().slice(0, 8)
  const t0 = Date.now()
  // Log enough to answer "what did the model actually get?" from the Supabase
  // logs alone, without having to reproduce the run.
  console.log(`[bawu-ai ${reqId}] → OpenRouter model=${useModel} imageBytes=${imageBase64.length} promptChars=${prompt.length} (streaming)`)
  console.log(`[bawu-ai ${reqId}] prompt head: ${prompt.slice(0, 600).replace(/\n/g, ' ⏎ ')}`)
  console.log(`[bawu-ai ${reqId}] prompt tail: ${prompt.slice(-400).replace(/\n/g, ' ⏎ ')}`)

  const body: Record<string, unknown> = {
    model: useModel,
    stream: true,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: imageBase64 } },
        ],
      },
    ],
    // Generous ceiling: streaming means a truncation is non-fatal (the client
    // keeps every complete NDJSON line it received and offers "Continue"), but
    // give the model plenty of room so a whole score fits in one pass.
    max_tokens: 32000,
    // Token counts + real credit cost arrive in a final usage SSE chunk.
    usage: { include: true },
  }
  // Reasoning effort: an explicit choice from the client wins (lets the user
  // dial Gemini up or hold grok down); otherwise default reasoning-capable
  // models to 'low' so grok-4.5 doesn't spiral into a 3-min think. 'off' skips.
  const validEffort = ['low', 'medium', 'high'].includes(String(effort))
  if (validEffort) {
    body.reasoning = { effort }
  } else if (effort !== 'off' && supportsReasoning(useModel)) {
    body.reasoning = { effort: 'low' }
  }
  console.log(`[bawu-ai ${reqId}] effort=${validEffort ? effort : effort === 'off' ? 'off' : 'default'}`)

  let upstream: Response
  try {
    upstream = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'X-Title': 'Bawu',
      },
      body: JSON.stringify(body),
    })
  } catch (e) {
    console.error(`[bawu-ai ${reqId}] fetch to OpenRouter failed:`, e)
    return json({ error: `Could not reach OpenRouter: ${e instanceof Error ? e.message : String(e)}` }, 502)
  }

  const upstreamMs = Date.now() - t0
  // OpenRouter's own id for the generation. Forwarding it is the only way to
  // find a run in their dashboard when the generation never got recorded.
  const openrouterId = upstream.headers.get('x-request-id')
    || upstream.headers.get('x-openrouter-id')
    || ''
  console.log(`[bawu-ai ${reqId}] upstream ${upstream.status} in ${upstreamMs}ms id=${openrouterId || '(none)'}`)

  // On a non-2xx, OpenRouter sends a normal JSON error body (not a stream) — read
  // it and return a clean JSON error the client can surface.
  if (!upstream.ok || !upstream.body) {
    const raw = await upstream.text()
    let detail = raw
    try {
      detail = JSON.parse(raw)?.error?.message || raw
    } catch { /* keep raw */ }
    console.error(`[bawu-ai ${reqId}] OpenRouter error ${upstream.status}: ${detail}`)
    return json({ error: `OpenRouter error (${upstream.status}): ${detail}` }, upstream.status || 502)
  }

  // Count the stream on its way through. The bytes never buffer — each chunk is
  // forwarded as it arrives — but the totals land in the Supabase logs, which is
  // what tells you whether a silent run got nothing or got plenty and the client
  // failed to read it.
  let bytes = 0
  let chunks = 0
  let firstChunkMs: number | null = null
  const counter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      if (firstChunkMs === null) {
        firstChunkMs = Date.now() - t0
        console.log(`[bawu-ai ${reqId}] first upstream chunk at ${firstChunkMs}ms`)
      }
      bytes += chunk.byteLength
      chunks++
      controller.enqueue(chunk)
    },
    flush() {
      console.log(`[bawu-ai ${reqId}] stream finished: ${bytes} bytes in ${chunks} chunks over ${Date.now() - t0}ms`)
    },
  })

  console.log(`[bawu-ai ${reqId}] streaming response through to client`)
  return new Response(upstream.body.pipeThrough(counter), {
    status: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Openrouter-Id': openrouterId,
      'X-Upstream-Ms': String(upstreamMs),
    },
  })
})
