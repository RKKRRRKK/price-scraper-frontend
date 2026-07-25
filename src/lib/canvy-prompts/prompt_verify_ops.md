# Canvy board — continue building: {{BOARD_NAME}}

{{SEMANTICS}}

You are building this whiteboard **over several passes**, not in one shot. The
attached screenshot is the **actual result of your work so far** — the real render,
not your imagination of it. The board is given below in the same compact notation you
reply in.

{{PASS_INFO}}

Your goal is:
> {{INSTRUCTION}}
{{PROGRESS_NOTES}}{{MORE_NUDGE}}
## Reason → Act → Observe

1. **Reason.** Look at the screenshot and the board. Open your reply with a single
   `!` line stating: **what's now complete**, **what's still missing or wrong**, and
   **what you will do this pass**. This note is shown back to you next pass, so make
   it a useful running plan.
2. **Act.** Emit an `ops` command list that:
   - **Builds the next chunk** — add the elements, arrows, groupings and detail the
     diagram still needs. Don't sit still refining a near-empty board; keep making it
     more complete and more useful until it fully satisfies the goal.
   - **Fixes what's off** — resolve every item in "Problems your last pass produced"
     below, plus anything you can see is overlapping, detached, clipped, crossing, or
     covering another note. Pull boxes ≥100px apart, resize with `set w: h:`, reroute
     crossing arrows with `~curve`/`elbow` or by pinning a different side.
   - Keep everything that already looks right — don't re-list untouched items.
3. **Observe.** You'll get a fresh screenshot next pass to check your work.

**When the diagram is genuinely complete AND clean, reply with exactly `done`** (a
single word, no ops) — and only then. While anything is missing, thin, or messy, keep
going. Don't stop early to keep the reply short. Always reply using the line-command
DSL shown below — **never JSON**.
{{LAYOUT_ISSUES}}
## Notation reminder
`add n1 st @x,y 200x180 y1 "text"` · `add n2 fr @x,y 900x600 "Section"` (frame, drawn behind) ·
`mov e5 @420,300` (or `mov e5 @420,300 260x180` to move+resize) · `set e5 w:260 c:b1 op:0.3 fs:22 lk:1` ·
`set a2 mode:elbow heads:se` · `set a2 curve:0.4` · `del e3` · `back n1` (send behind) · `front e5`.
**Create arrows with `arw`, never `add`:** `arw n9 e5:r->e1:l "label" elbow <>`. Endpoints pin a side
with `:t :r :b :l :c`. Colours `y p b g v k` (+0–4 shade); kinds `st tx rect ell dia cyl par fr`.

## Current board (what produced the screenshot)
```
{{BOARD_COMPACT}}
```
