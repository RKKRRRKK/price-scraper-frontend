<template>
  <div class="froll" :class="{ editing: editMode }" :style="vars">
    <!-- ══ The instrument ══ laid out on the same column grid as the roll, so a
         hole sits exactly above the column of bars that feeds it. -->
    <div class="flute">
      <!-- Held across the body, out to the player's right: the right end is
           stopped, and you blow across the reed housing on the side of the tube
           rather than into the end of it. -->
      <div class="tube">
        <span class="tube-stop"></span>
        <span class="tube-bind head"></span>
        <span class="tube-reed"><i></i></span>
        <span class="tube-sheen"></span>
        <span class="tube-node"></span>
        <span class="tube-bind foot"></span>
        <span class="tube-cap"></span>
      </div>
      <div class="frow flute-row">
        <span class="cell-ruler"></span>
        <span class="cell-trace"></span>
        <span class="cell-lab flute-name">
          <b>bawu</b><small>1={{ keyLabel }}</small>
        </span>
        <template v-for="(c, ci) in CELLS" :key="'fh' + ci">
          <span v-if="c.gap" class="cell-gap" :class="{ big: c.big }"></span>
          <span v-else class="cell-hole hole-cell" :class="{ back: c.back }">
            <button
              class="hole"
              :class="holeClass(c)"
              :title="holeTitle(c)"
              @pointerdown="onHoleDown($event, c)"
            ></button>
            <i class="hole-tag" :class="{ 'back-tag': c.back }">{{ holeTag(c) }}</i>
          </span>
        </template>
      </div>
      <div v-if="tip" class="flute-tip">{{ tip }}</div>
    </div>

    <!-- ══ The roll ══ time runs upwards: notes rise into the instrument. -->
    <div class="fr-wrap" ref="wrapEl">
      <!-- Column stripes, pinned to the viewport (the notes scroll over them). -->
      <div class="frow fr-cols" ref="colsRow">
        <span class="cell-ruler"></span>
        <span class="cell-trace"></span>
        <span class="cell-lab"></span>
        <template v-for="(c, ci) in CELLS" :key="'bg' + ci">
          <span v-if="c.gap" class="cell-gap" :class="{ big: c.big }"></span>
          <span v-else class="cell-hole" :class="{ back: c.back }"><i></i></span>
        </template>
      </div>

      <div
        class="fr-view"
        ref="viewEl"
        @scroll="onScroll"
        @pointerdown="onViewPointerDown"
        @dblclick="onDblClick"
        @contextmenu="onContextMenu"
      >
        <div class="fr-lane" ref="laneEl" :style="{ height: laneH + 'px' }">
          <!-- Bars and beats -->
          <div
            v-for="g in gridLines"
            :key="'g' + g.beat"
            class="fr-gridline"
            :class="{ bar: g.bar }"
            :style="{ top: yOfBeat(g.beat) + 'px' }"
          ><span v-if="g.bar" class="fr-barnum">{{ g.bar }}</span></div>

          <!-- Notes: one grid row per note, seven bars wide. -->
          <div
            v-for="n in visibleNotes"
            :key="n.idx"
            class="frow fnote"
            :data-idx="n.idx"
            :class="noteClass(n)"
            :style="noteStyle(n)"
            :title="noteTitle(n)"
            @pointerdown="onNotePointerDown($event, n)"
            @click="onNoteClick($event, n)"
          >
            <span class="cell-ruler"></span>
            <span class="cell-trace"></span>
            <span class="cell-lab fn-lab">
              <span class="fn-pill">{{ noteLabel(n) }}<i v-if="n.row === null" class="fn-warn">⚠</i></span>
              <span v-if="fxBadges(n).length" class="fn-fx">
                <i v-for="(bg, bi) in fxBadges(n)" :key="bi" :title="bg.title">{{ bg.t }}</i>
              </span>
              <span v-if="lyricsOn && syl(n)" class="fn-syl">{{ syl(n) }}</span>
            </span>
            <template v-for="(c, ci) in CELLS" :key="'nb' + ci">
              <span v-if="c.gap" class="cell-gap" :class="{ big: c.big }"></span>
              <span v-else class="cell-hole"><i class="fbar" :class="{ on: covers(c, levelOf(n)) }"></i></span>
            </template>
            <span v-if="editMode" class="fn-grip" title="Drag down to lengthen" @pointerdown="onResizeDown($event, n)"></span>
          </div>
        </div>
      </div>

      <!-- Viewport overlays (never scroll) -->
      <div class="fr-fade"></div>
      <canvas ref="traceCanvas" class="fr-trace"></canvas>
      <div class="fr-now"><span class="fr-now-lab">NOW</span></div>
      <div v-if="heardLevel !== null && micActive" class="frow fr-heard">
        <span class="cell-ruler"></span>
        <span class="cell-trace"></span>
        <span class="cell-lab fr-heard-lab">heard</span>
        <template v-for="(c, ci) in CELLS" :key="'hb' + ci">
          <span v-if="c.gap" class="cell-gap" :class="{ big: c.big }"></span>
          <span v-else class="cell-hole"><i class="hbar" :class="{ on: covers(c, heardLevel) }"></i></span>
        </template>
      </div>
      <div v-if="mqOn" class="fr-marquee" :style="mqStyle"></div>
      <div v-if="!notes.length" class="fr-empty">
        <template v-if="editMode"><b>Right-click</b> the roll to add a note, or press <b>1–7</b>.</template>
        <template v-else>Nothing here yet — use <b>AI convert</b> to read a score picture, or <b>Edit</b> to add notes by hand.</template>
      </div>
    </div>

    <!-- ══ Right-click menu ══ -->
    <template v-if="menu.open">
      <div class="fmenu-backdrop" @pointerdown="closeMenu" @contextmenu.prevent="closeMenu"></div>
      <div class="fmenu" :style="{ top: menu.y + 'px', left: menu.x + 'px' }">
        <div class="fmenu-head">
          <template v-if="menu.note">Note {{ menu.note.label }} · {{ BAWU_NOTES[levelOf(menu.note)].pitch }}</template>
          <template v-else>Add at bar {{ barOfBeat(menu.beat) }} · beat {{ beatInBar(menu.beat) }}</template>
        </div>
        <div class="fmenu-label">Note</div>
        <div class="fmenu-pitch">
          <button
            v-for="(bn, li) in BAWU_NOTES"
            :key="bn.midi"
            class="fm-pitch"
            :class="{ on: menu.note ? levelOf(menu.note) === li : menu.level === li }"
            :title="'Cover ' + coverText(li)"
            @click="menuPitch(li)"
          >
            <b>{{ jianpuText(bn.midi, keyName) }}</b>
            <small>{{ bn.pitch }}</small>
            <span class="fm-holes">
              <template v-for="(c, ci) in CELLS" :key="'mh' + ci">
                <i v-if="!c.gap" :class="{ on: covers(c, li) }"></i>
              </template>
            </span>
          </button>
        </div>
        <div class="fmenu-label">Length <small>beats</small></div>
        <div class="fmenu-len">
          <button
            v-for="[lab, val] in LEN_PRESETS"
            :key="lab"
            class="fm-len"
            :class="{ on: (menu.note ? menu.note.beats : lastLen) === val }"
            @click="menuLength(val)"
          >{{ lab }}</button>
        </div>
        <div class="fmenu-sep"></div>
        <button v-if="canPaste" class="fmenu-item" @click="menuPaste"><i class="pi pi-file-import"></i> Paste here</button>
        <button v-if="menu.note" class="fmenu-item danger" @click="menuDelete"><i class="pi pi-trash"></i> Delete note</button>
        <div v-if="!menu.note" class="fmenu-hint">Pick a note to drop it here. Double-click a column does the same.</div>
      </div>
    </template>
  </div>
