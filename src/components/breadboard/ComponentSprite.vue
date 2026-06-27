<template>
  <g :class="['sprite', { selected, dimmed }]">
    <!-- ════ Resistor ════ -->
    <g v-if="body === 'resistor'" :transform="axisTransform">
      <line :x1="-axis.half" y1="0" :x2="-bodyHalf" y2="0" class="leg" />
      <line :x1="bodyHalf" y1="0" :x2="axis.half" y2="0" class="leg" />
      <rect :x="-bodyHalf" y="-6.5" :width="bodyHalf * 2" height="13" rx="6.5" class="res-body" />
      <rect
        v-for="(b, i) in resBands" :key="i"
        :x="bandX(i)" y="-6.5" :width="bandW" height="13" :fill="b"
      />
    </g>

    <!-- ════ LED / IR emitter ════ -->
    <g v-else-if="body === 'led'" :transform="axisTransform">
      <line :x1="-axis.half" y1="0" :x2="-7" y2="0" class="leg leg-long" />
      <line :x1="7" y1="0" :x2="axis.half" y2="0" class="leg" />
      <circle cx="0" cy="0" r="9.5" :fill="ledFill" class="led-dome" />
      <ellipse cx="-3" cy="-3" rx="3.2" ry="2.2" fill="#ffffff" opacity="0.6" />
      <line x1="7.5" y1="-9" x2="7.5" y2="9" class="led-flat" />
      <text v-if="item.kind === 'ir_led_tsal6400'" x="0" y="3" class="chip-mini">IR</text>
    </g>

    <!-- ════ Ceramic cap (104) ════ -->
    <g v-else-if="body === 'ceramic-cap'" :transform="axisTransform">
      <line :x1="-axis.half" y1="0" :x2="-9" y2="0" class="leg" />
      <line :x1="9" y1="0" :x2="axis.half" y2="0" class="leg" />
      <path d="M -10 6 Q 0 -16 10 6 Z" class="cap-body" />
      <text x="0" y="2" class="chip-mini dark">104</text>
    </g>

    <!-- ════ Diode ════ -->
    <g v-else-if="body === 'diode'" :transform="axisTransform">
      <line :x1="-axis.half" y1="0" :x2="-bodyHalf" y2="0" class="leg" />
      <line :x1="bodyHalf" y1="0" :x2="axis.half" y2="0" class="leg" />
      <rect :x="-bodyHalf" y="-5" :width="bodyHalf * 2" height="10" rx="2" class="diode-body" />
      <rect :x="bodyHalf - 4" y="-5" width="3" height="10" class="diode-band" />
    </g>

    <!-- ════ Push-button ════ -->
    <g v-else-if="body === 'button'" :transform="axisTransform">
      <line :x1="-axis.half" y1="0" x2="-11" y2="0" class="leg" />
      <line x1="11" y1="0" :x2="axis.half" y2="0" class="leg" />
      <rect x="-12" y="-12" width="24" height="24" rx="3" class="btn-body" />
      <circle cx="0" cy="0" r="6" class="btn-cap" />
    </g>

    <!-- ════ TO-92 (transistor / DS18B20) ════ -->
    <g v-else-if="body === 'to92'">
      <line v-for="(p, i) in pts" :key="'l' + i" :x1="p.x" :y1="p.y" :x2="p.x" :y2="bodyBottom" class="leg" />
      <path :d="to92Path" class="to92-body" />
      <text :x="modCx" :y="bodyTop + 13" class="chip-label">{{ shortPart }}</text>
    </g>

    <!-- ════ TSOP38238 IR receiver ════ -->
    <g v-else-if="body === 'irrx'">
      <line v-for="(p, i) in pts" :key="'l' + i" :x1="p.x" :y1="p.y" :x2="p.x" :y2="bodyBottom" class="leg" />
      <rect :x="modCx - 14" :y="bodyTop" width="28" height="20" rx="4" class="irrx-base" />
      <circle :cx="modCx" :cy="bodyTop + 4" r="9" class="irrx-dome" />
      <text :x="modCx" :y="bodyTop + 30" class="chip-label">IR&#8201;RX</text>
    </g>

    <!-- ════ Potentiometer ════ -->
    <g v-else-if="body === 'pot'">
      <line v-for="(p, i) in pts" :key="'l' + i" :x1="p.x" :y1="p.y" :x2="p.x" :y2="bodyBottom" class="leg" />
      <rect :x="modCx - 16" :y="bodyTop" width="32" height="22" rx="3" class="pot-base" />
      <circle :cx="modCx" :cy="bodyTop - 4" r="14" class="pot-knob" />
      <line :x1="modCx" :y1="bodyTop - 4" :x2="modCx" :y2="bodyTop - 16" class="pot-ind" />
    </g>

    <!-- ════ I²C breakout (VEML7700 / BME280) ════ -->
    <g v-else-if="body === 'breakout'">
      <line v-for="(p, i) in pts" :key="'l' + i" :x1="p.x" :y1="p.y" :x2="p.x" :y2="bodyBottom" class="leg" />
      <rect
        v-for="(p, i) in pts" :key="'pad' + i"
        :x="p.x - 3.5" :y="bodyBottom - 4" width="7" height="7" rx="1.5" class="pad"
      />
      <rect
        :x="firstPin.x - 11" :y="bodyTop" :width="pinSpan + 22" :height="breakoutH" rx="4"
        class="breakout-pcb" :style="{ stroke: item.props?.accent || tplAccent }"
      />
      <rect :x="modCx - 8" :y="bodyTop + 8" width="16" height="14" rx="2" class="breakout-chip" />
      <text :x="modCx" :y="bodyTop + breakoutH - 5" class="chip-label">{{ shortPart }}</text>
    </g>

    <!-- ════ IC / DIP ════ -->
    <g v-else-if="body === 'dip'">
      <line v-for="(p, i) in pts" :key="'l' + i" :x1="p.x" :y1="p.y" :x2="clamp(p.x)" :y2="dipEdge(p)" class="leg leg-short" />
      <rect :x="dip.x" :y="dip.y" :width="dip.w" :height="dip.h" rx="3" class="dip-body" />
      <path :d="dipNotch" class="dip-notch" />
      <circle :cx="dip.x + 7" :cy="dip.y + dip.h - 7" r="2.2" class="dip-dot" />
      <text :x="dip.x + dip.w / 2" :y="dip.y + dip.h / 2 + 4" class="chip-label light">{{ shortPart || 'IC' }}</text>
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
      <text :x="boardLayout.rect.x + 10" :y="boardLayout.rect.y + 17" class="board-title">{{ item.label }}</text>
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
import { getTemplate, valueToBands, BAND_COLORS } from '@/lib/breadboard/templates'

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
const ledFill = computed(() => {
  if (props.item.kind === 'ir_led_tsal6400') return '#9ec3e0'
  return LED_COLORS[props.item.props?.color] || LED_COLORS.red
})

