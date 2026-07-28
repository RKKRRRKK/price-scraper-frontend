<template>
  <div class="a4-staff" :class="[`v-${variant}`, { 'has-ly': lyricsOn, 'has-arc': hasArc, pinyin: script === 'pinyin' }]">
    <div
      v-for="(line, li) in grouped"
      :key="li"
      class="a4-line"
      :class="{ zone: isCurrentLine(line) }"
    >
      <span
        v-for="(g, gi) in line.groups"
        :key="gi"
        class="a4-grp"
        :class="{ linked: g.linked, tie: g.tie, open: g.open, 'open-left': g.openLeft }"
      >
        <template v-for="(m, mi) in g.marks" :key="mi">
          <span class="a4-n" :class="{ cur: isCurrent(m.n) }">
            <span v-if="m.n.art" class="art">{{ artLabel(m.n.art) }}</span>
            <span v-if="m.vib" class="mk mk-vib" :title="vibTitle(m.vib)">{{ m.vib === 3 ? '≋' : '〜' }}</span>
            <span v-if="m.bend" class="mk mk-bend" :title="bendTitle(m.bend)">{{ m.bend < 0 ? '⌄' : '⌃' }}</span>
            <span v-if="m.glIn" class="gl gl-in" title="Slide into the note">{{ m.glIn }}</span>
            <span class="num" :class="'u' + jianpuDuration(m.n.beats).underlines">
              <span v-if="octDots(m.n.oct, true)" class="dots dots-hi"><i v-for="d in octDots(m.n.oct, true)" :key="'h' + d"></i></span>
              <span v-if="m.n.acc" class="acc">{{ accGlyph(m.n.acc) }}</span>{{ m.n.deg || '0' }}
              <span v-if="octDots(m.n.oct, false)" class="dots dots-lo"><i v-for="d in octDots(m.n.oct, false)" :key="'l' + d"></i></span>
            </span>
            <span v-if="m.glOff" class="gl gl-off" title="Fall away">⟍</span>
            <span v-if="jianpuDuration(m.n.beats).dot" class="aug">·</span>
            <span v-for="d in jianpuDuration(m.n.beats).dashes" :key="'d' + d" class="dash">–</span>
            <span v-if="lyricsOn && syl(m.n)" class="a4-ly">{{ syl(m.n) }}</span>
          </span>
          <span v-if="m.glTo" class="gl gl-to" title="Glissando to the next note">{{ m.glTo }}</span>
        </template>
      </span>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { jianpuDuration } from '@/lib/bawu/notes'

// The transcribed-jianpu sheet, shared by the docked score panel and the phone
// reader — two places that used to carry near-identical markup. It renders the
// flattened note list (rests included) rather than the stored lines, so the
// expression marks flattenScore() has already settled are what get drawn.
const props = defineProps({
  // Flattened notes grouped by printed line: Array<Array<note>>.
  lines: { type: Array, default: () => [] },
  current: { type: Object, default: null },
  lyricsOn: { type: Boolean, default: false },
  script: { type: String, default: 'chinese' }, // 'chinese' | 'pinyin'
  variant: { type: String, default: 'panel' }, // 'panel' | 'phone'
})

// A run of notes joined by ties or slurs is drawn under one arc, so it has to
// be one inline-flex box: that also stops a phrase from wrapping mid-arc, which
// is what a printed score does anyway. Everything else is a group of one.
//
// A chain can cross a printed line boundary — the arc then runs off the end of
// one line (`open`) and picks up at the start of the next (`openLeft`).
const grouped = computed(() =>
  props.lines.map((line) => {
    const groups = []
    let cur = null
    line.forEach((n, i) => {
      const prev = line[i - 1]
      const next = line[i + 1]
      const mark = {
        n,
        glIn: n.gi ? (prev && !prev.rest && prev.midi > n.midi ? '⟍' : '⟋') : '',
        glOff: n.go === 'off' ? 1 : 0,
        glTo: n.go === 'to' ? (next && !next.rest && next.midi < n.midi ? '⟍' : '⟋') : '',
        bend: n.bd || 0,
        vib: n.vb || 0,
      }
      if (!cur) cur = { marks: [], linked: false, tie: false, open: false, openLeft: i === 0 && n.noAttack }
      cur.marks.push(mark)
      if (!n.rest && (n.ti || n.sl)) {
        cur.linked = true
        if (n.ti) cur.tie = true
      } else {
        groups.push(cur)
        cur = null
      }
    })
    if (cur) {
      cur.open = true // the chain carries on into the next printed line
      groups.push(cur)
    }
    return { groups, lineIdx: line[0]?.lineIdx ?? -1 }
  }),
)

const hasArc = computed(() => props.lines.some((line) => line.some((n) => n.ti || n.sl)))

function isCurrent(n) {
  return !!props.current && !n.rest && n.start === props.current.start
}
function isCurrentLine(line) {
  return !!props.current && line.lineIdx === props.current.lineIdx
}
// Either script falls back to the other, so a pinyin-only pass still prints
// something under the digits when 中文 is selected (and vice versa).
function syl(n) {
  if (!n || n.rest) return ''
  return props.script === 'pinyin' ? n.py || n.ly || '' : n.ly || n.py || ''
}
function accGlyph(acc) {
  return acc === 1 ? '♯' : acc === -1 ? '♭' : acc === 2 ? '♮' : ''
}
function artLabel(art) {
  return ({ T: 'T', TK: 'TK', tr: 'tr', grace: 'gr' })[art] || ''
}
function octDots(oct, above) {
  const n = above ? Math.max(0, oct) : Math.max(0, -oct)
  return Math.min(2, n)
}
function bendTitle(bd) {
  return `Bend ${bd > 0 ? '+' : ''}${bd} semitone${Math.abs(bd) === 1 ? '' : 's'}`
}
function vibTitle(vb) {
  return ['', 'Gentle vibrato', 'Wide vibrato', 'Flutter tongue'][vb] || ''
}
</script>

