# Canvy tool

A Miro-style **whiteboard** under the **Tools** nav section (`/canvy`). Boards hold sticky
notes, text blocks, shapes, freehand drawings, connecting arrows and comment pins. Boards live
in folders and persist to Supabase. Every board carries a stable **Main** copy plus a working
**Branch**; AI edits land in the branch so you can review before merging.

There are two ways to get AI help:

- **Run with AI** (direct) — sends the board (as a **compact op-DSL**, not full JSON) **plus a
  screenshot** to Gemini via a Supabase Edge Function. The model replies with a short list of
  **edit commands** (add/mov/set/del/arw/cmt/back/front…); the app applies them to the branch, then
  screenshots the *result* and sends it back so the model can see what its blind edits actually
  rendered to and correct itself. An optional **steering** box lets you paste a plan from a
  stronger chat model for the small model to execute. The model can write a short **note** of
  what it did (`!` lines) and **flag real problems** (`?` lines — broken screenshot, serious
  inference, something it believes is wrong), both surfaced in the modal. Every call is logged
  (console + in-app panel + optional local-folder dump); token counts and cost are shown.
- **Manual copy/paste** — copy a prompt (board JSON + schema + rules), paste it into any chat,
  paste the reply back. Unchanged; a fallback that needs no server/keys.

There's also **Copy for AI** (human-readable summary). Miro interop is automatic: a
plain **Ctrl+C** copies the selection and **Ctrl+V** pastes it — the clipboard carries
both a lossless native Canvy payload and the equivalent Miro payload, so the same copy
pastes inside Canvy (exact) or straight into miro.com, and Miro copies paste back in.

---

## Setup (one-time)

1. **Database** — the table is **not** auto-migrated. Run once in the Supabase SQL editor:
   [`supabase/canvy_schema.sql`](../../../supabase/canvy_schema.sql) — `public.canvy_boards` +
   `public.canvy_folders` (owner RLS + the whitelisted-user restrictive policy, same pattern as
   Diffy/Breadly). Until it's run the UI works but boards won't save/load.

2. **Edge Function** (only needed for **Run with AI**) — deploy the OpenRouter proxy and give it
   the API key:
   ```bash
   supabase functions deploy canvy-ai
   supabase secrets set OPENROUTER_API_KEY=<your-openrouter-key>
   ```
   Or via the dashboard: **Edge Functions → create `canvy-ai`**, paste
   [`supabase/functions/canvy-ai/index.ts`](../../../supabase/functions/canvy-ai/index.ts) in
   full (replace the template, including any `import { serve }` line — this file uses
   `Deno.serve`), then add `OPENROUTER_API_KEY` under **Project Settings → Edge Functions →
   Secrets**. The function keeps `verify_jwt` on, so callers must be signed into Supabase (the
   app already is). If you hit a `401`, redeploy with `--no-verify-jwt`.

The manual copy/paste flow needs neither the function nor the key.

---

## File map

