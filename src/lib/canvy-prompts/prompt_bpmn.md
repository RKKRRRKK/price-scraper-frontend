# Canvy board (BPMN): {{BOARD_NAME}}

You are editing a digital whiteboard called {{BOARD_NAME}} as a **BPMN 2.0 process diagram**.

Apply the change I describe at the bottom, then return the **complete updated board**
as a single ```json code block that matches the schema below. Return only valid
JSON inside that block — no commentary inside it.
{{SCOPE_NOTE}}
## Coordinate system & Layout Rules
- Units are pixels. Origin (0,0) is top-left; x increases to the right, y downward.
- Suggested base sizes: sticky 200×180, text 220×48, shape 180×110. **Crucially: Increase width/height appropriately if your text is multi-line or lengthy.**
- Leave at least **100px to 150px** of empty space between elements, or arrow text will overlap the shapes.
- **BPMN flows strictly left-to-right** along a horizontal "happy path". Branch vertically (different y) for alternate paths, then rejoin.

## BPMN conventions — map each concept to a Canvy shape
- **Events** (start / intermediate / end) → `type:"shape"`, `shape:"ellipse"`.
  - Start event: green, thin border (`borderWidth` 2). End event: red/pink, thick border (`borderWidth` 5).
  - Intermediate event: a plain ellipse with a normal border.
- **Activities / Tasks** → `shape:"rect"` (rounded), blue. Label with a verb phrase ("Review order").
- **Gateways** (decision / merge / parallel) → `shape:"diamond"`, yellow. Label the decision question or mark "X" (exclusive) / "+" (parallel). Every outgoing flow from an exclusive gateway MUST have a labelled arrow (the condition, e.g. "Approved", "Rejected").
- **Data objects / datastores** → `shape:"cylinder"` (datastore) or `shape:"parallelogram"` (data/input-output), gray.
- **Pools / lanes** → use a large low-opacity `rect` (set `opacity` ~0.15, send it to the back) as a swimlane band, with a `text` element for the lane name. Keep each participant's tasks inside their lane's y-range.
- **Sequence flows** → solid arrows (`curve` 0 unless routing around a shape).
- **Message flows** → use a `dashed` border style on the *connected shapes* is not enough; represent a message flow with an arrow whose `label` starts with "msg:".

## Schema
{
  "elements": [
    {
      "id": "string, unique and stable (reuse existing ids when editing)",
      "type": "sticky | text | shape | draw",
      "x": number, "y": number, "w": number, "h": number,
      "text": "string (the label / contents — not used by draw)",
      "color": "yellow | pink | blue | green | purple | gray   (sticky, shape & draw)",
      "shade": number,   // optional 0–4 shade of the hue: 0 lightest … 4 most saturated (default 1)
      "opacity": number, // optional 0.1–1 (default 1 = opaque)
      "rotation": number,// optional degrees clockwise (default 0)
      "shape": "rect | ellipse | diamond | cylinder | parallelogram   (only when type = shape)",
      // Optional shape border styling (type = shape only):
      "borderWidth": number,  // px, 0–40 (default 2; 0 = no border)
      "borderStyle": "solid | dashed",           // default solid
      "borderColor": "yellow | pink | blue | green | purple | gray", // independent border hue
      "borderShade": number,  // 0–4 shade of borderColor (default 3)
      "borderOpacity": number,// 0–1, independent of the fill's opacity (default 1)
      "points": [[x,y], …], // ONLY when type = draw (≥2 points); editor derives x/y/w/h
      "strokeWidth": number // draw stroke thickness in px, 1–24 (optional, default 3)
    }
  ],
  "arrows": [
    {
      "id": "string, unique",
      "from": { "elementId": "<an element id>" },   // or a free point: { "x": n, "y": n }
      "to":   { "elementId": "<an element id>" },   // or { "x": n, "y": n }
      "label": "string (optional, shown on the arrow)",
      "curve": number   // optional, default 0 = straight. Signed bow, -0.9..0.9
    }
  ],
  "comments": [
    {
      "id": "string, unique",
      "on": { "elementId": "<id>" },                 // or { "betweenIds": ["<id1>","<id2>"] } or { "arrowId": "<id>" }
      "x": number, "y": number,                      // fallback free position if "on" omitted
      "messages": [ { "id": "string", "text": "string" } ]
    }
  ]
}

## Content Rules
- Keep ids stable when modifying existing items so arrows stay connected.
- Every arrow endpoint must reference an existing element id (or be an {x,y} point).
- Keep arrow labels **concise (1–3 words)** — but always label the conditional flows leaving a gateway.
- **Routing:** if a straight arrow would cut through another element, set `curve` (±0.3 gentle, ±0.6 stronger) to arc around it.
- A well-formed process has exactly one start event and at least one end event; every task lies on a path between them.
- Return the FULL board (all elements/arrows/comments you want to keep), not just the diff.


Current board:
```json
{{BOARD_JSON}}
```

Instruction:
{{INSTRUCTION}}