</template>

<script setup>
// The practice roll, stood up on its end.
//
// The old roll was a pitch axis with time running left→right. This one is a
// *fingering* chart: one column per hole (T back · 1–3 · 4–6), time running
// bottom→top, so a note rises into the bawu drawn across the top and you read
// the shape of the fingering rather than a pitch row. A note is seven bars —
// filled where the hole is covered, hollow where it is open — which is exactly
// the picture the instrument shows at the moment you have to play it.
//
// The one fact that makes the geometry work: BAWU_NOTES is ordered high→low and
// the bawu's fingerings are a strict prefix chain (T, then 1, 2, … 6), so a
// note's index in that table IS the number of holes covered. `level` is used
// throughout for that number — 0 = everything open (D5), 7 = everything covered
// (C4) — and it converts a pointer position, a menu choice and a drag delta into
// a pitch without a lookup table.
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { BAWU_NOTES, KEYS, jianpuText, rowFloatOfMidi, coveredLabel } from '@/lib/bawu/notes'
import { dataToEvents, eventsToData, rankOfEvent, snapBeat, MIN_BEATS } from '@/lib/bawu/edit'

const props = defineProps({
  data: { type: Object, default: null }, // active { key, bpm, timeSig, lines }
  notes: { type: Array, default: () => [] }, // flattened sounding notes (no rests)
  totalBeats: { type: Number, default: 0 },
  beatsPerBar: { type: Number, default: 4 },
  px: { type: Number, default: 34 }, // px per beat (vertical)
  grid: { type: Number, default: 0.25 },
  keyName: { type: String, default: 'F' },
  notation: { type: String, default: 'jianpu' },
  currentIdx: { type: Number, default: 0 },
  editMode: Boolean,
  selected: { type: Object, default: () => new Set() },
  lyricsOn: Boolean,
  lyricsScript: { type: String, default: 'chinese' },
  playing: Boolean,
  micActive: Boolean,
  heardMidi: { type: Number, default: null }, // mic pitch as a float MIDI number
  tip: { type: String, default: '' },
  traceSamples: { type: Array, default: () => [] },
  bpm: { type: Number, default: 80 },
  canPaste: Boolean,
})

const emit = defineEmits([
  'seek', 'seek-beat', 'update:selected', 'preview', 'commit', 'audition', 'hold', 'paste',
])

// ── Column layout ───────────────────────────────────────────────────────────
// The columns run down the instrument as it is actually bored and held: the
// foot at the left, then 6–5–4 under the right hand, 3–2–1 under the left, the
// thumb hole, and the reed you blow across at the right-hand end.
//
// The thumb hole is the last one before the reed because it is the closest to
// the mouth — it is the last hole to open, so covering it alone sounds C5 and
// adding hole 1 gives A4, the very next note down. It is bored through the far
// side of the tube, so it is drawn low and ringed, but it sits right beside
// hole 1 where the thumb actually falls.
//
// `level` is what covering up to and including this hole sounds. The bore runs
// low→high left to right, so level DESCENDS across the columns and the covered
// staircase grows from the reed end.
const CELLS = [
  { hole: 6, level: 7, name: '6' },
  { hole: 5, level: 6, name: '5' },
  { hole: 4, level: 5, name: '4' },
  { gap: true, big: true }, // between the hands
  { hole: 3, level: 4, name: '3' },
  { hole: 2, level: 3, name: '2' },
  { hole: 1, level: 2, name: '1' },
  { gap: true }, // hole 1 to the thumb — a hair's breadth, they are neighbours
  { hole: 0, level: 1, name: 'T', back: true },
  { gap: true, head: true }, // the reed housing and the stopped end
]
const COLS = CELLS.filter((c) => !c.gap)

const LEN_PRESETS = [['⅛', 0.125], ['¼', 0.25], ['½', 0.5], ['¾', 0.75], ['1', 1], ['1½', 1.5], ['2', 2], ['4', 4]]

// ── Dials ───────────────────────────────────────────────────────────────────
// Every size, shape and colour the eye notices lives here. Nothing else in this
// file needs editing to retune the look — the stylesheet reads all of it through
// CSS variables, so changing a value here is the whole edit.

// LAYOUT ─ how the seven hole columns are spaced across the deck
const DECK_W = '50%'        // how much of the panel the deck takes; the rest is bare desk
const HOLE_COL = '8rem'   // ← SPACING between two neighbouring holes. Smaller = tighter.
const T_COL = '8rem'      // the thumb's own column, narrower so it hugs hole 1
const T_GAP = '0rem'     // thumb ↔ hole 1
const MID_GAP = '6.0rem'    // between the two hands (on top of the usual column gap)
const HEAD_PAD = '10rem'  // clearance at the right for the reed housing
const RULER_W = '2.1rem'    // bar-number margin, far left
const TRACE_W = '2.75rem'   // mic-trace ribbon (collapses to zero when the mic is off)
const GUTTER_MIN = '6rem'   // note labels + lyrics; takes whatever slack is left over

// THE INSTRUMENT ─ the drawing across the top
const FLUTE_H = '5.4rem'    // the whole strip, hole tags included
const TUBE_H = '3.4rem'     // how thick the tube is drawn
const TUBE_TOP = '0.35rem'  // its offset from the top of the strip
const TUBE_INSET = '0.5rem' // how far its ends sit in from the deck edges
const TUBE_R = '1.7rem'     // corner rounding of the tube's ends
const HOLE_DIA = '3.3rem'   // ← WIDTH of the six front cut-outs (they are half this tall)
const HOLE_DIA_T = '2.5rem' // ← and of the thumb cut-out on the underside
const REED_W = '3.8rem'     // the reed housing you blow across
const REED_H = '1.95rem'
const REED_RIGHT = '3.8rem' // how far in from the stopped end it sits
const TUBE_BG = 'linear-gradient(180deg, #8a6844 0%, #6b4c30 16%, #533720 48%, #3d2715 80%, #63462c 100%)'

// TYPE
const HOLE_TAG_SIZE = '1rem'  // ← the note names under the instrument
const FLUTE_NAME_SIZE = '0rem'
const FLUTE_KEY_SIZE = '1.6rem'
const NOTE_LABEL_SIZE = '1rem'   // the jianpu digit / pitch name beside each note
const LYRIC_SIZE = '0.72rem'
const FX_SIZE = '0.74rem'
const BARNUM_SIZE = '0.64rem'

// THE ROLL
const FILL = '28%'          // ← how much of its column a BAR fills
const FILL_MAX = '6.5rem'   // …but never wider than this
const BAR_RADIUS = '0.65rem'
const NOTE_GAP = 3 // px trimmed off a bar so neighbours don't fuse
// px from the top of the roll viewport → the NOW line. It is also the lane's
// head room, which is what puts beat 0 on the line with the scroller at rest.
// Not flush to the instrument: the gap above the line is where the note you just
// played (and the mic trace behind it) goes before it fades into the bawu.
const HEAD_Y = 72