| File | Responsibility |
|------|----------------|
| `src/views/CanvyView.vue` | Main view: board rail + folders, header (Main/Branch toggle, Merge, Copy for AI, AI assist), toolbar, canvas host. Owns the active view/data, applies AI replies, and drives the **Run with AI** loop (`runAiLive`). |
| `src/components/canvy/CanvyCanvas.vue` | The interactive canvas: DOM elements + inline SVG in a panned/zoomed "world"; select/move/resize/rotate, draw arrows, comment pins, pen strokes. Exposes `fit()`, layer/rotate ops, and **`captureImage()`** (screenshot → PNG data URI). |
| `src/components/canvy/CanvyAiModal.vue` | The **AI assist** dialog: prompt picker (General / BPMN / C4 / Comment), section-scope toggle (+ a **context** sub-toggle: edit the selection but see the rest as read-only reference), instruction box, optional **steering** box, **Run with AI** button (**Review with AI** in comment mode) + **1×/2× review** switch + status line (with token/cost), the model's **note** and a **flagged-issues** callout, a **debug folder** picker + **debug log** panel, and the manual copy/paste controls. Emits `run` (direct) and `build` (manual). |
| `src/stores/canvy.js` | Pinia store: Supabase CRUD, debounced autosave, folders, `updateBoardData(id, data, view)`, `mergeBranch(id)`, `blankData()`. |
| `src/lib/canvyPrompts.js` | **Prompt catalogue + builders** shared by both flows: `PROMPTS`/`promptMode`, per-mode **semantics** (General/BPMN/C4/Comment) injected into the op-DSL shell, `buildConstructivePrompt`/`buildVerifyPrompt` (live), and `buildManualPrompt` (copy/paste). |
| `src/lib/canvyAi.js` | Shared board **validation/normalisation** (`normalizeBoard`, `scopedData`) that every reply funnels through. No prompt/JSON parsing lives here any more. |
| `src/lib/canvyOps.js` | **The op-DSL** used by both flows: `serializeBoard(data)` (board → compact alias notation), `parseOps(reply)` (reply → command list + `say` + `issues`), `applyOps(ops, data, maps)` (commands → new `data`, validated via `normalizeBoard`), `applyOpsReply()` (manual paste: re-derive aliases + apply), and `computeLayoutIssues()` (overlap / arrow-clutter detection fed back to the model). |
| `src/lib/canvyAiLive.js` | **The direct-run orchestrator**: `callGemini()` (invokes the edge function, returns `{ text, usage }`) and `runLiveAi()` (serialize → generate → apply ops → screenshot → verify → correct; comment mode is a single text-only call, no screenshot/verify). DOM/store-free; the view injects `capture` and `commitData`. |
| `src/lib/canvyAiDebug.js` | Logging: a reactive ring buffer (`debugLog`) for the in-app panel, console groups, and optional File System Access dumps (`pickDebugFolder`) of each turn's prompt/reply `.md` + screenshot `.png`. |
| `src/lib/canvyExport.js` | `boardToMarkdown(board)` — human-readable board summary (Copy for AI). |
| `src/lib/canvyToMiro.js` / `miroToCanvy.js` | Miro clipboard interop (paste into/out of miro.com). |
| `src/lib/canvyClipboard.js` | Lossless native Canvy clipboard payload, written alongside the Miro one on Ctrl+C so an internal paste keeps exact fidelity. |
| `src/lib/canvy-prompts/*.md` | Op-DSL prompt templates (both flows). **`prompt_ops.md`** = the edit shell with a `{{SEMANTICS}}` slot (General/BPMN/C4 injected by `canvyPrompts.js`); **`prompt_ops_comment.md`** = comment-only review; **`prompt_verify_ops.md`** = the screenshot-review turn. |
| `supabase/functions/canvy-ai/index.ts` | Stateless OpenRouter proxy (Deno). `{ prompt, imageBase64 }` → `google/gemini-3.5-flash` → `{ text, usage }` (asks OpenRouter for token counts + cost). Holds the key; adds CORS. |

Wired in: `src/router/index.js` (`/canvy` route) and `src/App.vue` (**Tools** nav + store
lifecycle).

---

## Data model

A board's whole layout lives in the `data` (Main) and `branch_data` (Branch) JSONB columns:

```jsonc
{
  "elements": [
    { "id": "e1", "type": "sticky|text|shape|draw|frame",
      "x": 0, "y": 0, "w": 200, "h": 180, "text": "…",
      "color": "yellow|pink|blue|green|purple|gray", "shade": 1,
      "opacity": 1, "rotation": 0,
      "fontSize": 15, "locked": false,                          // fontSize px (optional); locked = no hand-select
      "shape": "rect|ellipse|diamond|cylinder|parallelogram",   // type=shape
      "points": [[x,y], …], "strokeWidth": 3 }                  // type=draw
      // type=frame → a titled container (title in "text") drawn behind other elements
  ],
  "arrows": [
    { "id": "a1", "from": { "elementId": "e1" }, "to": { "elementId": "e2" },
      "label": "", "mode": "straight|curved|elbow", "curve": 0,
      "heads": { "start": false, "end": true },   // both true = double-ended
      "labelPos": 0.5, "labelSize": 13 }
      // from/to may be { x, y } free points, or add ax/ay (0..1) to pin a boundary anchor;
      // curve -0.9..0.9 (mode=curved); elbow = right-angle routing
  ],
  "comments": [
    { "id": "c1", "on": { "elementId": "e1" },   // or { betweenIds:[a,b] } / { arrowId }
      "x": 0, "y": 0,                             // free position when "on" is omitted
      "messages": [ { "id": "m1", "text": "…", "created_at": null } ] }
  ]
}
```

The board `data` **is** the AI build spec — no translation layer. `normalizeBoard` (in
`canvyAi.js`) validates and normalises every applied reply back into this shape (clamping
sizes, dropping arrows with missing endpoints, deriving draw bounding boxes, etc.).

---

## AI: the direct-run loop (`runLiveAi`)

The board only renders in the browser, so the **client orchestrates** and the edge function is a
thin per-turn proxy. Rather than round-trip the whole board as JSON (which echoes every UUID and
unchanged element — expensive, and big boards blow the output budget and come back truncated),
the board is serialized to a **compact op-DSL** with short alias ids and the model replies with a
small **command list**. One "Run with AI" click:

1. **Serialize + generate** — `serializeBoard(data)` turns the board into alias notation
   (`e1 st @240,120 200x180 y1 "Auth"`; arrows `a1 e1->e2 "writes"`; comments `c1 on:e2 "…"`).
   `prompt_ops.md` (notation spec + layout rules + your instruction + optional **steering**) + a
   `captureImage()` screenshot → `callGemini` → an ```ops reply.
2. **Parse + apply** — `parseOps` pulls the command list plus two prose line types: `!` = the
   model's note (`say`), `?` = a flagged **issue** (a real problem — broken screenshot, serious
   inference, something it believes is wrong). `applyOps` replays the commands against the current
   board (minting UUIDs for new ids, enforcing scope, skipping malformed lines with a warning) and
   funnels the result through the shared `normalizeBoard`. The view's injected `commitData` writes
   to the **branch** (`store.updateBoardData(id, data, 'branch')`), switches to the Branch view,
   and bumps `canvasKey` so the canvas remounts.
3. **Verify** (×1 or ×2, per the modal switch) — re-serialize the *result*, screenshot it, send
   `prompt_verify_ops.md`. The model edited **blind** by writing coordinates; this screenshot is
   its **first look at what those edits produced**. It replies **`ok`** if the render matches
   intent, else a small ```ops list of corrections (not a full re-emit).
4. **Correct** — a non-`ok` reply is applied and re-verified up to the round cap.

Aliases are **per-turn**: each turn re-serializes the current board with fresh maps, so the model
always references what it was just shown. Status text flows to the modal via `onStatus`; the
model's `say` note, its de-duped `issues` list, and summed token/cost totals come back in the
`runLiveAi` result (the modal shows the note in a red callout and the issues in an amber one).
Errors (missing secret, OpenRouter failure) surface in the status line rather than hanging.

`commitData` and `capture` are **injected by `CanvyView`** so `canvyAiLive.js` stays free of Vue
and DOM. `applyOps` operates on the **full** board, so scoped runs just merge naturally (new adds
append; edits/deletes to out-of-scope ids and `clear` are rejected with a warning).

**Layering:** the `elements` array order **is** the z-order (later = on top), and `add` appends,
so a newly-added shape renders in front of everything and — being opaque — hides notes it's placed
over. `back`/`front` ops reorder elements (unshift/push) so the model can send a container/
background box behind its contents; the prompt tells it to `back` any background it adds.