<style scoped>
.a4-staff { display: flex; flex-direction: column; gap: 1.1rem; }
.a4-staff.pinyin { --a4-gap-x: 0.75rem; }
.a4-line { display: flex; flex-wrap: wrap; gap: 0.45rem var(--a4-gap-x, 0.5rem); justify-content: center; align-items: flex-end; padding: 0.45rem 0.25rem; border-radius: 0.3rem; }
.a4-staff.has-arc .a4-line { padding-top: 1.15rem; }
.a4-line.zone { outline: 1px dashed var(--warn); outline-offset: 2px; background: rgba(217, 119, 6, 0.04); }

/* A tie/slur group: one inline box so the arc has something to span. */
.a4-grp { position: relative; display: inline-flex; align-items: flex-end; gap: var(--a4-gap-x, 0.5rem); }
.a4-grp.linked::before {
  content: '';
  position: absolute;
  left: 0.4em;
  right: 0.4em;
  bottom: 100%;
  height: 0.45em;
  margin-bottom: 0.55em;
  border-top: 1.5px solid var(--text-dim);
  border-radius: 50% / 100% 100% 0 0;
  pointer-events: none;
}
/* A tie is the tighter, darker arc; a slur arches further over the phrase. */
.a4-grp.linked.tie::before { height: 0.3em; border-color: var(--text); }
.a4-grp.linked.open::before { right: -0.3em; border-top-right-radius: 0; }
.a4-grp.linked.open-left::before { left: -0.3em; border-top-left-radius: 0; }

.a4-n { position: relative; display: inline-flex; align-items: flex-end; gap: 0.08em; font-size: 1.1rem; font-weight: 600; line-height: 1.2; padding: 0.1em; border-radius: 0.2rem; }
.a4-staff.pinyin .a4-n { min-width: 2.125rem; justify-content: center; }
.a4-n .num { position: relative; display: inline-block; }
.a4-n .num .acc { font-size: 0.68em; vertical-align: 0.2em; margin-right: 0.02em; color: var(--text-dim); }
.a4-n .dots { position: absolute; left: 50%; transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; gap: 1.5px; }
.a4-n .dots-hi { bottom: 100%; margin-bottom: 2px; }
.a4-n .dots-lo { top: 100%; margin-top: 4px; }
.a4-n .dots i { width: 3px; height: 3px; border-radius: 50%; background: currentColor; display: block; }
.a4-n .num.u1, .a4-n .num.u2, .a4-n .num.u3 { border-bottom: 1.5px solid currentColor; padding-bottom: 1px; }
.a4-n .num.u2::after, .a4-n .num.u3::after { content: ''; position: absolute; left: 0; right: 0; bottom: -3.5px; border-bottom: 1.5px solid currentColor; }
.a4-n .num.u3::before { content: ''; position: absolute; left: 0; right: 0; bottom: -6.5px; border-bottom: 1.5px solid currentColor; }
.a4-n .art { position: absolute; top: -0.85em; left: 50%; transform: translateX(-50%); font-size: 0.52em; font-weight: 800; letter-spacing: 0.02em; color: var(--accent-600); white-space: nowrap; }
.a4-n .aug { font-size: 0.9em; color: var(--text-dim); align-self: center; }
.a4-n .dash { color: var(--text-dim); font-weight: 400; }

/* Expression marks: slides sit on the baseline beside the digit, bend and
   vibrato ride above it beside the articulation tag. */
.gl { color: var(--warn); font-weight: 700; font-size: 0.8em; align-self: center; }
.a4-n .gl-in { margin-right: -0.1em; }
.a4-n .gl-off { margin-left: -0.1em; }
.gl-to { align-self: center; margin: 0 -0.15em; }
.a4-n .mk { position: absolute; top: -0.8em; font-size: 0.6em; font-weight: 800; color: var(--warn); line-height: 1; }
.a4-n .mk-bend { right: -0.15em; }
.a4-n .mk-vib { left: -0.15em; }

.a4-staff.has-ly .a4-line { padding-bottom: 1.15rem; }
.a4-n .a4-ly { position: absolute; top: 100%; left: 50%; transform: translateX(-50%); margin-top: 4px; font-size: 0.72rem; font-weight: 500; color: var(--text-dim); white-space: nowrap; }
.a4-n.cur .a4-ly { color: var(--accent-600); }
.a4-n.cur { background: rgba(239, 68, 68, 0.12); outline: 2px solid var(--accent-500); outline-offset: 1px; color: var(--accent-600); }
.a4-n.cur .num .acc, .a4-n.cur .aug, .a4-n.cur .dash { color: var(--accent-600); }

/* Phone reader: bigger digits, more air between them. */
.a4-staff.v-phone { gap: 1.6rem; }
.a4-staff.v-phone .a4-n { font-size: 1.3rem; }
.a4-staff.v-phone .a4-line { gap: 0.6rem var(--a4-gap-x, 0.65rem); padding-bottom: 1.5rem; }
.a4-staff.v-phone.pinyin { --a4-gap-x: 0.95rem; }
.a4-staff.v-phone .a4-n .a4-ly { font-size: 0.85rem; }
</style>