// COLOUR ─ green means a covered hole, and nothing else
const C_DOWN = '#16a34a'
const C_DOWN_LIT = '#22c55e'
const C_DOWN_EDGE = '#15803d'
const C_OPEN = '#e7e5e4'
const C_OPEN_EDGE = '#d6d3d1'

const vars = computed(() => {
  const trace = props.micActive ? TRACE_W : '0rem'
  // A hole column is capped rather than flexible, so the seven holes crowd
  // together instead of stretching with the window; the label gutter takes the
  // slack, and the tube is drawn across the whole deck regardless.
  const col = `minmax(2.5rem, ${HOLE_COL})`
  const tcol = `minmax(1.8rem, ${T_COL})`
  return {
    '--deck-w': DECK_W,
    '--ruler-w': RULER_W,
    '--trace-w': trace,
    '--head-y': HEAD_Y + 'px',
    '--fcols': `${RULER_W} ${trace} minmax(${GUTTER_MIN}, 1fr) repeat(3, ${col}) ${MID_GAP} repeat(3, ${col}) ${T_GAP} ${tcol} ${HEAD_PAD}`,
    '--flute-h': FLUTE_H,
    '--tube-h': TUBE_H,
    '--tube-top': TUBE_TOP,
    '--tube-inset': TUBE_INSET,
    '--tube-r': TUBE_R,
    '--tube-bg': TUBE_BG,
    '--reed-w': REED_W,
    '--reed-h': REED_H,
    '--reed-right': REED_RIGHT,
    // A cut-out is a half-disc: as wide as the bore, half that tall, with its
    // flat side lying along the edge of the tube it is bored through.
    '--hole-w': HOLE_DIA,
    '--hole-h': `calc(${HOLE_DIA} / 2)`,
    '--hole-w-t': HOLE_DIA_T,
    '--hole-h-t': `calc(${HOLE_DIA_T} / 2)`,
    '--tube-bottom': `calc(${TUBE_TOP} + ${TUBE_H})`,
    '--tag-size': HOLE_TAG_SIZE,
    '--name-size': FLUTE_NAME_SIZE,
    '--key-size': FLUTE_KEY_SIZE,
    '--label-size': NOTE_LABEL_SIZE,
    '--lyric-size': LYRIC_SIZE,
    '--fx-size': FX_SIZE,
    '--barnum-size': BARNUM_SIZE,
    // One source of truth for how much of a column a bar takes up.
    '--fill': `min(${FILL}, ${FILL_MAX})`,
    '--bar-r': BAR_RADIUS,
    '--down': C_DOWN,
    '--down-lit': C_DOWN_LIT,
    '--down-edge': C_DOWN_EDGE,
    '--open': C_OPEN,
    '--open-edge': C_OPEN_EDGE,
  }
})

const keyLabel = computed(() => KEYS[props.keyName]?.label || props.keyName)

// ── Geometry ────────────────────────────────────────────────────────────────
const wrapEl = ref(null)
const viewEl = ref(null)
const laneEl = ref(null)
const colsRow = ref(null)
const traceCanvas = ref(null)
const rollH = ref(420) // measured viewport height of the scroller

// The lane is laid out top-down — beat 0 at the head, later beats further down —
// and the scroller walks down it as the song plays, which is what makes the
// notes climb the screen towards the instrument. The tail pad is the space below
// the NOW line, so the last note can still reach it.
const padTail = computed(() => Math.max(0, rollH.value - HEAD_Y))
const laneH = computed(() => HEAD_Y + props.totalBeats * props.px + padTail.value)
function yOfBeat(beat) {
  return HEAD_Y + beat * props.px
}
// Only what is near the window is in the DOM — seven bars a note, plus a line a
// beat, adds up fast on a long piece. The window is re-centred in whole steps so
// playback doesn't re-render the roll every frame.
const winBeat = ref(0)
const winSpan = computed(() => Math.max(24, (rollH.value / Math.max(8, props.px)) * 2.5))
const visibleNotes = computed(() => {
  const lo = winBeat.value - winSpan.value
  const hi = winBeat.value + winSpan.value
  return props.notes.filter((n) => n.start + n.beats > lo && n.start < hi)
})
// Bar lines always; beat lines only while there is room for them to read as
// guides rather than as hatching.
const gridLines = computed(() => {
  const per = props.beatsPerBar
  const showBeats = props.px >= 26
  const lo = Math.max(0, Math.floor(winBeat.value - winSpan.value))
  const hi = Math.min(props.totalBeats + per, Math.ceil(winBeat.value + winSpan.value))
  const out = []
  for (let b = lo; b <= hi; b++) {
    const isBar = b % per === 0
    if (isBar) out.push({ beat: b, bar: b / per + 1 })
    else if (showBeats) out.push({ beat: b, bar: 0 })
  }
  return out
})

// ── Note → fingering ────────────────────────────────────────────────────────
function nearestLevel(midi) {
  let best = 0
  let bd = Infinity
  BAWU_NOTES.forEach((b, i) => {
    const d = Math.abs(b.midi - midi)
    if (d < bd) { bd = d; best = i }
  })
  return best
}
// How many holes this note covers. An unplayable pitch has no fingering, so it
// borrows its nearest neighbour's and is flagged instead of vanishing.
function levelOf(n) {
  return n.row === null || n.row === undefined ? nearestLevel(n.midi ?? 69) : n.row
}
function covers(cell, level) {
  if (level == null) return false
  return BAWU_NOTES[level].holes[cell.hole] === 1
}
function coverText(level) {
  return coveredLabel(level)
}

const curNote = computed(() => props.notes.find((n) => n.idx === props.currentIdx) || null)
const curLevel = computed(() => (curNote.value ? levelOf(curNote.value) : null))
const heardLevel = computed(() => {
  if (!props.micActive || props.heardMidi == null) return null
  return Math.round(rowFloatOfMidi(props.heardMidi))
})

