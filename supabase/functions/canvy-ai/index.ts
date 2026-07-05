// Canvy AI proxy — a thin, stateless bridge to OpenRouter's vision models.
//
// The client (CanvyView) drives the whole generate → apply → screenshot → verify
// loop, because only the browser can render the board and re-screenshot it. This
// function just forwards one turn: a text prompt + one screenshot in, model text
// out. The OpenRouter API key stays here (as the OPENROUTER_API_KEY secret) so it
// never reaches the client bundle.
//
// Deploy:  supabase functions deploy canvy-ai
// Secret:  supabase secrets set OPENROUTER_API_KEY=<your-openrouter-key>

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
const DEFAULT_MODEL = 'google/gemini-3.5-flash'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

  const apiKey = Deno.env.get('OPENROUTER_API_KEY')
  if (!apiKey) return json({ error: 'OPENROUTER_API_KEY is not configured on the server.' }, 500)

  let payload: { prompt?: string; imageBase64?: string; model?: string }
  try {
    payload = await req.json()
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400)
  }

  const { prompt, imageBase64, model } = payload
  if (!prompt || typeof prompt !== 'string') {
    return json({ error: 'Missing "prompt".' }, 400)
  }

  // The board screenshot is optional (the first constructive turn can run without
  // one), but when present it must be a data: URI the vision model can read.
  const content: Array<Record<string, unknown>> = [{ type: 'text', text: prompt }]
  if (imageBase64 && typeof imageBase64 === 'string') {
    content.push({ type: 'image_url', image_url: { url: imageBase64 } })
  }

  let upstream: Response
  try {
    upstream = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        // OpenRouter uses these for attribution/rankings; harmless if generic.
        'HTTP-Referer': 'https://canvy.app',
        'X-Title': 'Canvy',
      },
      body: JSON.stringify({
        model: model || DEFAULT_MODEL,
        messages: [{ role: 'user', content }],
        // Ask OpenRouter to include token counts + the actual credit cost of the
        // call so the client can show/log real spend.
        usage: { include: true },
      }),
    })
  } catch (e) {
    return json({ error: `Could not reach OpenRouter: ${e instanceof Error ? e.message : String(e)}` }, 502)
  }

  const raw = await upstream.text()
  if (!upstream.ok) {
    // Bubble the upstream status + body so the client can show a real message.
    let detail = raw
    try {
      detail = JSON.parse(raw)?.error?.message || raw
    } catch { /* keep raw */ }
    return json({ error: `OpenRouter error (${upstream.status}): ${detail}` }, upstream.status)
  }

  let data: { choices?: Array<{ message?: { content?: string } }>; usage?: unknown }
  try {
    data = JSON.parse(raw)
  } catch {
    return json({ error: 'OpenRouter returned a non-JSON response.' }, 502)
  }

  const text = data?.choices?.[0]?.message?.content
  if (typeof text !== 'string') {
    return json({ error: 'OpenRouter returned no message content.' }, 502)
  }

  // `usage` carries prompt/completion token counts and (with usage.include) the
  // real credit cost; the client logs + displays it.
  return json({ text, usage: data?.usage ?? null })
})
