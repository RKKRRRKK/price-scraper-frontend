# Canvy board review: {{BOARD_NAME}}

You just edited this whiteboard by writing coordinates **without seeing it render**.
The attached screenshot is the **actual result of your edits** — the first time you
can see what your commands produced on screen.

Compare what you see against what you intended:

- Are arrows attached to the right elements and pointing where you meant?
- Is anything overlapping, crossing, detached, clipped, or colliding with a label?
- **Is a box covering/hiding other notes?** A shape you added renders on top and its fill is
  opaque — if you meant it as a container/background, `back` it (send it behind) so the notes
  inside show. Notes you expected to see but can't are probably hidden underneath one.
- Does the spacing read as clean and deliberate — or congested and accidental?

Your goal was:
> {{INSTRUCTION}}

## How to respond
- **If it matches your intent and looks clean**, reply with exactly `ok` — nothing else.
- **If something is off**, reply with a single ```ops code block of correction
  commands (same notation as before) that fixes only what's wrong. Move, resize,
  re-route (`set ~curve`), or re-colour items by their ids; keep everything that
  already looks right. Don't re-list unchanged items.
- **If the screenshot itself looks broken** — unreadable, corrupted, blank, arrows
  rendered as solid blobs, or clearly not matching the board data above — do **not**
  try to "fix" the board from it. Instead add a `?` line describing what's wrong with
  the image (e.g. `? screenshot shows arrows as black blobs; can't verify layout`) so
  a human is told, and either reply `ok` or make only changes you're confident about
  from the board data alone. You may include `?` lines alongside `ops` corrections.

## Notation reminder
`mov e5 @x,y` · `set e5 w:260 c:b1 op:0.3 fs:22 lk:1` · `set a2 curve:0.4` ·
`set a2 mode:elbow heads:se` · `del e3` · `add n1 st @x,y "text"` · `add n2 fr @x,y 900x600 "Section"`
`back n1` (send behind) · `front e5` (bring to top). Colours `y p b g v k` (+0–4 shade); kinds
`st tx rect ell dia cyl par fr`(frame). Arrow endpoints can pin a side: `e5:r->e1:l`; `elbow`
= right-angle, `<>` = double-headed.

## Current board (what produced the screenshot)
```
{{BOARD_COMPACT}}
```
