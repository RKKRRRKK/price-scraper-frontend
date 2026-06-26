# Breadboard tool

An interactive, *illustrative* breadboard designer under the **Tools** nav section
(`/breadboard`). You place components and breakout modules onto realistic breadboard
illustrations, wire them to a Raspberry Pi / ESP32 / custom board, and the tool computes the
**electrical nets**. Sheets persist to Supabase. **Copy as MD** serialises the whole design
into LLM-friendly text — and an assistant can reply with a build spec that the **AI build**
dialog constructs automatically (full round-trip).

---

## Setup (one-time)

The Supabase table is **not** auto-migrated. Run [`supabase/breadboard_schema.sql`](../../../supabase/breadboard_schema.sql)
once in the Supabase SQL editor. It creates `public.breadboard_sheets` plus the owner RLS
policy and the `is_whitelisted_user` restrictive policy (same pattern as Squell). Until it's
run, the UI works but sheets won't save/load.

---

## File map

| File | Responsibility |
|------|----------------|
| `src/lib/breadboard/templates.js` | Pure data: breadboard sizes, component/module/board templates, resistor colour-band maths, the `makeItem()` factory. |
| `src/lib/breadboard/geometry.js` | Hole coordinates, snapping (`nearestHole`), inline-pin placement, standalone-board layout, item bounds, endpoint↔coordinate resolution. |
| `src/lib/breadboard/nets.js` | `computeNets(data)` — union-find net engine. |
| `src/lib/breadboard/markdown.js` | `buildSheetMarkdown()` (state + AI build spec), `copyToClipboard()`, re-exports Squell's `downloadTextFile`/`slugify`. |
| `src/lib/breadboard/importBuild.js` | `parseBuild(text)` — turns an LLM `BreadboardBuild` JSON into a sheet `data` object. |
| `src/stores/breadboard.js` | Pinia store: Supabase CRUD, debounced autosave, sheet catalogue. Mirrors `stores/squell.js`. |
| `src/views/BreadboardView.vue` | Main view: sheet rail, toolbar, workspace (palette · canvas · inspector), modals. Owns the working copy of `data` and applies all edit ops. |
| `src/components/breadboard/BreadboardCanvas.vue` | Interaction orchestrator: render, click-to-place, drag-to-move, wire draw, pan/zoom. |
| `src/components/breadboard/BreadboardSurface.vue` | SVG illustration of the board itself (body, rails, holes, labels, ravine). |
| `src/components/breadboard/ComponentSprite.vue` | Per-kind illustrative rendering of a placed part. |
| `src/components/breadboard/ComponentPalette.vue` | Grouped palette of addable parts + wire/custom-board tools. |
| `src/components/breadboard/Inspector.vue` | Edit the selected part: label, props, pin→hole mapping (registered as `BreadboardInspector`). |
| `src/components/breadboard/CustomBoardModal.vue` | Define a custom board (name + pin labels). |

Wired in: `src/router/index.js` (`/breadboard` route) and `src/App.vue` (teal **Tools** nav
section in navbar + drawer; store `fetchSheets()`/`reset()` in the login/logout lifecycle).

---

## Data model

A sheet's whole layout lives in the `data` JSONB column:

```jsonc
{
  "breadboards": [{ "id": "bb1", "type": "full|half|mini", "x": 24, "y": 150 }],
  "items": [{
    "id": "<uuid>", "kind": "resistor", "label": "R1",
    "x": 0, "y": 0, "rotation": 0, "placement": "inline|standalone",
    "props": { "ohms": 220 },                       // kind-specific
    "pins": [{ "id": "a", "name": "1", "hole": "bb1:c12:A" }]  // hole = null when unplugged
  }],
  "wires": [{ "id": "<uuid>", "from": "<endpoint>", "to": "<endpoint>", "color": "#16a34a" }]
}
```

### ID schemes (stable strings)
- **Main hole:** `bb1:c<col>:<row>` → `bb1:c12:A` (rows `A`–`J`).
- **Rail hole:** `bb1:<rail>:<index>` where rail ∈ `TP` (top +), `TM` (top −), `BP` (bottom +), `BM` (bottom −).
- **Item pin endpoint:** `item:<itemId>:<pinId>`.

A **wire endpoint** is either a hole id or an item-pin endpoint id.

### Breadboard sizes & electrical strips
`full` (63 cols, split rails), `half` (30 cols), `mini` (17 cols, no rails). Within a numbered
column, rows **A–E** are one strip and **F–J** another. Each power-rail segment is one strip
(full boards split each rail into 2 segments).