// ── Labels ──────────────────────────────────────────────────────────────────
const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']
function pitchName(midi) {
  return NOTE_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1)
}
function noteLabel(n) {
  if (props.notation === 'western' && n.midi != null) return pitchName(n.midi)
  return n.label
}
function syl(n) {
  return props.lyricsScript === 'pinyin' ? (n.py || n.ly || '') : (n.ly || n.py || '')
}
// Arcs don't survive being stood on end in a five-rem gutter, so the expression
// marks print as glyphs beside the label — and a tie/slur also draws a spine up
// the note's left edge, which reads as one line because tied notes touch.
function fxBadges(n) {
  const out = []
  if (n.gi) out.push({ t: '⟋', title: 'slide into the note' })
  if (n.go === 'off') out.push({ t: '⟍', title: 'falls away at the end' })
  if (n.go === 'to') out.push({ t: '→', title: 'glissando to the next note' })
  if (n.bd) out.push({ t: (n.bd > 0 ? '↗' : '↘') + Math.abs(n.bd), title: `bend ${n.bd > 0 ? '+' : ''}${n.bd}` })
  if (n.vb) out.push({ t: ['', '〜', '≈', '≋'][n.vb], title: ['', 'gentle vibrato', 'wide vibrato', 'flutter tongue'][n.vb] })
  if (n.ti) out.push({ t: '⌣', title: 'tied to the next note' })
  else if (n.sl) out.push({ t: '⌢', title: 'slurred to the next note' })
  return out
}
function noteTitle(n) {
  const parts = [n.midi != null ? pitchName(n.midi) : '']
  if (n.row === null) parts.push('outside the bawu’s range')
  else parts.push('cover ' + coverText(levelOf(n)))
  for (const b of fxBadges(n)) parts.push(b.title)
  return parts.filter(Boolean).join(' · ')
}
function noteClass(n) {
  const h = n.beats * props.px
  return {
    done: !props.editMode && n.idx < props.currentIdx,
    current: !props.editMode && n.idx === props.currentIdx,
    upcoming: !props.editMode && n.idx > props.currentIdx,
    unplayable: n.row === null,
    selected: props.editMode && props.selected.has(n.idx),
    'tied-in': n.tiedIn,
    'ties-out': !!n.ti,
    tight: h < 34,
    tiny: h < 18,
  }
}
function noteStyle(n) {
  const span = n.beats * props.px
  // A tie's two halves are one sound, so nothing is cut between them.
  const h = n.ti ? span : Math.max(6, span - Math.min(NOTE_GAP, span * 0.18))
  return { top: yOfBeat(n.start) + 'px', height: h + 'px' }
}

function holeClass(c) {
  return {
    covered: covers(c, curLevel.value),
    back: c.back,
    // The mic heard a different fingering — ring the holes that disagree.
    off: heardLevel.value !== null && curLevel.value !== null && covers(c, heardLevel.value) !== covers(c, curLevel.value),
  }
}
// A hole is labelled with the note it *makes* — the one that sounds when it is
// the last hole still covered — so the 1 / C toggle relabels the instrument in
// step with the roll. The hole's own number stays in the tooltip.
function holeTag(c) {
  const n = BAWU_NOTES[c.level]
  return props.notation === 'western' ? n.pitch : jianpuText(n.midi, props.keyName)
}
function holeTitle(c) {
  const n = BAWU_NOTES[c.level]
  return `${c.back ? 'Thumb hole (back)' : 'Hole ' + c.name} · covered down to here sounds ${n.pitch} (${jianpuText(n.midi, props.keyName)})`
}

// ── Scrolling ═ the transport ───────────────────────────────────────────────
// The roll is a real scroll container: the loop drives it while the song plays,
// and the wheel drives the song while it doesn't. `lastT` is what keeps the two
// from fighting — a frame only writes scrollTop when the song position actually
// moved somewhere else.
let lastT = null
let progUntil = 0

function scrollForBeat(beat) {
  return yOfBeat(beat) - HEAD_Y
}
function beatForScroll(top) {
  return props.px > 0 ? top / props.px : 0
}

// Called from the view's rAF loop with the current song position, in beats.
function paint(t) {
  const view = viewEl.value
  if (!view) return
  const h = view.clientHeight
  if (h && rollH.value !== h) rollH.value = h
  if (lastT !== t) {
    const want = Math.max(0, Math.min(view.scrollHeight - view.clientHeight, scrollForBeat(t)))
    if (Math.abs(view.scrollTop - want) > 0.5) {
      progUntil = performance.now() + 90
      view.scrollTop = want
    }
    lastT = t
  }
  recentre(t)
  drawTrace()
}
function recentre(t) {
  if (Math.abs(t - winBeat.value) > winSpan.value * 0.35) winBeat.value = t
}
function onScroll() {
  if (props.playing || performance.now() < progUntil) return
  const view = viewEl.value
  if (!view) return
  const beat = Math.max(0, Math.min(props.totalBeats, beatForScroll(view.scrollTop)))
  lastT = beat // the loop must not yank the sheet back under the hand
  recentre(beat)
  emit('seek-beat', beat)
}

// ── Mic trace ═ pitch across, time down ─────────────────────────────────────
// The old roll drew the heard pitch as a line trailing the playhead across the
// rows. Stood up, that becomes a narrow ribbon beside the ruler: the horizontal
// axis is pitch (low left, high right) and the line grows downwards as it ages.
function drawTrace() {
  const canvas = traceCanvas.value
  if (!canvas) return
  const w = canvas.clientWidth
  const h = canvas.clientHeight
  if (!w || !h) return
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w
    canvas.height = h
  }
  const g = canvas.getContext('2d')
  g.clearRect(0, 0, w, h)
  const samples = props.traceSamples
  if (!props.micActive || !samples.length) return

  const now = performance.now()
  const pxPerSec = props.px * (props.bpm / 60)
  const rows = BAWU_NOTES.length - 1
  const xOf = (mf) => 3 + ((rows - rowFloatOfMidi(mf)) / rows) * (w - 6)
  // A sample was on the line when it was taken and the sheet has climbed since,
  // so the trail runs upwards with the notes it is meant to be compared against.
  const yOf = (at) => HEAD_Y - ((now - at) / 1000) * pxPerSec

  if (curLevel.value !== null) {
    g.fillStyle = 'rgba(239,68,68,0.16)'
    g.fillRect(xOf(BAWU_NOTES[curLevel.value].midi) - 3, 0, 6, h)
  }

  g.strokeStyle = '#d97706'
  g.lineWidth = 2.25
  g.lineJoin = 'round'
  g.lineCap = 'round'
  let started = false
  let prevAt = 0
  g.beginPath()
  for (let i = samples.length - 1; i >= 0; i--) {
    const s = samples[i]
    const y = yOf(s.at)
    if (y < -20) break
    const x = xOf(s.mf)
    if (!started || Math.abs(s.at - prevAt) > 250) {
      g.moveTo(x, y)
      started = true
    } else {
      g.lineTo(x, y)
    }
    prevAt = s.at
  }
  g.stroke()

  const last = samples[samples.length - 1]
  if (last && now - last.at < 300) {
    g.fillStyle = '#d97706'
    g.shadowColor = 'rgba(217,119,6,0.8)'
    g.shadowBlur = 9
    g.beginPath()
    g.arc(xOf(last.mf), HEAD_Y, 5, 0, Math.PI * 2)
    g.fill()
    g.shadowBlur = 0
  }
}

// ── Pointer → score coordinates ─────────────────────────────────────────────
let colRects = []
function captureCols() {
  const row = colsRow.value
  colRects = row ? [...row.querySelectorAll('.cell-hole')].map((el) => el.getBoundingClientRect()) : []
}
// Which fingering the pointer is over: the column you point at is the last hole
// that stays covered. The staircase grows from the reed end, so pointing past
// the thumb — out towards the mouthpiece — means "nothing covered at all".
function levelFromClientX(x) {
  if (!colRects.length) captureCols()
  if (!colRects.length) return 7
  if (x > colRects[colRects.length - 1].right + 6) return 0
  let best = 0
  let bd = Infinity
  colRects.forEach((r, i) => {
    const d = Math.abs((r.left + r.right) / 2 - x)
    if (d < bd) { bd = d; best = i }
  })
  return COLS[best].level
}
function beatFromClientY(y) {
  const rect = laneEl.value?.getBoundingClientRect()
  if (!rect || !props.px) return 0
  return Math.max(0, (y - rect.top - HEAD_Y) / props.px)
}
function barOfBeat(beat) {
  return Math.floor(beat / props.beatsPerBar) + 1
}
function beatInBar(beat) {
  return Math.round((beat % props.beatsPerBar) * 4) / 4 + 1
}

