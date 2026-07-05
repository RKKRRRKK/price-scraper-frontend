# Canvy board review: {{BOARD_NAME}}

You just edited this whiteboard by writing JSON coordinates **without seeing it render**.
The attached screenshot is the **actual result of your edits** — this is the first time you
can see what your instructions truly produced on screen.

Compare what you see against what you were trying to build:

- Are the arrows attached to the elements you meant, and pointing where you intended?
- Is anything overlapping, crossing, detached, clipped, or colliding with another element or an arrow label?
- Does the spacing and alignment read as the clean, deliberate, well-designed layout you set out to create — or does it look congested, lopsided, or accidental?

Your goal was:
> {{INSTRUCTION}}

## How to respond
- **If the rendered board matches your intent and looks clean**, reply with exactly `ok` — nothing else, no code block.
- **If the actual output diverged from what you planned** (tangled arrows, overlaps, poor spacing, anything off), reply with a single ```json code block containing the **complete corrected board** using the schema below. Return only valid JSON inside that block — no commentary inside it. Fix only what's wrong; keep everything that already looks right, and **keep element/arrow ids stable** so connections survive.

## Coordinate system & Layout Rules
- Units are pixels. Origin (0,0) is top-left; x increases to the right, y downward.
- Leave at least **100px to 150px** of empty space between elements so arrow labels don't overlap shapes.
- Lay diagrams out logically left-to-right; branch on the y-axis for side/parallel paths to avoid a congested single line.
- **Routing:** if a straight arrow would cut through another element, set `curve` (signed, -0.9..0.9) to bow it around.
- **Layering:** the `elements` array is ordered back→front — later items render on top.

## Schema
{
  "elements": [
    {
      "id": "string, unique and stable (reuse existing ids)",
      "type": "sticky | text | shape | draw",
      "x": number, "y": number, "w": number, "h": number,
      "text": "string (the label / contents — not used by draw)",
      "color": "yellow | pink | blue | green | purple | gray   (sticky, shape & draw)",
      "shade": number,   // optional 0–4 (default 1)
      "opacity": number, // optional 0.1–1 (default 1)
      "rotation": number,// optional degrees clockwise (default 0)
      "shape": "rect | ellipse | diamond | cylinder | parallelogram   (only when type = shape)",
      "borderWidth": number, "borderStyle": "solid | dashed",
      "borderColor": "yellow | pink | blue | green | purple | gray",
      "borderShade": number, "borderOpacity": number,
      "points": [[x,y], …], // ONLY when type = draw (≥2 absolute points)
      "strokeWidth": number // draw stroke thickness 1–24 (default 3)
    }
  ],
  "arrows": [
    {
      "id": "string, unique",
      "from": { "elementId": "<an element id>" },   // or { "x": n, "y": n }
      "to":   { "elementId": "<an element id>" },   // or { "x": n, "y": n }
      "label": "string (optional, 1–3 words)",
      "curve": number   // optional, -0.9..0.9, default 0 = straight
    }
  ],
  "comments": [
    {
      "id": "string, unique",
      "on": { "elementId": "<id>" },  // or { "betweenIds": ["<id1>","<id2>"] } or { "arrowId": "<id>" }
      "x": number, "y": number,       // free position, only if "on" is omitted
      "messages": [ { "id": "string", "text": "string" } ]
    }
  ]
}

Return the FULL board (everything you want to keep), not just the changed items.

Current board (what produced the screenshot):
```json
{{BOARD_JSON}}
```
