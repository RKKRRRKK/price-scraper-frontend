<template>
  <g :class="['sprite', { selected, dimmed }]">
    <!-- ════ Resistor ════ -->
    <g v-if="body === 'resistor'" :transform="axisTransform">
      <line :x1="-axis.half" y1="0" :x2="-bodyHalf" y2="0" class="leg" />
      <line :x1="bodyHalf" y1="0" :x2="axis.half" y2="0" class="leg" />
      <rect :x="-bodyHalf" y="-6.5" :width="bodyHalf * 2" height="13" rx="6.5" class="res-body" />
      <rect :x="-bodyHalf + 2" y="-6" :width="bodyHalf * 2 - 4" height="3" rx="1.5" class="sheen" />
      <rect
        v-for="(b, i) in resBands" :key="i"
        :x="bandX(i)" y="-6.5" :width="bandW" height="13" :fill="b"
      />
    </g>

    <!-- ════ LED / IR emitter ════ -->
    <g v-else-if="body === 'led'" :transform="axisTransform">
      <line :x1="-axis.half" y1="0" :x2="-7" y2="0" class="leg leg-long" />
      <line :x1="7" y1="0" :x2="axis.half" y2="0" class="leg" />
      <rect x="-9.5" y="6" width="19" height="3.5" rx="1.5" :fill="ledRim" class="led-rim" />
      <circle cx="0" cy="0" r="9.5" :fill="ledFill" class="led-dome" />
      <ellipse cx="-3" cy="-3.2" rx="3.2" ry="2.2" fill="#ffffff" opacity="0.55" />
      <line x1="7.5" y1="-9" x2="7.5" y2="9" class="led-flat" />
      <text v-if="item.kind === 'ir_led_tsal6400'" x="0" y="3" class="chip-mini">IR</text>
    </g>

    <!-- ════ Ceramic cap (104) ════ -->
    <g v-else-if="body === 'ceramic-cap'" :transform="axisTransform">
      <line :x1="-axis.half" y1="0" :x2="-9" y2="0" class="leg" />
      <line :x1="9" y1="0" :x2="axis.half" y2="0" class="leg" />
      <path d="M -11 6 C -12 -10 12 -10 11 6 Z" class="cap-body" />
      <text x="0" y="0" class="chip-mini">104</text>
    </g>

    <!-- ════ Electrolytic cap (polarised can) ════ -->
    <g v-else-if="body === 'electrolytic-cap'" :transform="axisTransform">
      <line :x1="-axis.half" y1="0" x2="-11" y2="0" class="leg" />
      <line x1="11" y1="0" :x2="axis.half" y2="0" class="leg" />
      <rect x="-11" y="-21" width="22" height="31" rx="5" class="ecap-body" />
      <ellipse cx="0" cy="-21" rx="11" ry="3.2" class="ecap-top" />
      <path d="M 6 -16 V 6" class="ecap-stripe" />
      <path d="M 4 -9 h 4 M 4 -3 h 4 M 4 3 h 4" class="ecap-minus" />
    </g>

    <!-- ════ Buzzer (top view) ════ -->
    <g v-else-if="body === 'buzzer'" :transform="axisTransform">
      <line :x1="-axis.half" y1="0" x2="-12" y2="0" class="leg" />
      <line x1="12" y1="0" :x2="axis.half" y2="0" class="leg" />
      <circle cx="0" cy="0" r="13" class="buzz-body" />
      <circle cx="0" cy="0" r="8" class="buzz-ring" />
      <circle cx="0" cy="0" r="3.2" class="buzz-vent" />
    </g>

    <!-- ════ DC motor (can + shaft) ════ -->
    <g v-else-if="body === 'dc-motor'" :transform="axisTransform">
      <line :x1="-axis.half" y1="0" x2="-17" y2="0" class="leg" />
      <line x1="17" y1="0" :x2="axis.half" y2="0" class="leg" />
      <rect x="-17" y="-14" width="34" height="28" rx="7" class="motor-body" />
      <line x1="-7" y1="-14" x2="-7" y2="14" class="motor-rib" />
      <line x1="7" y1="-14" x2="7" y2="14" class="motor-rib" />
      <rect x="-4" y="-22" width="8" height="9" rx="2" class="motor-shaft" />
    </g>

    <!-- ════ Inductor (coil) ════ -->
    <g v-else-if="body === 'inductor'" :transform="axisTransform">
      <line :x1="-axis.half" y1="0" :x2="-bodyHalf" y2="0" class="leg ind-lead" />
      <line :x1="bodyHalf" y1="0" :x2="axis.half" y2="0" class="leg ind-lead" />
      <path :d="coilPath" class="ind-coil" />
    </g>

    <!-- ════ Reed switch (glass tube) ════ -->
    <g v-else-if="body === 'reed'" :transform="axisTransform">
      <line :x1="-axis.half" y1="0" :x2="-bodyHalf" y2="0" class="leg" />
      <line :x1="bodyHalf" y1="0" :x2="axis.half" y2="0" class="leg" />
      <rect :x="-bodyHalf" y="-6" :width="bodyHalf * 2" height="12" rx="6" class="reed-glass" />
      <path :d="reedBladeL" class="reed-blade" />
      <path :d="reedBladeR" class="reed-blade" />
    </g>

    <!-- ════ Diode ════ -->
    <g v-else-if="body === 'diode'" :transform="axisTransform">
      <line :x1="-axis.half" y1="0" :x2="-bodyHalf" y2="0" class="leg" />
      <line :x1="bodyHalf" y1="0" :x2="axis.half" y2="0" class="leg" />
      <rect :x="-bodyHalf" y="-5" :width="bodyHalf * 2" height="10" rx="2" class="diode-body" />
      <rect :x="-bodyHalf + 1.5" y="-5" width="3" height="10" class="diode-band" />
    </g>

    <!-- ════ Fuse (glass cartridge) ════ -->
    <g v-else-if="body === 'fuse'" :transform="axisTransform">
      <line :x1="-axis.half" y1="0" :x2="-bodyHalf" y2="0" class="leg" />
      <line :x1="bodyHalf" y1="0" :x2="axis.half" y2="0" class="leg" />
      <rect :x="-bodyHalf" y="-6" :width="bodyHalf * 2" height="12" rx="4" class="fuse-glass" />
      <rect :x="-bodyHalf" y="-6" width="4" height="12" rx="1.5" class="fuse-cap" />
      <rect :x="bodyHalf - 4" y="-6" width="4" height="12" rx="1.5" class="fuse-cap" />
      <path :d="`M ${-bodyHalf + 4} 0 L ${bodyHalf - 4} 0`" class="fuse-wire" />
    </g>

    <!-- ════ Push-button ════ -->
    <g v-else-if="body === 'button'" :transform="axisTransform">
      <line :x1="-axis.half" y1="0" x2="-11" y2="0" class="leg" />
      <line x1="11" y1="0" :x2="axis.half" y2="0" class="leg" />
      <rect x="-12" y="-12" width="24" height="24" rx="3" class="btn-body" />
      <circle cx="0" cy="0" r="6.5" class="btn-cap" />
      <circle cx="-2" cy="-2" r="2" class="btn-gloss" />
    </g>

    <!-- ════ TO-92 (transistor / DS18B20) ════ -->
    <g v-else-if="body === 'to92'" :transform="moduleTransform">
      <line v-for="(p, i) in mpts" :key="'l' + i" :x1="p.x" :y1="p.y" :x2="p.x" :y2="bodyBottom" class="leg" />
      <path :d="to92Path" class="to92-body" />
      <line :x1="modCx - to92HalfW + 2" :y1="bodyBottom - 1.5" :x2="modCx + to92HalfW - 2" :y2="bodyBottom - 1.5" class="to92-seam" />
      <text :x="modCx" :y="bodyTop + 13" class="chip-label">{{ shortPart }}</text>
    </g>

    <!-- ════ TSOP38238 IR receiver ════ -->
    <g v-else-if="body === 'irrx'" :transform="moduleTransform">
      <line v-for="(p, i) in mpts" :key="'l' + i" :x1="p.x" :y1="p.y" :x2="p.x" :y2="bodyBottom" class="leg" />
      <rect :x="modCx - 14" :y="bodyTop" width="28" height="20" rx="4" class="irrx-base" />
      <circle :cx="modCx" :cy="bodyTop + 4" r="9" class="irrx-dome" />
      <text :x="modCx" :y="bodyTop + 30" class="chip-label">IR&#8201;RX</text>
    </g>

    <!-- ════ Potentiometer ════ -->
    <g v-else-if="body === 'pot'" :transform="moduleTransform">
      <line v-for="(p, i) in mpts" :key="'l' + i" :x1="p.x" :y1="p.y" :x2="p.x" :y2="bodyBottom" class="leg" />
      <rect :x="modCx - 16" :y="bodyTop" width="32" height="22" rx="3" class="pot-base" />
      <circle :cx="modCx" :cy="bodyTop - 4" r="14" class="pot-knob" />
      <circle :cx="modCx - 4" :cy="bodyTop - 8" r="3" class="pot-gloss" />
      <line :x1="modCx" :y1="bodyTop - 4" :x2="modCx" :y2="bodyTop - 16" class="pot-ind" />
    </g>

    <!-- ════ Trimpot (square trimmer + screw) ════ -->
    <g v-else-if="body === 'trimpot'" :transform="moduleTransform">
      <line v-for="(p, i) in mpts" :key="'l' + i" :x1="p.x" :y1="p.y" :x2="p.x" :y2="bodyBottom" class="leg" />
      <rect :x="modCx - 16" :y="bodyBottom - 26" width="32" height="26" rx="2.5" class="trim-body" />
      <circle :cx="modCx" :cy="bodyBottom - 13" r="9" class="trim-screw" />
      <line :x1="modCx - 6" :y1="bodyBottom - 13" :x2="modCx + 6" :y2="bodyBottom - 13" class="trim-slot" />
    </g>

    <!-- ════ I²C breakout (VEML7700 / BME280) ════ -->
    <g v-else-if="body === 'breakout'" :transform="moduleTransform">
      <line v-for="(p, i) in mpts" :key="'l' + i" :x1="p.x" :y1="p.y" :x2="p.x" :y2="bodyBottom" class="leg" />
      <rect
        v-for="(p, i) in mpts" :key="'pad' + i"
        :x="p.x - 3.5" :y="bodyBottom - 4" width="7" height="7" rx="1.5" class="pad"
      />
      <rect
        :x="firstPin.x - 11" :y="bodyTop" :width="pinSpan + 22" :height="breakoutH" rx="4"
        class="breakout-pcb" :style="{ stroke: item.props?.accent || tplAccent }"
      />
      <rect
        :x="firstPin.x - 11" :y="bodyTop" :width="pinSpan + 22" height="7" rx="4"
        class="breakout-header" :style="{ fill: item.props?.accent || tplAccent }"
      />
      <rect :x="modCx - 8" :y="bodyTop + 12" width="16" height="14" rx="2" class="breakout-chip" />
      <text :x="modCx" :y="bodyTop + breakoutH - 5" class="chip-label">{{ shortPart }}</text>
    </g>

    <!-- ════ IC / DIP ════ -->
    <g v-else-if="body === 'dip'">
      <line v-for="(p, i) in pts" :key="'l' + i" :x1="p.x" :y1="p.y" :x2="clamp(p.x)" :y2="dipEdge(p)" class="leg leg-short" />
      <rect :x="dip.x" :y="dip.y" :width="dip.w" :height="dip.h" rx="3" class="dip-body" />
      <rect :x="dip.x + 2" :y="dip.y + 2" :width="dip.w - 4" height="3" rx="1.5" class="dip-sheen" />
      <path :d="dipNotch" class="dip-notch" />
      <circle :cx="dip.x + 7" :cy="dip.y + dip.h - 7" r="2.2" class="dip-dot" />
      <text :x="dip.x + dip.w / 2" :y="dip.y + dip.h / 2 + 4" class="chip-label light">{{ shortPart || 'IC' }}</text>
    </g>

    <!-- ════ 7-segment display ════ -->
    <g v-else-if="body === 'seg7'">
      <line v-for="(p, i) in pts" :key="'l' + i" :x1="p.x" :y1="p.y" :x2="clamp(p.x)" :y2="dipEdge(p)" class="leg leg-short" />
      <rect :x="dip.x" :y="dip.y" :width="dip.w" :height="dip.h" rx="3" class="seg-panel" />
      <line v-for="(s, i) in seg7Lines" :key="'s' + i" :x1="s.x1" :y1="s.y1" :x2="s.x2" :y2="s.y2" class="seg-on" />
    </g>

    <!-- ════ Standalone board (Pi / ESP32 / custom) ════ -->
    <g v-else-if="body === 'board' && boardLayout">
      <rect
        :x="boardLayout.rect.x" :y="boardLayout.rect.y" :width="boardLayout.rect.w" :height="boardLayout.rect.h"
        rx="8" class="board-pcb" :style="{ fill: boardColor }"
      />
      <rect
        :x="boardLayout.rect.x" :y="boardLayout.rect.y" :width="boardLayout.rect.w" height="26"
        rx="8" class="board-header" :style="{ fill: boardAccent }"
      />
      <rect :x="boardLayout.rect.x + 5" :y="boardLayout.rect.y + 4" width="18" height="18" rx="3" class="board-thumb-bg" />
      <image :href="iconUrl(item.kind)" :x="boardLayout.rect.x + 5.5" :y="boardLayout.rect.y + 4.5" width="17" height="17" preserveAspectRatio="xMidYMid meet" />
      <text :x="boardLayout.rect.x + 28" :y="boardLayout.rect.y + 17" class="board-title">{{ item.label }}</text>
      <!-- pin pads + labels -->
      <g v-for="p in boardLayout.pins" :key="p.id">
        <rect :x="p.x - 4" :y="p.y - 4" width="8" height="8" rx="1.5" class="board-pad" :class="padClass(p.name)" />
        <text
          :x="p.side === 'L' ? p.x + 9 : p.x - 9" :y="p.y + 3"
          :text-anchor="p.side === 'L' ? 'start' : 'end'" class="board-pin-label"
        >{{ p.name }}</text>
      </g>
    </g>

    <!-- selection outline + label tag -->
    <rect
      v-if="selected" :x="bbox.x" :y="bbox.y" :width="bbox.w" :height="bbox.h"
      rx="6" class="sel-outline"
    />
    <g v-if="showTag" :transform="`translate(${bbox.x}, ${bbox.y - 16})`">
      <rect x="0" y="0" :width="tagW" height="14" rx="3" class="tag-bg" />
      <text x="5" y="10.5" class="tag-text">{{ item.label }}</text>
    </g>
  </g>
