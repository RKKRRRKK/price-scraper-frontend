# Canvy board (C4 model): {{BOARD_NAME}}

You are editing a digital whiteboard called {{BOARD_NAME}} as a **C4 model architecture diagram**
(Context / Container / Component levels — keep a single board to ONE level unless told otherwise).

Apply the change I describe at the bottom, then return the **complete updated board**
as a single ```json code block that matches the schema below. Return only valid
JSON inside that block — no commentary inside it.
{{SCOPE_NOTE}}
## Coordinate system & Layout Rules
- Units are pixels. Origin (0,0) is top-left; x increases to the right, y downward.
- Boxes should be roomy: **220–280 wide, 120–150 tall** so the three text lines fit. Increase for longer text.
- Leave at least **120px** of empty space between boxes so relationship labels don't overlap.
- Arrange so most dependency arrows point the same way (top→bottom or left→right). The user/actor sits at the top or left edge.

## C4 conventions — map each element to a Canvy shape
Every box's `text` should read as three lines: **Name**, then *[Type/Technology]*, then a short responsibility, e.g.
`"API Application\n[Container: Node.js]\nHandles all business logic"`.
- **Person / Actor** (user, admin, external role) → `shape:"ellipse"`, gray. Put the role name + "[Person]".
- **Software System** (the system in scope, or an external system) → `shape:"rect"`, blue for the system in focus, gray for **external** systems.
- **Container** (app, service, SPA, mobile app, API) → `shape:"rect"`, blue, `[Container: <tech>]`.
- **Datastore / Database** → `shape:"cylinder"`, blue/green, `[Container: <db tech>]`.
- **Component** (a grouping inside a container) → `shape:"rect"`, purple.
- **Boundary** (system or container boundary) → a large `rect` with `borderStyle:"dashed"`, `borderWidth` 2, low `opacity` (~0.12) or gray, sent to the back, with a `text` label for the boundary name. Place the members inside it.
- **External** elements (people or systems outside your control): use gray fill AND a `dashed` border to signal "outside the boundary".

## Relationships
- Every arrow is a **directed dependency** and MUST carry a `label` describing the interaction AND ideally the protocol, e.g. "Reads/writes", "Makes API calls to [JSON/HTTPS]", "Sends email via".
- Keep labels short but meaningful (2–5 words). Arrows point from the consumer to the thing it depends on.

## Schema
{
  "elements": [
    {
      "id": "string, unique and stable (reuse existing ids when editing)",
      "type": "sticky | text | shape | draw",
      "x": number, "y": number, "w": number, "h": number,
      "text": "string (Name / [Type] / responsibility — use \\n for line breaks)",
      "color": "yellow | pink | blue | green | purple | gray   (sticky, shape & draw)",
      "shade": number,   // optional 0–4 shade of the hue (default 1)
      "opacity": number, // optional 0.1–1 (default 1)
      "rotation": number,// optional degrees clockwise (default 0)
      "shape": "rect | ellipse | diamond | cylinder | parallelogram   (only when type = shape)",
      // Optional shape border styling (type = shape only):
      "borderWidth": number,  // px, 0–40 (default 2; 0 = no border)
      "borderStyle": "solid | dashed",           // default solid — use dashed for boundaries & external
      "borderColor": "yellow | pink | blue | green | purple | gray",
      "borderShade": number,  // 0–4 shade of borderColor (default 3)
      "borderOpacity": number,// 0–1, independent of fill opacity (default 1)
      "points": [[x,y], …], // ONLY when type = draw (≥2 points)
      "strokeWidth": number // draw stroke thickness 1–24 (optional, default 3)
    }
  ],
  "arrows": [
    {
      "id": "string, unique",
      "from": { "elementId": "<an element id>" },   // or { "x": n, "y": n }
      "to":   { "elementId": "<an element id>" },   // or { "x": n, "y": n }
      "label": "string — REQUIRED for C4: the relationship + protocol",
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
- Every arrow endpoint must reference an existing element id (or be an {x,y} point), and every arrow needs a relationship `label`.
- Draw boundary rects FIRST in the `elements` array (back), then the boxes inside them (front), so labels sit on top.
- **Routing:** if a straight arrow would cut through a box, set `curve` (±0.3 / ±0.6) to arc around it.
- Return the FULL board (all elements/arrows/comments you want to keep), not just the diff.


Current board:
```json
{{BOARD_JSON}}
```

Instruction:
{{INSTRUCTION}}