// ── modules sitting above a row of pins ──
const modCx = computed(() => {
  const xs = pts.value.map((p) => p.x)
  return xs.reduce((s, x) => s + x, 0) / (xs.length || 1)
})
const pinRowY = computed(() => pts.value[0]?.y ?? 0)
const bodyBottom = computed(() => pinRowY.value - 12)
const moduleH = computed(() => (body.value === 'breakout' ? breakoutH.value : 22))
const bodyTop = computed(() => bodyBottom.value - moduleH.value)
const firstPin = computed(() => pts.value[0] || { x: modCx.value, y: pinRowY.value })
const pinSpan = computed(() => {
  const xs = pts.value.map((p) => p.x)
  return Math.max(...xs, modCx.value) - Math.min(...xs, modCx.value)
})
const breakoutH = computed(() => 34)

// TO-92 D-shape path
const to92Path = computed(() => {
  const cx = modCx.value
  const w = Math.max(pinSpan.value + 16, 22)
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
  stroke: #b9b29c;
  stroke-width: 2px;
  stroke-linecap: round;
}
.leg-long {
  stroke: #c9c2a8;
}
.leg-short {
  stroke-width: 2.4px;
  stroke: #c2c2c2;
}
.res-body {
  fill: #e3c79b;
  stroke: #c9a877;
  stroke-width: 1px;
}
.led-dome {
  stroke: rgba(0, 0, 0, 0.25);
  stroke-width: 1px;
}
.led-flat {
  stroke: rgba(0, 0, 0, 0.35);
  stroke-width: 1.5px;
}
.cap-body {
  fill: #2f6fae;
  stroke: #245a90;
  stroke-width: 1px;
}
.diode-body {
  fill: #2a2a2a;
  stroke: #000;
  stroke-width: 0.5px;
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
  fill: #aab3c2;
  stroke: #828c9c;
  stroke-width: 1px;
}
.to92-body {
  fill: #232323;
  stroke: #000;
  stroke-width: 0.5px;
}
.irrx-base {
  fill: #2a2a2a;
}
.irrx-dome {
  fill: #1b1b1b;
  stroke: #444;
  stroke-width: 1px;
}
.pot-base {
  fill: #2f6fae;
  stroke: #245a90;
}
.pot-knob {
  fill: #d8dde4;
  stroke: #9aa3b0;
  stroke-width: 1.5px;
}
.pot-ind {
  stroke: #5a6270;
  stroke-width: 2px;
}
.pad {
  fill: #d8c47a;
  stroke: #b39f55;
  stroke-width: 0.5px;
}
.breakout-pcb {
  fill: #2c2c34;
  stroke-width: 2px;
}
.breakout-chip {
  fill: #0c0c10;
  stroke: #444;
  stroke-width: 0.5px;
}
.dip-body {
  fill: #1f1f1f;
  stroke: #000;
}
.dip-notch {
  fill: none;
  stroke: #555;
  stroke-width: 1px;
}
.dip-dot {
  fill: #555;
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
.chip-mini.dark {
  fill: #fff;
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
</style>
