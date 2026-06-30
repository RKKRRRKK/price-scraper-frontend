# Canvy board review: {{BOARD_NAME}}

You are reviewing a digital whiteboard called  {{BOARD_NAME}}
{{SCOPE_NOTE}}
Your job is to **scrutinise the content only** — the ideas, structure, gaps,
inconsistencies, unclear labels, missing steps — and leave comments. **Do NOT
redesign or redefine the board.** Do not move, add, recolour, or delete elements,
shapes, or arrows.

Return your review as a single ```json code block matching the schema below.
Return only valid JSON inside that block — no commentary outside the messages.

## What you can do
- **Add a new comment** pinned to whatever it refers to (an element, between two
  elements, on an arrow, or — as a last resort — a free point in empty space).
- **Reply to an existing comment** by its `id` (the board's current comments,
  with their ids and messages, are included below so you can respond to them).

## Schema
{
  "addComments": [
    {
      // Anchor with ONE "on" form (preferred), or fall back to a free x/y point:
      "on": { "elementId": "<id>" },
      //   or { "betweenIds": ["<id1>", "<id2>"] }
      //   or { "arrowId": "<id>" }
      "x": number, "y": number,
      "messages": [ { "text": "your comment" } ]
    }
  ],
  "replies": [
    {
      "commentId": "<an existing comment id from the board below>",
      "messages": [ { "text": "your reply" } ]
    }
  ]
}

## Rules
- Reference real ids from the board below; an `on` anchor that points at a missing
  id is dropped, and a reply to an unknown `commentId` is ignored.
- Be specific and constructive — point at the exact element/arrow your comment is about.
- Keep each message focused; use several comments rather than one giant note.
- If everything looks good, say so in one short `addComments` entry.


Current board (for reference — do not redefine it):
```json
{{BOARD_JSON}}
```

What to review / focus on:
{{INSTRUCTION}}
