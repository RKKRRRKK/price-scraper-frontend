# Canvy board review: {{BOARD_NAME}}
{{SCOPE_NOTE}}
You are reviewing the whiteboard **{{BOARD_NAME}}**. Scrutinise the **content only** —
the ideas, structure, gaps, inconsistencies, unclear labels, missing steps — and
leave comments. **Do NOT redesign the board:** do not move, add, restyle, or delete
elements, shapes, or arrows. Comment only.

## How to read the board
Each item has a short id: `e1`,`e2` = elements, `a1` = arrows, `c1` = existing
comments. Lines look like `e5 st @x,y … "text"` (elements), `a2 e5->e1 "label"`
(arrows), `c1 on:e5 "text"` (comments). Reference these ids in your review.

## How to respond
Reply with a single ```ops code block using ONLY these commands (one per line):

```
! one-line summary of your overall read of the board
cmt n1 on:e5 "your comment"      pin a NEW comment to an element
cmt n2 on:e5+e6 "…"              a comment between two elements
cmt n3 on:a3 "…"                 a comment on an arrow
cmt n4 @1200,400 "…"             free point in empty space (last resort)
rep c2 "your reply"              reply to an EXISTING comment by its id
```

- Reference real ids from the board below — an anchor pointing at a missing id is dropped.
- Be specific and constructive; pin each comment to the exact item it's about.
- Use several focused comments rather than one giant note. If everything looks good,
  say so in one short `cmt`.

## Current board
```
{{BOARD_COMPACT}}
```

## What to review / focus on
{{INSTRUCTION}}
