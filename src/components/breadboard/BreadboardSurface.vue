<template>
  <g class="bb-surface">
    <!-- board body -->
    <rect
      :x="layout.x0" :y="layout.y0" :width="layout.width" :height="layout.height"
      rx="10" class="bb-body"
    />
    <rect
      :x="layout.x0 + 2" :y="layout.y0 + 2" :width="layout.width - 4" :height="layout.height - 4"
      rx="8" class="bb-body-inner"
    />

    <!-- centre ravine -->
    <rect
      :x="layout.x0 + 6" :y="layout.ravineY - 5" :width="layout.width - 12" height="10"
      rx="3" class="bb-ravine"
    />

    <!-- power-rail guide lines -->
    <g v-for="rl in layout.railLines" :key="rl.key">
      <line
        :x1="rl.x1 - 10" :y1="lineOffset(rl)" :x2="rl.x2 + 10" :y2="lineOffset(rl)"
        :class="['bb-rail-line', rl.polarity === '+' ? 'plus' : 'minus']"
      />
      <text
        :x="rl.x1 - 16" :y="rl.y + 4" text-anchor="end"
        :class="['bb-rail-sign', rl.polarity === '+' ? 'plus' : 'minus']"
      >{{ rl.polarity }}</text>
    </g>

    <!-- holes -->
    <g class="bb-holes">
      <circle
        v-for="h in layout.holes" :key="h.id"
        :cx="h.x" :cy="h.y" :r="HOLE_R"
        :class="['bb-hole', h.kind === 'rail' ? (h.polarity === '+' ? 'rail-plus' : 'rail-minus') : '']"
      />
    </g>

    <!-- column numbers (every 5) -->
    <g class="bb-col-nums">
      <text
        v-for="c in colTicks" :key="'cn' + c"
        :x="layout.colX(c)" :y="layout.mainTop - 10" text-anchor="middle"
        class="bb-tick"
      >{{ c }}</text>
      <text
        v-for="c in colTicks" :key="'cb' + c"
        :x="layout.colX(c)" :y="layout.mainBottom + 16" text-anchor="middle"
        class="bb-tick"
      >{{ c }}</text>
    </g>

    <!-- row letters -->
    <g class="bb-row-letters">
      <text
        v-for="(ry, i) in layout.rowY" :key="'rl' + i"
        :x="layout.x0 + 10" :y="ry + 3.5" text-anchor="middle" class="bb-tick"
      >{{ ROWS[i] }}</text>
      <text
        v-for="(ry, i) in layout.rowY" :key="'rr' + i"
        :x="layout.x0 + layout.width - 10" :y="ry + 3.5" text-anchor="middle" class="bb-tick"
      >{{ ROWS[i] }}</text>
    </g>
  </g>
</template>

<script setup>
import { computed } from 'vue'
import { HOLE_R } from '@/lib/breadboard/geometry'
import { ROWS } from '@/lib/breadboard/templates'

const props = defineProps({
  layout: { type: Object, required: true },
})

// red/blue guide line sits just outside its hole row
function lineOffset(rl) {
  return rl.y + (rl.polarity === '+' ? -9 : 9)
}

const colTicks = computed(() => {
  const ticks = []
  for (let c = 5; c <= props.layout.cfg.cols; c += 5) ticks.push(c)
  if (props.layout.cfg.cols >= 1 && !ticks.includes(1)) ticks.unshift(1)
  return ticks
})
</script>

<style scoped>
.bb-body {
  fill: #f3ecd8;
  stroke: #cdbf9c;
  stroke-width: 1.5px;
}
.bb-body-inner {
  fill: none;
  stroke: #fffaf0;
  stroke-width: 1px;
  opacity: 0.7;
}
.bb-ravine {
  fill: #d8cdb0;
  stroke: #c3b694;
  stroke-width: 1px;
}
.bb-hole {
  fill: #2b2b2b;
  stroke: #b3a988;
  stroke-width: 1px;
}
.bb-hole.rail-plus {
  stroke: #e7a39c;
}
.bb-hole.rail-minus {
  stroke: #9cb1e7;
}
.bb-rail-line {
  stroke-width: 2px;
  opacity: 0.85;
}
.bb-rail-line.plus {
  stroke: #e0584d;
}
.bb-rail-line.minus {
  stroke: #4f7fe0;
}
.bb-rail-sign {
  font-size: 13px;
  font-weight: 800;
}
.bb-rail-sign.plus {
  fill: #e0584d;
}
.bb-rail-sign.minus {
  fill: #4f7fe0;
}
.bb-tick {
  fill: #9c8f72;
  font-size: 9.5px;
  font-weight: 600;
  user-select: none;
}
</style>