// ── Editing ─────────────────────────────────────────────────────────────────
const lastLen = ref(1)

function baseData() {
  const d = props.data || { key: 'F', bpm: 80, timeSig: '4/4', lines: [] }
  return JSON.parse(JSON.stringify({ key: d.key, bpm: d.bpm, timeSig: d.timeSig, lines: d.lines || [] }))
}
function newEvent(start, beats, midi) {
  return { id: 'f' + Date.now() + Math.random(), start, beats, midi, art: '', ly: '', py: '', ti: 0, sl: 0, gi: 0, go: '', bd: 0, vb: 0 }
}
function commit(events, base, keep) {
  const data = eventsToData(events, base, props.beatsPerBar)
  emit('commit', { data, base, select: keep.map((ev) => rankOfEvent(events, ev)) })
}

function insertNote(beat, level, beats) {
  const base = baseData()
  const events = dataToEvents(base)
  const ev = newEvent(Math.max(0, snapBeat(beat, props.grid)), beats, BAWU_NOTES[level].midi)
  events.push(ev)
  commit(events, base, [ev])
  emit('audition', { midi: ev.midi, force: true })
  lastLen.value = beats
}
function editNote(n, fn) {
  const base = baseData()
  const events = dataToEvents(base)
  const ev = events[n.idx]
  if (!ev) return
  fn(ev)
  commit(events, base, [ev])
}
function removeNote(n) {
  const base = baseData()
  const events = dataToEvents(base)
  if (!events[n.idx]) return
  commit(events.filter((_, i) => i !== n.idx), base, [])
}

// Selection ───────────────────────────────────────────────────────────────────
function select(ids) {
  emit('update:selected', new Set(ids))
}
function onNoteClick(e, n) {
  if (!props.editMode) {
    emit('seek', n)
    return
  }
  emit('audition', { midi: n.midi })
  if (e.shiftKey) {
    const next = new Set(props.selected)
    if (next.has(n.idx)) next.delete(n.idx)
    else next.add(n.idx)
    select(next)
  } else {
    select([n.idx])
  }
}

// Drag: up/down moves the note in time, left/right points at the hole the
// fingering should stop at. Everything selected travels as one rigid shape.
let drag = null
function onNotePointerDown(e, n) {
  if (!props.editMode || e.button !== 0) return
  e.preventDefault()
  e.stopPropagation()
  captureCols()
  if (!props.selected.has(n.idx) && !e.shiftKey) select([n.idx])
  const base = baseData()
  const events = dataToEvents(base)
  const ev = events[n.idx]
  if (!ev) return
  const group = [...props.selected]
    .map((i) => events[i])
    .filter(Boolean)
    .map((g) => ({ ev: g, origStart: g.start, origLevel: nearestLevel(g.midi) }))
  if (!group.some((g) => g.ev === ev)) group.push({ ev, origStart: ev.start, origLevel: nearestLevel(ev.midi) })
  drag = {
    type: 'move', events, ev, base, group,
    startY: e.clientY, origStart: ev.start,
    startLevel: levelFromClientX(e.clientX),
    moved: false,
  }
  emit('audition', { midi: ev.midi, force: true })
  window.addEventListener('pointermove', onDragMove)
  window.addEventListener('pointerup', onDragUp)
}
function onResizeDown(e, n) {
  if (!props.editMode || e.button !== 0) return
  e.preventDefault()
  e.stopPropagation()
  select([n.idx])
  const base = baseData()
  const events = dataToEvents(base)
  const ev = events[n.idx]
  if (!ev) return
  drag = { type: 'resize', events, ev, base, startY: e.clientY, origBeats: ev.beats, moved: false }
  window.addEventListener('pointermove', onDragMove)
  window.addEventListener('pointerup', onDragUp)
}
function onDragMove(e) {
  if (!drag) return
  if (drag.type === 'move') {
    // The lane runs top-down, so dragging down is dragging later.
    const dBeats = (e.clientY - drag.startY) / props.px
    const snapped = Math.max(0, snapBeat(drag.origStart + dBeats, props.grid))
    const startDelta = snapped - drag.origStart
    const levelDelta = levelFromClientX(e.clientX) - drag.startLevel
    for (const g of drag.group) {
      g.ev.start = Math.max(0, g.origStart + startDelta)
      const lv = Math.max(0, Math.min(BAWU_NOTES.length - 1, g.origLevel + levelDelta))
      g.ev.midi = BAWU_NOTES[lv].midi
    }
    emit('audition', { midi: drag.ev.midi })
  } else {
    const dBeats = (e.clientY - drag.startY) / props.px
    drag.ev.beats = Math.max(MIN_BEATS, snapBeat(drag.origBeats + dBeats, props.grid))
    lastLen.value = drag.ev.beats
  }
  drag.moved = true
  emit('preview', eventsToData(drag.events, drag.base, props.beatsPerBar))
}
function onDragUp() {
  window.removeEventListener('pointermove', onDragMove)
  window.removeEventListener('pointerup', onDragUp)
  const d = drag
  drag = null
  if (d && d.moved) commit(d.events, d.base, (d.group || [{ ev: d.ev }]).map((g) => g.ev))
  emit('preview', null)
}

// Marquee box-select on empty roll space.
const marquee = ref(null)
let mqRect = null
function onViewPointerDown(e) {
  if (!props.editMode || e.button !== 0) return
  if (e.target.closest('.fnote')) return
  const rect = wrapEl.value?.getBoundingClientRect()
  if (!rect) return
  captureCols()
  mqRect = rect
  const x = e.clientX - rect.left
  const y = e.clientY - rect.top
  marquee.value = { x0: x, y0: y, x1: x, y1: y }
  window.addEventListener('pointermove', onMarqueeMove)
  window.addEventListener('pointerup', onMarqueeUp)
}
function onMarqueeMove(e) {
  if (!marquee.value || !mqRect) return
  marquee.value = { ...marquee.value, x1: e.clientX - mqRect.left, y1: e.clientY - mqRect.top }
}
function onMarqueeUp() {
  window.removeEventListener('pointermove', onMarqueeMove)
  window.removeEventListener('pointerup', onMarqueeUp)
  const mq = marquee.value
  marquee.value = null
  const rect = mqRect
  mqRect = null
  if (!mq || !rect) return
  if (Math.abs(mq.x1 - mq.x0) < 5 && Math.abs(mq.y1 - mq.y0) < 5) { select([]); return }
  const b0 = beatFromClientY(Math.max(mq.y0, mq.y1) + rect.top)
  const b1 = beatFromClientY(Math.min(mq.y0, mq.y1) + rect.top)
  const l0 = levelFromClientX(Math.min(mq.x0, mq.x1) + rect.left)
  const l1 = levelFromClientX(Math.max(mq.x0, mq.x1) + rect.left)
  const lo = Math.min(l0, l1)
  const hi = Math.max(l0, l1)
  select(
    props.notes
      .filter((n) => n.start < b1 && n.start + n.beats > b0 && levelOf(n) >= lo && levelOf(n) <= hi)
      .map((n) => n.idx),
  )
}
const mqOn = computed(() => {
  const m = marquee.value
  return !!m && (Math.abs(m.x1 - m.x0) > 4 || Math.abs(m.y1 - m.y0) > 4)
})
const mqStyle = computed(() => {
  const m = marquee.value
  if (!m) return {}
  return {
    left: Math.min(m.x0, m.x1) + 'px',
    top: Math.min(m.y0, m.y1) + 'px',
    width: Math.abs(m.x1 - m.x0) + 'px',
    height: Math.abs(m.y1 - m.y0) + 'px',
  }
})