</template>

<script setup>
import { computed } from 'vue'
import { inlinePinXY, itemBounds, PITCH } from '@/lib/breadboard/geometry'
import { getTemplate, valueToBands, BAND_COLORS, iconUrl } from '@/lib/breadboard/templates'

const props = defineProps({
  item: { type: Object, required: true },
  layout: { type: Object, default: null },
  boardLayout: { type: Object, default: null },
  selected: { type: Boolean, default: false },
  dimmed: { type: Boolean, default: false },
})

const tpl = computed(() => getTemplate(props.item.kind))
const isStandalone = computed(
  () => (props.item.placement || tpl.value?.placement) === 'standalone',
)
const body = computed(() =>
  isStandalone.value ? 'board' : props.item.body || tpl.value?.body || 'resistor',
)
const tplAccent = computed(() => tpl.value?.accent || '#5a4fb0')

// pin coordinates in scene space
const pts = computed(() =>
  props.item.pins.map((pin, i) => inlinePinXY(props.layout, props.item, pin, i)),
)

// ── 2-leg axis ──
const axis = computed(() => {
  const a = pts.value[0] || { x: 0, y: 0 }
  const b = pts.value[1] || { x: a.x + PITCH, y: a.y }
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy) || PITCH
  return { mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, ang: (Math.atan2(dy, dx) * 180) / Math.PI, half: len / 2 }
})
const axisTransform = computed(() => `translate(${axis.value.mx}, ${axis.value.my}) rotate(${axis.value.ang})`)
const bodyHalf = computed(() => Math.min(axis.value.half - 6, 22))

