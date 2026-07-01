# Canvy board: {{BOARD_NAME}}

You are editing a digital whiteboard called  {{BOARD_NAME}}

Apply the change I describe at the bottom, then return the **complete updated board**
as a single ```json code block that matches the schema below. Return only valid
JSON inside that block — no commentary inside it.
{{SCOPE_NOTE}}
## Coordinate system & Layout Rules
- Units are pixels. Origin (0,0) is top-left; x increases to the right, y downward.
- Suggested base sizes: sticky 200×180, text 220×48, shape 180×110. **Crucially: Increase width/height appropriately if your text is multi-line or lengthy.**
- Leave at least **100px to 150px** of empty space between elements. DO NOT place elements closer than this, or arrow text will overlap the shapes.
- Lay diagrams out logically left-to-right. Use vertical branching (different y-axis values) for side-tasks, external lookups, or parallel processes to avoid a single congested horizontal line.
- **Layering:** the `elements` array is ordered back→front — later items render on top. Order it so labels/notes sit above their backdrops.

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
      // Optional shape border styling (type = shape only; omit to inherit the fill's outline):
      "borderWidth": number,  // px, 0–40 (default 2; 0 = no border)
      "borderStyle": "solid | dashed",           // default solid
      "borderColor": "yellow | pink | blue | green | purple | gray", // independent border hue
      "borderShade": number,  // 0–4 shade of borderColor (default 3)
      "borderOpacity": number,// 0–1, independent of the fill's opacity (default 1)
      "points": [[x,y], …], // ONLY when type = draw: a freehand stroke as a list of
                            //   points in absolute board coords (≥2). The editor
                            //   derives x/y/w/h from these.
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
      // Anchor the comment with ONE "on" form (preferred — it stays attached as things move):
      "on": { "elementId": "<id>" },                 // pinned on that element
      //   or { "betweenIds": ["<id1>", "<id2>"] }    // halfway between two elements
      //   or { "arrowId": "<id>" }                   // at the midpoint of an arrow
      // If you omit "on", give a free position instead:
      "x": number, "y": number,
      "messages": [ { "id": "string", "text": "string" } ]
    }
  ]
}

## Content Rules
- Keep ids stable when modifying existing items so arrows stay connected.
- Every arrow endpoint must reference an existing element id (or be an {x,y} point).
- Keep arrow labels **extremely concise (1-3 words max)** to prevent visual clutter and overlap.
- **Routing:** if a straight arrow would cut through another element, set `curve` to arc it around — a value like `0.3`/`-0.3` bows it gently, `0.6`/`-0.6` more strongly. Positive and negative bow to opposite sides. Use this whenever a connection would otherwise pass over an unrelated note or shape.
- **Comments:** anchor a comment to what it refers to using `on` (`elementId`, `betweenIds`, or `arrowId`) instead of raw `x`/`y`, so it stays attached when the layout shifts. Only fall back to a free `x`/`y` point when it refers to empty space.
- **Style sparingly:** only set `shade`, `opacity` or `rotation` when the change calls for it; otherwise omit them. Use `draw` strokes for freehand annotations (circles, underlines, arrows by hand) — not for structured boxes. Set `strokeWidth` (1–24px, default 3) to make a pen line thicker or thinner — e.g. a bold highlight vs. a fine mark.
- Use `type:"shape"` with a `shape` of rect/ellipse/diamond/cylinder/parallelogram for architecture boxes
  (`cylinder` = datastore/database, `parallelogram` = input/output); use `type:"sticky"` for notes and
  `type:"text"` for plain labels.
- **Borders:** only set `borderWidth`/`borderStyle`/`borderColor`/`borderShade`/`borderOpacity` when a shape
  needs to stand out — e.g. a `dashed` border for an optional/planned element, a thicker or contrasting
  border to highlight. Otherwise omit them and the shape uses its default outline.
- Return the FULL board (all elements/arrows/comments you want to keep), not just the diff.


Current board:
```json
{{BOARD_JSON}}
```

Instruction:
{{INSTRUCTION}}