---

## Net engine (`computeNets`)

Union-find over all holes + item pins:
1. Holes sharing a strip/rail-segment `group` are unioned.
2. Each **jumper wire** unions its two endpoints (wires *merge* nets).
3. An inline pin is unioned with the hole it's plugged into (the pin *sits on* that net).
   Components never merge their own two legs — a resistor **bridges** two nets.
4. Standalone board pins only join a net when wired.

Output: `{ nets, bridges, floating, layouts }`. A net needs ≥2 connected points (an unwired pin
is *floating*, not a net). Nets are labelled/ordered by power role (GND, +5V, +3V3, …) and
otherwise by their strip/rail.

---

## Interaction

- **Place:** pick a part in the palette → click a hole (inline parts snap their legs to
  consecutive holes; boards drop at the pointer). Esc cancels.
- **Move:** drag a part — inline legs re-snap to the nearest holes, boards move freely.
- **Wire:** wire tool → click two points (holes or board pins). Hover a wire to reveal its ×
  delete handle. Wires render above parts so connections stay visible on boards.
- **Inspector:** edit label, props (resistor value auto-draws bands, LED colour, IC pin count),
  and remap any pin to a row+column or a rail.
- **Pan/zoom:** drag empty canvas to pan, wheel to zoom; the **Fit** button reframes.

Sheets autosave (debounced) to Supabase via the store.

---

## Markdown export & AI-build round-trip

**Copy as MD** / **download .md** emit, in order:
1. Header, **Boards**, **Components** (each with pin locations + net), **Nets**, **What
   components bridge**, **Unconnected pins** — the current state, for circuit advice.
2. A **build spec** appendix (`buildSpecSection`, generated from the templates) that teaches an
   assistant the `BreadboardBuild` JSON format and part catalog.

So you can copy an empty/partial sheet, ask an assistant to design something, and paste its
reply into **AI build** (toolbar ✨). `parseBuild()` extracts the ```json block and constructs
the sheet — resolving holes, matching pins by id/name (forgiving), picking unused pins for
duplicates like Pi `GND`, mapping rail tokens, and auto-positioning boards.

### `BreadboardBuild` format
```jsonc
{
  "breadboard": "half",                                  // full | half | mini
  "parts": [
    { "id": "R1", "type": "resistor", "ohms": 330, "pins": { "1": "10B", "2": "15B" } },
    { "id": "LED1", "type": "led", "color": "red", "pins": { "anode": "15D", "cathode": "20D" } },
    { "id": "Pi1", "type": "raspi40" }                   // board: wire it below
  ],
  "wires": [
    { "from": "Pi1:GPIO17", "to": "10A" },               // board pin → hole
    { "from": "20A", "to": "-T" },                        // hole → bottom − rail
    { "from": "Pi1:GND", "to": "-T" }
  ]
}
```
- **Holes:** `<col><row>` (`10A`); **rails:** `+T` `-T` `+B` `-B`.
- **Wire points:** a hole, or a board pin `<id>:<pin>` (`Pi1:GPIO17`, or by number `Pi1:6`).
- Give inline parts `"pins"` (leg → hole); give boards their pins through `"wires"`.

---

## Extending

**Add a component:**
1. Add an entry to `COMPONENTS` in `templates.js` (kind, `label`, `group`, `pins`, `span`,
   `defaultProps`, a `body` tag).
2. Add its `kind` to the relevant `PALETTE_GROUPS` group.
3. Add a `body === '<tag>'` render branch in `ComponentSprite.vue`.
4. (Optional) extend `describeItem()` in `markdown.js` and `extractProps()`/`KIND_ALIASES` in
   `importBuild.js` so it round-trips well.

**Add a board:** add to `BOARDS` in `templates.js` with `pins` carrying `{ id, name, side, order }`
(side `L`/`R`); it renders via `getBoardLayout()` automatically.

---

## Verification

- `npm run build` and `npm run lint` must pass.
- The net engine and the import round-trip were validated with throwaway Node scripts
  (esbuild-bundled): a GPIO→resistor→LED→GND build parses to the correct three nets
  (`GND`, two signal strips) with R1 and LED1 bridging them.
- Manual: create a sheet, place parts, wire a Pi, **Copy as MD**, reload (persistence), and
  paste a `BreadboardBuild` reply into **AI build**.