// inductor coil path (semicircle bumps along the axis)
const coilPath = computed(() => {
  const r = 4.5
  const h = bodyHalf.value
  const n = Math.max(3, Math.round((2 * h) / (2 * r)))
  let d = `M ${-h} 0`
  for (let i = 0; i < n; i++) d += ` a ${r} ${r} 0 0 1 ${2 * r} 0`
  return d
})
// reed-switch contact blades (overlap near centre with a small gap)
const reedBladeL = computed(() => `M ${-bodyHalf.value + 1} 0 H 2 l 2 -2`)
const reedBladeR = computed(() => `M ${bodyHalf.value - 1} 0 H -2 l -2 2`)

// resistor bands
const resBands = computed(() => valueToBands(props.item.props?.ohms).map((n) => BAND_COLORS[n] || '#333'))
const bandW = 3.6
function bandX(i) {
  const start = -bodyHalf.value + 6
  return start + i * (bandW + 3)
}

// LED fill
const LED_COLORS = {
  red: '#e8403a', green: '#36c25a', blue: '#3a7be8', yellow: '#f2c41d',
  white: '#eef0f2', orange: '#f0810f', amber: '#ffbf00',
}
// slightly darker rim flange per LED colour
const LED_RIM = {
  red: '#c4332e', green: '#2ba049', blue: '#2f63c0', yellow: '#cfa613',
  white: '#cfd3d8', orange: '#cc6c0c', amber: '#d8a200',
}
const ledFill = computed(() => {
  if (props.item.kind === 'ir_led_tsal6400') return '#9ec3e0'
  return LED_COLORS[props.item.props?.color] || LED_COLORS.red
})
const ledRim = computed(() => {
  if (props.item.kind === 'ir_led_tsal6400') return '#7fa6c6'
  return LED_RIM[props.item.props?.color] || LED_RIM.red
})