function onDblClick(e) {
  if (!props.editMode) return
  if (e.target.closest('.fnote')) return
  captureCols()
  insertNote(beatFromClientY(e.clientY), levelFromClientX(e.clientX), lastLen.value)
}

// Piano-key holes: press one to hear what covering down to it sounds like.
function onHoleDown(e, c) {
  e.preventDefault()
  emit('hold', BAWU_NOTES[c.level].midi)
}

// ── Right-click menu ────────────────────────────────────────────────────────
const menu = ref({ open: false, x: 0, y: 0, beat: 0, level: 7, note: null })
function onContextMenu(e) {
  if (!props.editMode) return // outside edit mode the browser's own menu is more use
  e.preventDefault()
  captureCols()
  const el = e.target.closest('.fnote')
  const note = el ? props.notes.find((n) => n.idx === Number(el.dataset.idx)) : null
  const hit = note || hitNoteAt(e.clientY)
  menu.value = {
    open: true,
    x: Math.min(e.clientX, window.innerWidth - 300),
    y: Math.min(e.clientY, window.innerHeight - 360),
    beat: beatFromClientY(e.clientY),
    level: levelFromClientX(e.clientX),
    note: hit,
  }
  if (hit) select([hit.idx])
}
// The note rows span the whole width, so the pointer is over a note whenever it
// is inside that note's slice of time — no need to trust the event target.
function hitNoteAt(y) {
  const beat = beatFromClientY(y)
  return props.notes.find((n) => beat >= n.start && beat < n.start + n.beats) || null
}
function closeMenu() {
  menu.value = { ...menu.value, open: false, note: null }
}
function menuPitch(level) {
  const m = menu.value
  closeMenu()
  if (m.note) {
    editNote(m.note, (ev) => { ev.midi = BAWU_NOTES[level].midi })
    emit('audition', { midi: BAWU_NOTES[level].midi, force: true })
  } else {
    insertNote(m.beat, level, lastLen.value)
  }
}
function menuLength(beats) {
  const m = menu.value
  lastLen.value = beats
  if (!m.note) return // the menu stays open — pick the note to drop next
  closeMenu()
  editNote(m.note, (ev) => { ev.beats = beats })
}
function menuDelete() {
  const m = menu.value
  closeMenu()
  if (m.note) removeNote(m.note)
}
function menuPaste() {
  const m = menu.value
  closeMenu()
  emit('paste', Math.max(0, snapBeat(m.beat, props.grid)))
}

// Zoom, a transpose, an edit — anything that changes where a beat lives has to
// re-seat the scroller, which only happens when the loop thinks the position
// moved. Clearing the cached value makes the next frame write it again.
watch([() => props.px, () => props.totalBeats, padTail], () => { lastT = null })

onBeforeUnmount(() => {
  window.removeEventListener('pointermove', onDragMove)
  window.removeEventListener('pointerup', onDragUp)
  window.removeEventListener('pointermove', onMarqueeMove)
  window.removeEventListener('pointerup', onMarqueeUp)
})

defineExpose({ paint, closeMenu })
</script>

<style scoped>
/* The instrument is bamboo and brass; the fingering is green for down and pale
   grey for open, which is the one thing the eye has to read at speed. */
/* Sixty per cent of the panel, centred — roughly a fifth of the width left clear
   on either side. That margin is what stops the seven columns being stretched
   until the three holes under one hand no longer read as one hand; the `.desk`
   behind it is sunken, so the clear space reads as desk rather than as a deck
   that failed to fill. On a narrow panel the floor takes over and it fills. */
.froll {
  flex: 1; min-height: 0; width: var(--deck-w); min-width: min(100%, 36rem); margin-inline: auto;
  display: flex; flex-direction: column; background: var(--bg-card);
  border-left: 1px solid var(--border-soft); border-right: 1px solid var(--border-soft);
}

/* Every row that has to line up with a hole — the instrument, the column
   guides, each note — is the same grid. One template, one source of truth. */
.frow { display: grid; grid-template-columns: var(--fcols); align-items: stretch; }
.cell-gap { display: block; }
.cell-hole { position: relative; display: block; }