**Three selection modes** differ only in the *data* the model receives. The **screenshot is only
ever there for the model to validate its own edits, so it always frames just the selection** when
one is active (never a zoomed-out whole board) — the surrounding board is conveyed as text, not
image.

- **No selection** → the whole board is editable; screenshot fits the whole board.
- **Limit to selection** → only the section is serialized and only it is editable; screenshot
  fits the selection.
- **Selection + context** → the section is serialized under `# EDIT THESE`, the rest under
  `# CONTEXT` (read-only — the model may draw arrows to those ids but can't move/restyle/delete
  them); the screenshot still frames only the selection.

The editable set covers the section's elements **plus** the arrows between them, comments anchored
inside it, and anything the model newly creates — so e.g. re-curving an arrow *inside* a selection
works. The set grows as the model adds elements, so verify rounds still show its own additions.

### Debugging & cost (`canvyAiDebug.js`)

Every call is logged three ways: a collapsed **console group** (full prompt/reply/usage), a
reactive **ring buffer** rendered in the modal's *Debug log* panel (phase, tokens, cost, the exact
screenshot sent as a thumbnail, expandable prompt/reply), and — if you click **Choose debug
folder** (File System Access API, Chrome/Edge) — a per-run subfolder of `r<n>-<phase>.md` +
`.png` files on disk. The `.png` is the byte-for-byte image the model received, so you can confirm
it really sees the whole fitted board. Token counts + credit cost come from OpenRouter's `usage`
(the function requests `usage: { include: true }`).

**Screenshot fidelity:** `captureImage` rasterises via `html-to-image`, which inlines element
inline-styles but **drops scoped `<style>` rules for SVG children**. Arrow paths therefore carry
their `fill="none"` / `stroke` as **presentation attributes** (not only CSS) — without them a
rasterised curved arrow fills its arch solid black and a straight one vanishes, while the live app
(which keeps the CSS) looks fine. If you add new SVG-in-CSS styling that must show up in the AI's
screenshot, give it presentation-attribute fallbacks too.

### Manual flow

`CanvyAiModal` still offers **Copy prompt** / **Copy summary** / **Download .md** and a
paste-a-reply box (emits `build`). `CanvyView.buildFromText` applies it: constructive → branch,
`Comment only` → merges comments into the current view.

---

## Main / Branch

Main is the stable board; Branch is a working copy (AI edits land here). The header toggles the
view (persisted per board in `localStorage`), and **Merge** overwrites Main with the Branch and
clears it (`store.mergeBranch`).

---

## Verification

- `npm run build` and `npm run lint` must pass. (`html-to-image` is the only added dependency.)
- **Direct run (end-to-end):** with the function deployed + secret set, open a board with a few
  connected shapes → **AI assist** → e.g. *"add a Postgres cylinder fed by the API box"* →
  **Run with AI**. Watch the status advance Sending → Applying → Reviewing → *"happy ✓"*, with a
  token/cost line; confirm the Branch updates, the model's **note** appears, and the **Debug log**
  shows a short ```ops reply (a delta, not a full board).
- **Steering:** paste a plan into the steering box and confirm the model executes it.
- **Debug folder:** click **Choose debug folder**, run again, and confirm `r0-edit.md/.png`,
  `r1-review.md/.png` land in a per-run subfolder; open the `.png` and confirm **arrows render as
  grey lines/curves** (not black blobs) — the presentation-attribute fix.
- **Flagged issues:** give a deliberately underspecified/contradictory instruction; confirm the
  model emits `?` lines that appear in the amber **"AI flagged…"** callout (and that a clean run
  shows none).
- **Failure paths:** unset the secret → a clean error appears in the modal (no silent hang); a
  malformed op line is skipped with a warning (rest of the batch still applies).
- **Manual + persistence:** copy a prompt, paste a `json` reply into the manual box, reload the
  board (persistence), and Merge.