// ── module orientation ──
// Multi-pin modules (TO-92, sensors, pot) draw a body above a *horizontal* pin row.
// To support pins placed down a column (or any line) we flatten the pins onto a
// horizontal row through their centroid (`mpts`), keep all the body math simple,
// then rotate the whole group back onto the real holes with `moduleTransform`.
const moduleCenter = computed(() => {
  const ps = pts.value
  if (!ps.length) return { x: 0, y: 0 }
  const a = ps[0]
  const b = ps[ps.length - 1]
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
})
const moduleAngle = computed(() => {
  const ps = pts.value
  if (ps.length < 2) return 0
  const a = ps[0]
  const b = ps[ps.length - 1]
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI
})
const moduleTransform = computed(
  () => `rotate(${moduleAngle.value} ${moduleCenter.value.x} ${moduleCenter.value.y})`,
)
const mpts = computed(() => {
  const ps = pts.value
  const c = moduleCenter.value
  if (ps.length < 2) return ps.map((p) => ({ x: p?.x ?? c.x, y: p?.y ?? c.y }))
  const a = ps[0]
  const b = ps[ps.length - 1]
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
  const nx = (b.x - a.x) / len
  const ny = (b.y - a.y) / len
  // project each pin onto the axis → horizontal row at centroid y
  return ps.map((p) => ({ x: c.x + ((p.x - c.x) * nx + (p.y - c.y) * ny), y: c.y }))
})

