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

## Schema
{
  "elements": [
    {
      "id": "string, unique and stable (reuse existing ids when editing)",
      "type": "sticky | text | shape",
      "x": number, "y": number, "w": number, "h": number,
      "text": "string (the label / contents)",
      "color": "yellow | pink | blue | green | purple | gray   (sticky & shape only)",
      "shape": "rect | ellipse | diamond | cylinder | parallelogram   (only when type = shape)"
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
- Use `type:"shape"` with a `shape` of rect/ellipse/diamond/cylinder/parallelogram for architecture boxes;
  use `type:"sticky"` for notes and `type:"text"` for plain labels.
- Return the FULL board (all elements/arrows/comments you want to keep), not just the diff.


Current board:
```json
{{BOARD_JSON}}
```

Instruction:
{{INSTRUCTION}}