/* ── The instrument ───────────────────────────────────────────────────────── */
.flute { position: relative; height: var(--flute-h); flex: none; border-bottom: 1px solid var(--border); background: linear-gradient(180deg, #faf9f7, #f1efec); }
.tube {
  position: absolute; left: var(--tube-inset); right: var(--tube-inset); top: var(--tube-top); height: var(--tube-h); border-radius: var(--tube-r);
  background: var(--tube-bg);
  box-shadow: 0 5px 14px rgba(61, 39, 21, 0.26), inset 0 -2px 6px rgba(0, 0, 0, 0.45), inset 0 2px 3px rgba(255, 226, 180, 0.28);
}
.tube-sheen { position: absolute; left: 2%; right: 2%; top: 0.3rem; height: 0.48rem; border-radius: 999px; background: linear-gradient(90deg, rgba(255,238,208,0), rgba(255,238,208,0.32) 18%, rgba(255,238,208,0.15) 70%, rgba(255,238,208,0)); }
/* The instrument is held to the player's right, so the reed end is the RIGHT
   end: stopper, binding, and the housing you blow across the side of. The foot
   is at the left, past the last finger hole. */
.tube-stop { position: absolute; right: 0; top: 0; bottom: 0; width: 0.9rem; border-radius: 0.3rem var(--tube-r) var(--tube-r) 0.3rem; background: linear-gradient(180deg, #4a3526, #2b1d12 60%, #45301f); }
.tube-bind { position: absolute; top: -1px; bottom: -1px; width: 0.48rem; background: repeating-linear-gradient(180deg, #2b2018 0 2px, #4a3726 2px 4px); box-shadow: 0 0 4px rgba(0,0,0,0.4); }
.tube-bind.head { right: 0.9rem; }
.tube-bind.foot { left: 0.95rem; }
.tube-reed {
  position: absolute; right: var(--reed-right); top: 50%; transform: translateY(-50%);
  width: var(--reed-w); height: var(--reed-h); border-radius: 0.45rem;
  background: linear-gradient(180deg, #f3e4b4 0%, #d3b158 40%, #8f7230 100%);
  box-shadow: inset 0 -1px 3px rgba(0,0,0,0.4), inset 0 1px 2px rgba(255,255,255,0.5), 0 1px 3px rgba(0,0,0,0.35);
}
.tube-reed i { position: absolute; inset: 0.32rem 0.45rem; border-radius: 50%; background: radial-gradient(ellipse at 40% 32%, #3a2a12, #120c04 75%); box-shadow: inset 0 1px 3px rgba(0,0,0,0.9); }
.tube-node { position: absolute; top: 0; bottom: 0; left: 34%; width: 0.3rem; background: linear-gradient(180deg, rgba(255,230,190,0.2), rgba(0,0,0,0.25)); }
.tube-cap { position: absolute; left: 0; top: 0; bottom: 0; width: 0.95rem; border-radius: var(--tube-r) 0.3rem 0.3rem var(--tube-r); background: linear-gradient(180deg, #6b4c30, #3d2715 65%, #5a3f28); }

.flute-row { position: absolute; inset: 0; }
/* Written on the bamboo between the reed and the first hole, the way a Chinese
   flute carries its maker's mark. */
.flute-name { display: flex; flex-direction: column; align-items: flex-end; justify-content: center; padding: 0 0.5rem 0 0.1rem; color: #f0dcb8; text-shadow: 0 1px 2px rgba(0,0,0,0.6); overflow: hidden; }
.flute-name b { font-size: var(--name-size); font-weight: 800; letter-spacing: 0.08em; }
.flute-name small { font-size: var(--key-size); opacity: 0.75; font-weight: 700; }

/* The holes are drawn as CUT-OUTS of the tube's silhouette rather than discs
   floating on it: a half-disc whose flat side lies along the edge it is bored
   through. The six front holes notch the TOP edge, the thumb hole notches the
   BOTTOM — which is exactly the shape the instrument presents when it is turned
   so the centred blow hole faces you. */
.hole-cell .hole {
  position: absolute; top: var(--tube-top); left: 50%; transform: translateX(-50%);
  width: var(--hole-w); height: var(--hole-h); padding: 0; cursor: pointer;
  border-radius: 0 0 999px 999px;
  background: linear-gradient(180deg, #fafaf9, var(--open) 52%, #c4c0bc 100%);
  border: 1px solid rgba(40, 25, 12, 0.55); border-top: none;
  box-shadow: inset 0 -2px 3px rgba(0,0,0,0.3);
  transition: background 90ms, box-shadow 90ms, border-color 90ms;
}
/* Bored through the FAR side, so it notches the underside — and it is ringed
   rather than solid, since you are looking at the back of the tube. */
.hole-cell.back .hole {
  top: auto; bottom: calc(var(--flute-h) - var(--tube-bottom));
  width: var(--hole-w-t); height: var(--hole-h-t);
  border-radius: 999px 999px 0 0;
  background: linear-gradient(180deg, #c4c0bc, var(--open) 48%, #fafaf9 100%);
  border: 2px dashed rgba(255, 233, 198, 0.75); border-bottom: none;
  box-shadow: inset 0 2px 3px rgba(0,0,0,0.3);
}
.hole-cell.back .hole.covered { border-color: #bbf7d0; }
/* A dotted riser from the tag up to the hole, saying "this one is round the
   back" without a legend. */
.hole-cell.back::after {
  content: ""; position: absolute; left: 50%; top: calc(var(--tube-bottom) + 0.1rem); bottom: calc(var(--tag-size) + 0.35rem); width: 0;
  border-left: 1px dotted var(--text-faint);
}
.hole-tag.back-tag { color: var(--text-dim); }
.hole-cell .hole.covered {
  background: linear-gradient(180deg, #86efac, var(--down-lit) 50%, var(--down) 100%);
  border-color: var(--down-edge);
  box-shadow: 0 0 0.5rem rgba(34, 197, 94, 0.55), inset 0 1px 2px rgba(255,255,255,0.45);
}
.hole-cell.back .hole.covered { background: linear-gradient(180deg, var(--down), var(--down-lit) 50%, #86efac 100%); }
.hole-cell .hole.off { outline: 2px solid rgba(217, 119, 6, 0.9); outline-offset: 2px; }
.hole-cell .hole:hover { border-color: #fff; }
.hole-tag { position: absolute; left: 0; right: 0; bottom: 0.1rem; text-align: center; font-size: var(--tag-size); font-weight: 800; font-style: normal; color: var(--text-faint); letter-spacing: 0.04em; white-space: nowrap; }
.flute-tip {
  position: absolute; right: 0.6rem; top: 0.1rem; z-index: 3; font-size: 0.66rem; font-weight: 700;
  color: var(--warn); background: var(--warn-soft); border: 1px solid #fde68a; border-radius: 999px; padding: 0.05rem 0.5rem;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
}

/* ── The roll ─────────────────────────────────────────────────────────────── */
.fr-wrap { position: relative; flex: 1; min-height: 0; overflow: hidden; background: #fff; }
/* Where nothing is played, nothing is drawn: a column is marked by a hairline,
   not by a fill, so a silence reads as silence. */
.fr-cols { position: absolute; inset: 0; z-index: 0; pointer-events: none; }
.fr-cols .cell-hole { border-left: 1px solid var(--border-soft); border-right: 1px solid var(--border-soft); }
.fr-cols .cell-hole i { position: absolute; inset: 0; display: block; }
.fr-cols .cell-gap.big { border-left: 1px dashed var(--border); }
.fr-cols .cell-lab { border-right: 1px solid var(--border-soft); }

.fr-view { position: absolute; inset: 0; z-index: 1; overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain; scrollbar-width: none; touch-action: pan-y; }
.fr-view::-webkit-scrollbar { display: none; }
.froll.editing .fr-view { cursor: crosshair; }
.fr-lane { position: relative; width: 100%; }

/* Time runs downwards in the lane, so a bar's line is its ceiling and its number
   hangs just below it. */
.fr-gridline { position: absolute; left: var(--ruler-w); right: 0; height: 0; border-top: 1px dotted var(--border-soft); }
.fr-gridline.bar { left: 0; border-top: 1px solid var(--border); }
.fr-barnum { position: absolute; left: 0.2rem; top: 0.1rem; font-size: var(--barnum-size); font-weight: 800; color: var(--text-faint); font-variant-numeric: tabular-nums; }

/* ── Notes ────────────────────────────────────────────────────────────────── */
.fnote { position: absolute; left: 0; right: 0; z-index: 1; cursor: pointer; user-select: none; }
/* Capped first, so every bar comes out the same width even though the thumb's
   column is narrower than the rest; the percentage only takes over when the
   deck gets tight enough that they all have to shrink together. */
.fnote .fbar { display: block; height: 100%; width: var(--fill); min-width: 0.5rem; margin: 0 auto; border-radius: var(--bar-r); background: var(--open); border: 1px solid var(--open-edge); }
.fnote .fbar.on { background: linear-gradient(180deg, var(--down-lit), var(--down)); border-color: var(--down-edge); box-shadow: 0 1px 3px rgba(21, 128, 61, 0.3); }

.fnote.done { opacity: 0.32; }
/* The note being played keeps the same green — green means covered, and that
   must not shift. It is called out by lighting the row it occupies instead, so
   the fingering itself stays the only thing the colour is saying. */
.fnote.current { z-index: 3; background: rgba(239, 68, 68, 0.07); box-shadow: inset 0 0 0 1px rgba(239, 68, 68, 0.28); }
.fnote.current .fbar.on { box-shadow: 0 0 0.7rem rgba(34, 197, 94, 0.6); }
.fnote.unplayable .fbar { border-style: dashed; border-color: var(--warn); background: var(--warn-soft); }
.fnote.unplayable .fbar.on { background: #fde68a; border-color: var(--warn); }
.fnote.selected { z-index: 5; }
.fnote.selected .fbar { outline: 2px solid rgba(239, 68, 68, 0.6); outline-offset: 1px; }
.froll.editing .fnote { cursor: grab; }
.froll.editing .fnote:active { cursor: grabbing; }

/* Right-aligned: the label belongs to the bars beside it, so it sits against
   them rather than drifting off to the far edge of the gutter. */
.fn-lab { display: flex; align-items: center; justify-content: flex-end; gap: 0.25rem; flex-wrap: wrap; align-content: center; text-align: right; padding: 0 0.55rem 0 0.25rem; overflow: hidden; }
.fn-pill { display: inline-flex; align-items: center; gap: 0.1rem; font-size: var(--label-size); font-weight: 800; line-height: 1.1; color: #44403c; }
.fnote.current .fn-pill { color: var(--down-edge); }
.fnote.unplayable .fn-pill { color: var(--warn); }
.fn-warn { font-style: normal; font-size: 0.7rem; }
.fn-fx { display: inline-flex; gap: 0.15rem; font-size: var(--fx-size); color: var(--text-faint); font-style: normal; }
.fn-fx i { font-style: normal; }
.fn-syl { flex-basis: 100%; font-size: var(--lyric-size); color: var(--text-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fnote.tight .fn-pill { font-size: 0.84rem; }
.fnote.tight .fn-syl, .fnote.tight .fn-fx { display: none; }
.fnote.tiny .fn-pill { font-size: 0.7rem; }

/* A tie is one sound across two notes: the halves touch, so a spine drawn down
   each of them reads as a single unbroken line. It hangs off the note itself,
   not the label cell, which clips its overflow. */
.fnote.ties-out .fn-lab, .fnote.tied-in .fn-lab { border-right: 2px solid var(--down-edge); }
/* The note's end is its lower edge now that the lane runs top-down. */
.fn-grip { position: absolute; left: var(--ruler-w); right: 0; bottom: -3px; height: 7px; cursor: ns-resize; z-index: 6; }
.froll.editing .fnote.selected .fn-grip { background: rgba(239, 68, 68, 0.35); border-radius: 999px; }

/* ── Viewport overlays ────────────────────────────────────────────────────── */
.fr-fade { position: absolute; left: 0; right: 0; top: 0; height: 2.1rem; background: linear-gradient(180deg, #fff 30%, rgba(255,255,255,0)); z-index: 2; pointer-events: none; }
.fr-now { position: absolute; left: 0; right: 0; top: var(--head-y); height: 0; border-top: 2px solid var(--accent-500); box-shadow: 0 0 14px rgba(239, 68, 68, 0.45); z-index: 4; pointer-events: none; }
.fr-now-lab { position: absolute; right: 0.35rem; top: -0.95rem; font-size: 0.56rem; font-weight: 800; letter-spacing: 0.08em; color: var(--accent-500); }
.fr-trace { position: absolute; left: var(--ruler-w); top: 0; bottom: 0; width: var(--trace-w); z-index: 3; pointer-events: none; }
/* The heard fingering sits in the strip above the line — the part of the roll
   that is already spent — so it never covers a note still to be played. */
.fr-heard { position: absolute; left: 0; right: 0; top: calc(var(--head-y) - 1.35rem); height: 1.15rem; z-index: 3; pointer-events: none; }
.fr-heard-lab { font-size: 0.56rem; font-weight: 800; color: #b45309; text-transform: uppercase; letter-spacing: 0.07em; display: flex; align-items: center; justify-content: flex-end; padding-right: 0.35rem; }
.fr-heard .hbar { display: block; height: 100%; width: var(--fill); margin: 0 auto; border-radius: 0.4rem; border: 1.5px dashed rgba(217, 119, 6, 0.55); }
.fr-heard .hbar.on { background: rgba(217, 119, 6, 0.5); border-style: solid; }
.fr-marquee { position: absolute; border: 1px dashed var(--accent-500); background: rgba(239, 68, 68, 0.08); z-index: 6; pointer-events: none; }
.fr-empty { position: absolute; inset: 0; display: grid; place-items: center; color: var(--text-faint); font-size: 0.875rem; text-align: center; padding: 1rem; z-index: 5; pointer-events: none; }

/* ── Right-click menu ─────────────────────────────────────────────────────── */
.fmenu-backdrop { position: fixed; inset: 0; z-index: 220; }
.fmenu { position: fixed; z-index: 221; width: 17.5rem; background: #fff; border: 1px solid var(--border); border-radius: 0.7rem; box-shadow: var(--shadow-lg); padding: 0.45rem; }
.fmenu-head { font-size: 0.72rem; font-weight: 700; color: var(--text-dim); padding: 0.15rem 0.35rem 0.35rem; }
.fmenu-label { font-size: 0.6rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.07em; color: var(--text-faint); padding: 0.25rem 0.35rem 0.2rem; }
.fmenu-label small { font-weight: 600; text-transform: none; letter-spacing: 0; opacity: 0.8; }
.fmenu-pitch { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.25rem; }
.fm-pitch { display: flex; flex-direction: column; align-items: center; gap: 0.1rem; padding: 0.3rem 0.1rem 0.25rem; border: 1px solid var(--border); border-radius: 0.45rem; background: var(--bg-card); cursor: pointer; }
.fm-pitch:hover { border-color: var(--accent-400); background: var(--accent-050); }
.fm-pitch.on { border-color: var(--accent-500); background: var(--accent-050); }
.fm-pitch b { font-size: 0.85rem; font-weight: 800; }
.fm-pitch small { font-size: 0.56rem; color: var(--text-faint); font-family: var(--mono); }
.fm-holes { display: flex; gap: 1px; margin-top: 0.1rem; }
.fm-holes i { width: 4px; height: 4px; border-radius: 50%; border: 1px solid #a8a29e; }
.fm-holes i.on { background: var(--text); border-color: var(--text); }
.fmenu-len { display: grid; grid-template-columns: repeat(8, 1fr); gap: 0.15rem; }
.fm-len { padding: 0.3rem 0; border: 1px solid var(--border); border-radius: 0.35rem; background: var(--bg-card); font-size: 0.7rem; font-weight: 700; cursor: pointer; }
.fm-len:hover { border-color: var(--accent-400); }
.fm-len.on { background: var(--accent-500); border-color: var(--accent-500); color: #fff; }
.fmenu-sep { height: 1px; background: var(--border-soft); margin: 0.4rem 0.2rem; }
.fmenu-item { display: flex; align-items: center; gap: 0.5rem; width: 100%; text-align: left; padding: 0.4rem 0.5rem; border-radius: 0.4rem; font-size: 0.82rem; color: var(--text); background: none; border: none; cursor: pointer; }
.fmenu-item i { font-size: 0.75rem; color: var(--text-faint); }
.fmenu-item:hover { background: var(--accent-050); }
.fmenu-item.danger { color: #c33; }
.fmenu-item.danger i { color: #c33; }
.fmenu-item.danger:hover { background: #fff0f0; }
.fmenu-hint { font-size: 0.7rem; color: var(--text-faint); padding: 0.2rem 0.4rem; line-height: 1.35; }
</style>