// ── modules sitting above a row of pins (computed in the flattened frame) ──
const modCx = computed(() => {
  const xs = mpts.value.map((p) => p.x)
  return xs.reduce((s, x) => s + x, 0) / (xs.length || 1)
})
const pinRowY = computed(() => mpts.value[0]?.y ?? 0)
const bodyBottom = computed(() => pinRowY.value - 12)
const moduleH = computed(() => (body.value === 'breakout' ? breakoutH.value : 22))
const bodyTop = computed(() => bodyBottom.value - moduleH.value)
const firstPin = computed(() => mpts.value[0] || { x: modCx.value, y: pinRowY.value })
const pinSpan = computed(() => {
  const xs = mpts.value.map((p) => p.x)
  return Math.max(...xs, modCx.value) - Math.min(...xs, modCx.value)
})
const breakoutH = computed(() => 34)

// TO-92 D-shape path
const to92HalfW = computed(() => Math.max(pinSpan.value + 16, 22) / 2)
const to92Path = computed(() => {
  const cx = modCx.value
  const w = to92HalfW.value * 2
  const top = bodyTop.value
  const bot = bodyBottom.value
  const l = cx - w / 2
  const r = cx + w / 2
  return `M ${l} ${bot} L ${r} ${bot} L ${r} ${top + 6} Q ${cx} ${top - 6} ${l} ${top + 6} Z`
})

