# Canvy board: {{BOARD_NAME}}

{{SEMANTICS}}

This is the **first pass of an iterative build**. You won't have to finish everything
in one shot: after this pass you'll be shown a screenshot of what your commands
actually rendered, and you'll keep building and refining over several more passes
until the diagram is complete and clean. So on this pass, **lay a solid, well-organised
structure** — the main elements, flow and grouping — rather than cramming every detail
in blind. Be ambitious and substantial (a couple of timid nudges is a failure), but
you can add depth and polish on the passes that follow.

You edit by *commands* purely so you don't have to retype unchanged items — it is
**not** a signal to change little. The board is given below in the same compact
notation you reply in. Every item has a short id (`e1`, `e2` = elements, `a1` =
arrows, `c1` = comments). **Reuse those ids** to move/restyle/delete existing items;
invent new ids (e.g. `n1`, `n2`) for things you add.
{{SCOPE_NOTE}}
## How to read / write the board

Elements:  `<id> <kind> @<x>,<y> <w>x<h> <color><shade> fs:<n> lk "text"`
Arrows:    `<id> <from>-><to> "label" ~<curve>|elbow <> lpos:<t> lsz:<n>`
Comments:  `<id> <anchor> "text"`

- **kinds:** `st`=sticky, `tx`=text label, `rect` `ell` `dia` `cyl` `par`=shapes
  (cyl=database, par=input/output), `fr`=frame (a titled container drawn behind
  everything; put its title in the "text"), `dr`=freehand (don't create these).
- **colors:** `y`=yellow `p`=pink `b`=blue `g`=green `v`=purple `k`=gray, optional
  shade digit 0–4 (0 lightest, 4 most saturated) e.g. `b2`. Text elements have no color.
- **fs:**`<n>` optional per-element font size in px (e.g. `fs:24`); omit for default.
- **lk** optional flag = the element is locked (can't be selected/moved by hand).
- **anchor** for comments: `on:e2` (pinned to an element), `on:e2+e6` (between two),
  `on:a1` (on an arrow midpoint), or `@x,y` for a free point.
- **arrow endpoints** attach by id (`e5->e1`), and may pin a side: `e5:r->e1:l`
  (`t`/`r`/`b`/`l`/`c` = top/right/bottom/left/centre, or `e5:0.5,1` for a fraction).
  `@x,y` = a free-floating end.
- **arrow style** (all optional): `~<curve>` signed −0.9..0.9 bow (0 straight);
  `elbow` = right-angle routing; `<>` = arrowheads on **both** ends, `<` = head at
  the **start** only (default is end only); `lpos:<t>` label position 0..1 along the
  line; `lsz:<n>` label font px.

## Commands (one per line)

```
! short note explaining what you changed (in-app summary, plain English)
? a real problem you hit (see below) — one per line, plain English
clear                                  erase the whole board (start over)
del e3 a2 c1                           delete items by id (any kind)
add n1 st @240,120 200x180 y1 "text"   create an element (w×h & color optional)
add n2 fr @80,60 900x600 "Section"     create a frame (titled container, drawn behind)
mov e5 @420,300                        move an element
mov e5 @420,300 260x180                 move AND resize (optional w×h)
set e5 w:260 c:b1 fs:22 text:"API v2"  change fields (key:value; quote text values)
arw n9 e5:r->n1:l "writes" elbow <>    create an arrow (endpoints/label/style optional)
cmt n8 on:e5 "is this right?"          create a comment
rep c3 "reply text"                    reply to an existing comment
back n1                                send element(s) BEHIND others (backgrounds/containers)
front e5                               bring element(s) to the TOP
```

- `set` keys: `x y w h text c`(color) `sh`(shade) `op`(opacity) `rot`(rotation)
  `fs`(fontSize px) `lk`(locked 1|0) `bw`(borderWidth) `bs`(borderStyle solid|dashed)
  `bc`(borderColor); arrows: `label` `curve` `mode`(straight|curved|elbow)
  `heads`(se/s/e/-) `lpos`(0..1) `lsz`(px).
- Use `?` lines to flag **real problems only** — not routine design choices. Raise one when:
  the screenshot is unreadable, corrupted, or clearly doesn't match the board data; you had to
  make a **serious** inference or take a real liberty because the board is ambiguous or
  underspecified; two things contradict each other; an element is **hidden/covered** by another
  (or elements collide) and you couldn't resolve it; or you believe something is genuinely wrong
  or missing that you couldn't fix. Do **not** use `?` for minor wording or normal layout
  decisions — only things a human should know about. No problems → emit no `?` lines.
- Start with a `!` note line summarising the redesign you made. Then emit every
  command your redesign needs — moving most elements, adding new ones, re-routing
  arrows and reworking sections is expected and encouraged. The only thing you skip
  is re-listing items you're leaving untouched (their ids already exist). Don't hold
  back to keep the reply short. If a clean rebuild is the best answer, `clear` first,
  then `add` the whole thing.

## Coordinate system & layout rules
- Units are pixels. Origin (0,0) top-left; x right, y down.
- Base sizes: sticky 200×180, text 220×48, shape 180×110. Grow w/h for longer text.
- Leave **100–150px** of empty space between elements so arrow labels don't overlap.
- Lay diagrams left-to-right; branch on the y-axis for side/parallel paths.
- If a straight arrow would cut through another element, set `~curve` to bow it around.
- Keep arrow labels 1–3 words.

## Design rules — NON-NEGOTIABLE, check every one before you reply
1. **No overlapping elements.** No two boxes may overlap. Every element clears its
   neighbours by **≥100px** of empty space. The ONLY allowed overlap is a `fr` frame
   deliberately containing notes that sit fully inside it. When you move something,
   remember its width/height — a box is `@x,y` to `@x+w,y+h`; two boxes overlap if
   those rectangles intersect. Resize with `set w: h:` (or `mov e5 @x,y w×h`) rather
   than cramming text into a default-size box.
2. **No arrow clutter.** Labels 1–3 words, and no two labels may sit on top of each
   other — spread them along their lines (`lpos:`) or shorten. An arrow must never
   pass through a box it doesn't connect to, drop its label on one, **or cross another
   arrow.** For boxes-and-connectors / lane diagrams, **prefer `elbow` routing** and
   pin sides so lines run in clean horizontal/vertical channels instead of diagonals:
   `arw a1 e5:r->e1:l elbow`. When many arrows leave one source or converge on a
   column, fan them off **different** sides/fractions of that box
   (`e5:0,0.3->…`, `e5:0,0.5->…`, `e5:0,0.7->…`) so they stay parallel and never
   overlap. If two lines still must cross, bow one with `~curve` to separate them.
3. **Organized & balanced.** One consistent flow direction (left-to-right or
   top-to-bottom). Align elements into tidy rows/columns with even gaps. No lopsided
   empty regions and no dense clumps — distribute the space.
- **Layering & containers:** elements you `add` render **on top of** everything already on the
  board — its fill is opaque, so a box placed over existing notes will **hide** them. If you add a
  container/lane/background box that other items should sit inside, you MUST `back n1` it (send it
  behind) right after adding it. Also give large background fills a light shade and a low
  `op` (e.g. `add n1 rect … k0` then `set n1 op:0.25`) so the content stays readable. Prefer a
  plain `tx` label over a filled box when you just need a section heading. **For a labelled
  region that groups notes, use a `fr` frame** — it always renders behind and needs no `back`.
{{STEERING}}
## Current board
```
{{BOARD_COMPACT}}
```
{{LAYOUT_ISSUES}}
## Instruction
{{INSTRUCTION}}

Treat this as a mandate to build boldly, not to make the smallest possible edit. This
is your first pass — lay a strong, well-organised structure; you'll see it rendered and
keep building over the next passes. Start with a `!` note summarising your plan, then
reply with a single ```ops code block containing your command list — nothing else.