// part labels
const shortPart = computed(() => {
  const p = props.item.props || {}
  if (props.item.kind === 'ds18b20') return 'DS18B20'
  if (props.item.kind === 'transistor') return p.part || 'NPN'
  if (props.item.kind === 'veml7700') return 'VEML7700'
  if (props.item.kind === 'bme280') return 'BME280'
  if (props.item.kind === 'ic') return p.part || ''
  return p.part || p.partNumber || ''
})

// ── DIP geometry ──
const dip = computed(() => {
  const xs = pts.value.map((p) => p.x)
  const ys = pts.value.map((p) => p.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  return { x: minX - 4, y: minY + 4, w: maxX - minX + 8, h: Math.max(maxY - minY - 8, 14) }
})
const dipNotch = computed(() => {
  const d = dip.value
  const cx = d.x + d.w / 2
  return `M ${cx - 5} ${d.y} A 5 5 0 0 0 ${cx + 5} ${d.y}`
})
function dipEdge(p) {
  const d = dip.value
  return p.y < d.y + d.h / 2 ? d.y : d.y + d.h
}
function clamp(x) {
  return x
}

// ── 7-segment digits, sized to the DIP rect ──
function digit8(ox, top, bot, mid, w) {
  return [
    [ox, top, ox + w, top], [ox + w, top, ox + w, mid], [ox + w, mid, ox + w, bot],
    [ox, bot, ox + w, bot], [ox, mid, ox, bot], [ox, top, ox, mid], [ox, mid, ox + w, mid],
  ].map((s) => ({ x1: s[0], y1: s[1], x2: s[2], y2: s[3] }))
}
const seg7Lines = computed(() => {
  const d = dip.value
  const dh = Math.min(d.h - 8, 22)
  const w = 8
  const gap = 7
  const cy = d.y + d.h / 2
  const top = cy - dh / 2
  const bot = cy + dh / 2
  const total = w * 2 + gap
  const sx = d.x + d.w / 2 - total / 2
  return [...digit8(sx, top, bot, cy, w), ...digit8(sx + w + gap, top, bot, cy, w)]
})

// ── board colors ──
const boardAccent = computed(() => props.item.props?.accent || tpl.value?.accent || '#6b7280')
const boardColor = computed(() => props.item.props?.board || tpl.value?.board || '#374151')
function padClass(name) {
  const s = String(name).toUpperCase()
  if (/GND/.test(s)) return 'pad-gnd'
  if (/5V|3V3|VCC|VDD|VIN|3VO/.test(s)) return 'pad-pwr'
  return ''
}

// ── bounding box (selection + tag) — shared with the canvas hit-test ──
const bbox = computed(() => itemBounds(props.layout, props.item, props.boardLayout))
const showTag = computed(() => props.selected)
const tagW = computed(() => 12 + (props.item.label?.length || 1) * 6)
</script>

<style scoped>
.sprite {
  transition: opacity 0.12s;
}
.sprite.dimmed {
  opacity: 0.15;
}
.leg {
  stroke: #b3ac98;
  stroke-width: 2px;
  stroke-linecap: round;
}
.leg-long {
  stroke: #c4bca4;
}
.leg-short {
  stroke-width: 2.4px;
  stroke: #bcbcbc;
}
/* shared specular highlight on rounded bodies */
.sheen {
  fill: #ffffff;
  opacity: 0.28;
}
.res-body {
  fill: #e6cb9b;
  stroke: #b89564;
  stroke-width: 1px;
}
.led-dome {
  stroke: rgba(0, 0, 0, 0.28);
  stroke-width: 1px;
}
.led-rim {
  stroke: rgba(0, 0, 0, 0.28);
  stroke-width: 1px;
}
.led-flat {
  stroke: rgba(0, 0, 0, 0.38);
  stroke-width: 1.5px;
}
.cap-body {
  fill: #2f6fae;
  stroke: #234f7d;
  stroke-width: 1px;
}
.diode-band {
  fill: #e6e6e6;
}
.btn-body {
  fill: #3a4252;
  stroke: #2a313e;
  stroke-width: 1px;
}
.btn-cap {
  fill: #cf4a44;
  stroke: #9c332e;
  stroke-width: 1px;
}
.btn-gloss {
  fill: #ffffff;
  opacity: 0.4;
}
.to92-body {
  fill: #26252a;
  stroke: #000;
  stroke-width: 0.5px;
}
.to92-seam {
  stroke: #4a4a52;
  stroke-width: 1.2px;
}
.irrx-base {
  fill: #26252a;
}
.irrx-dome {
  fill: #1b1b1b;
  stroke: #444;
  stroke-width: 1px;
}
.pot-base {
  fill: #2f6fae;
  stroke: #234f7d;
}
.pot-knob {
  fill: #d8dde4;
  stroke: #98a1ae;
  stroke-width: 1.5px;
}
.pot-gloss {
  fill: #ffffff;
  opacity: 0.5;
}
.pot-ind {
  stroke: #3a4252;
  stroke-width: 2px;
  stroke-linecap: round;
}
.pad {
  fill: #d8c47a;
  stroke: #b39f55;
  stroke-width: 0.5px;
}
.breakout-pcb {
  fill: #2a3140;
  stroke-width: 2px;
}
.breakout-header {
  opacity: 0.9;
}
.breakout-chip {
  fill: #15161c;
  stroke: #3a3f4a;
  stroke-width: 0.5px;
}
.dip-body {
  fill: #1f1f24;
  stroke: #000;
}
.dip-sheen {
  fill: #ffffff;
  opacity: 0.12;
}
.dip-notch {
  fill: none;
  stroke: #55555e;
  stroke-width: 1px;
}
.dip-dot {
  fill: #55555e;
}
.board-pcb {
  stroke: rgba(0, 0, 0, 0.3);
  stroke-width: 1px;
}
.board-header {
  opacity: 0.95;
}
.board-title {
  fill: #fff;
  font-size: 12px;
  font-weight: 700;
}
.board-pad {
  fill: #e8cf6b;
  stroke: #b39f55;
  stroke-width: 0.5px;
}
.board-pad.pad-gnd {
  fill: #6b7280;
}
.board-pad.pad-pwr {
  fill: #e0584d;
}
.board-pin-label {
  fill: #dfe3ea;
  font-size: 8.5px;
  font-weight: 600;
}
.chip-label {
  fill: #cfcfcf;
  font-size: 8px;
  font-weight: 700;
  text-anchor: middle;
}
.chip-label.light {
  fill: #e6e6e6;
}
.chip-mini {
  fill: #fff;
  font-size: 7px;
  font-weight: 800;
  text-anchor: middle;
}
.sel-outline {
  fill: rgba(20, 184, 166, 0.06);
  stroke: #14b8a6;
  stroke-width: 1.5px;
  stroke-dasharray: 5 3;
}
.tag-bg {
  fill: #14b8a6;
}
.tag-text {
  fill: #fff;
  font-size: 9px;
  font-weight: 700;
}

/* ── electrolytic cap ── */
.diode-body {
  fill: #26252a;
  stroke: #000;
  stroke-width: 0.5px;
}
.fuse-glass {
  fill: rgba(200, 220, 235, 0.45);
  stroke: #8a9bb0;
  stroke-width: 1px;
}
.fuse-cap {
  fill: #b8bcc2;
  stroke: #8a8f96;
  stroke-width: 0.5px;
}
.fuse-wire {
  fill: none;
  stroke: #6b7280;
  stroke-width: 1.4px;
}
.ecap-body {
  fill: #23314a;
  stroke: #16202f;
  stroke-width: 1px;
}
.ecap-top {
  fill: #34466a;
  stroke: #16202f;
  stroke-width: 1px;
}
.ecap-stripe {
  stroke: #cdd6e2;
  stroke-width: 5px;
  stroke-linecap: round;
}
.ecap-minus {
  stroke: #23314a;
  stroke-width: 1.4px;
  stroke-linecap: round;
}
/* ── buzzer ── */
.buzz-body {
  fill: #1f1f24;
  stroke: #000;
  stroke-width: 0.5px;
}
.buzz-ring {
  fill: none;
  stroke: #3a3a42;
  stroke-width: 1.5px;
}
.buzz-vent {
  fill: none;
  stroke: #6a6a72;
  stroke-width: 1.6px;
}
/* ── DC motor ── */
.motor-body {
  fill: #bcc0c7;
  stroke: #8d929b;
  stroke-width: 1px;
}
.motor-rib {
  stroke: #9197a0;
  stroke-width: 1.5px;
}
.motor-shaft {
  fill: #9197a0;
  stroke: #6f747c;
  stroke-width: 1px;
}
/* ── inductor ── */
.ind-lead {
  stroke: #b5762f;
}
.ind-coil {
  fill: none;
  stroke: #cf8a3a;
  stroke-width: 4px;
  stroke-linecap: round;
}
/* ── reed switch ── */
.reed-glass {
  fill: #dce6ec;
  fill-opacity: 0.5;
  stroke: #9bb0bd;
  stroke-width: 1.2px;
}
.reed-blade {
  fill: none;
  stroke: #8d929b;
  stroke-width: 1.6px;
  stroke-linecap: round;
}
/* ── trimpot ── */
.trim-body {
  fill: #2f6fae;
  stroke: #234f7d;
  stroke-width: 1px;
}
.trim-screw {
  fill: #c9a23b;
  stroke: #8a6f1f;
  stroke-width: 1px;
}
.trim-slot {
  stroke: #7a5e16;
  stroke-width: 2px;
  stroke-linecap: round;
}
/* ── 7-segment ── */
.seg-panel {
  fill: #1b1b20;
  stroke: #000;
  stroke-width: 0.5px;
}
.seg-on {
  stroke: #e5463d;
  stroke-width: 2.4px;
  stroke-linecap: round;
}
.board-thumb-bg {
  fill: #ffffff;
  opacity: 0.92;
}
</style>
