<template>
  <div class="inspector">
    <!-- ── wire selected ── -->
    <template v-if="wire">
      <div class="insp-head">
        <span class="insp-name static">Wire</span>
        <button class="icon-btn danger" title="Delete wire" @click="$emit('delete-wire')">
          <i class="pi pi-trash" style="font-size: 0.85rem"></i>
        </button>
      </div>
      <div class="insp-kind">Connection</div>

      <div class="field">
        <label>Colour</label>
        <div class="swatches">
          <button
            v-for="c in wireColors" :key="c" class="swatch"
            :class="{ on: (wire.color || '#16a34a') === c }"
            :style="{ background: c }" :title="c"
            @click="$emit('set-wire-color', c)"
          ></button>
        </div>
      </div>

      <div class="field">
        <label>Type</label>
        <select :value="wire.type || 'M-M'" @change="$emit('set-wire-type', $event.target.value)">
          <option v-for="t in WIRE_TYPES" :key="t" :value="t">{{ t }}</option>
        </select>
      </div>

      <div class="field">
        <label>Gauge (AWG)</label>
        <select :value="String(wire.gauge || 22)" @change="$emit('set-wire-gauge', Number($event.target.value))">
          <option v-for="g in WIRE_GAUGES" :key="g" :value="String(g)">{{ g }} AWG</option>
        </select>
      </div>

      <div class="field">
        <label>Arc</label>
        <button class="dup-btn" @click="$emit('flip-wire-arc')">
          <i class="pi pi-sync" style="font-size: 0.75rem"></i>
          Flip arc {{ wire.arc === -1 ? '(opposing)' : '(default)' }}
        </button>
      </div>
    </template>

    <div v-else-if="!item" class="insp-empty">
      <i class="pi pi-sliders-h" style="font-size: 1.5rem; opacity: 0.4"></i>
      <p>Select a part to edit it, or pick one from <strong>Add parts</strong> and click the board.</p>
    </div>

    <template v-else>
      <div class="insp-head">
        <input class="insp-name" :value="item.label" @change="rename($event.target.value)" />
        <button class="icon-btn danger" title="Delete" @click="$emit('delete')">
          <i class="pi pi-trash" style="font-size: 0.85rem"></i>
        </button>
      </div>
      <div class="insp-kind">{{ kindLabel }}</div>
      <div v-if="partNumber" class="insp-pn">Part #{{ partNumber }}</div>

      <!-- ── placement: plug into the grid, or sit off-board and wire to pins ── -->
      <div v-if="canToggle" class="seg">
        <button class="seg-btn" :class="{ on: !isStandalone }" @click="$emit('set-placement', 'inline')">
          On breadboard
        </button>
        <button class="seg-btn" :class="{ on: isStandalone }" @click="$emit('set-placement', 'standalone')">
          Off-board
        </button>
      </div>

      <!-- ── props ── -->
      <div v-if="item.kind === 'resistor'" class="field">
        <label>Resistance</label>
        <div class="row">
          <select :value="String(item.props.ohms)" @change="prop('ohms', Number($event.target.value))">
            <option v-for="v in RES_PRESETS" :key="v" :value="String(v)">{{ formatOhms(v) }}</option>
          </select>
        </div>
        <div class="band-preview">
          <span v-for="(c, i) in bands" :key="i" class="band" :style="{ background: c }"></span>
          <span class="band-names">{{ bandNames.join('-') }}</span>
        </div>
      </div>

      <div v-else-if="item.kind === 'led'" class="field">
        <label>Colour</label>
        <select :value="item.props.color" @change="prop('color', $event.target.value)">
          <option v-for="c in LED_COLORS" :key="c" :value="c">{{ c }}</option>
        </select>
      </div>

      <div v-else-if="item.kind === 'cap_104'" class="field">
        <label>Capacitance</label>
        <select :value="item.props.value" @change="prop('value', $event.target.value)">
          <option v-for="v in CERAMIC_CAP_PRESETS" :key="v" :value="v">{{ v }}</option>
        </select>
      </div>

      <div v-else-if="item.kind === 'electrolytic_cap'" class="field">
        <label>Capacitance</label>
        <select :value="item.props.value" @change="prop('value', $event.target.value)">
          <option v-for="v in ELECTROLYTIC_CAP_PRESETS" :key="v" :value="v">{{ v }}</option>
        </select>
      </div>

      <div v-else-if="item.kind === 'inductor'" class="field">
        <label>Inductance</label>
        <select :value="item.props.value" @change="prop('value', $event.target.value)">
          <option v-for="v in INDUCTOR_PRESETS" :key="v" :value="v">{{ v }}</option>
        </select>
      </div>

      <div v-else-if="item.kind === 'diode'" class="field">
        <label>Type</label>
        <select :value="item.props.part" @change="prop('part', $event.target.value)">
          <option v-for="d in DIODE_TYPES" :key="d" :value="d">{{ d }}</option>
        </select>
      </div>

      <div v-else-if="item.kind === 'fuse'" class="field">
        <label>Rating</label>
        <select :value="item.props.rating" @change="prop('rating', $event.target.value)">
          <option v-for="r in FUSE_RATINGS" :key="r" :value="r">{{ r }}</option>
        </select>
      </div>

      <div v-else-if="item.kind === 'ic'" class="field">
        <label>Pin count</label>
        <input
          type="number" min="4" max="40" step="2" :value="item.pins.length"
          @change="$emit('set-pincount', Number($event.target.value))"
        />
        <label>Part (optional)</label>
        <input :value="item.props.part || ''" placeholder="e.g. NE555" @change="prop('part', $event.target.value)" />
      </div>

      <div v-else-if="item.kind === 'transistor'" class="field">
        <label>Part</label>
        <input :value="item.props.part || ''" @change="prop('part', $event.target.value)" />
      </div>

      <div v-else-if="item.kind === 'potentiometer'" class="field">
        <label>Resistance</label>
        <select :value="String(item.props.ohms)" @change="prop('ohms', Number($event.target.value))">
          <option v-for="v in POT_PRESETS" :key="v" :value="String(v)">{{ formatOhms(v) }}</option>
        </select>
      </div>

      <!-- ── pin → hole mapping (inline parts) ── -->
      <div v-if="!isStandalone" class="pins">
        <div class="pins-title">Pins → holes</div>
        <div v-for="pin in item.pins" :key="pin.id" class="pin-row">
          <span class="pin-name" :title="pin.name">{{ pin.name }}</span>
          <select class="pin-row-sel" :value="rowOf(pin)" @change="setRow(pin, $event.target.value)">
            <option v-for="o in rowOptions" :key="o.v" :value="o.v">{{ o.t }}</option>
          </select>
          <input
            v-if="isMainRow(rowOf(pin))" class="pin-col" type="number" min="1" :max="maxCol"
            :value="colOf(pin)" @change="setCol(pin, Number($event.target.value))"
          />
          <span v-else class="pin-col-spacer"></span>
          <span class="pin-net" :title="netLabel(pin)">{{ netLabel(pin) }}</span>
        </div>
      </div>

      <!-- ── pin → net list (standalone boards, read-only) ── -->
      <div v-else class="pins">
        <div class="pins-title">Pins · wire them on the board</div>
        <div v-for="pin in item.pins" :key="pin.id" class="pin-row standalone">
          <span class="pin-name wide" :title="pin.name">{{ pin.name }}</span>
          <span class="pin-net" :title="netLabel(pin)">{{ netLabel(pin) || '—' }}</span>
        </div>
      </div>

      <button class="dup-btn" @click="$emit('duplicate')">
        <i class="pi pi-clone" style="font-size: 0.75rem"></i> Duplicate
      </button>
    </template>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { ROWS, getTemplate, valueToBands, formatOhms, BAND_COLORS } from '@/lib/breadboard/templates'

defineOptions({ name: 'BreadboardInspector' })
import { pinEndpointId } from '@/lib/breadboard/geometry'

const props = defineProps({
  item: { type: Object, default: null },
  wire: { type: Object, default: null },
  wireColors: { type: Array, default: () => [] },
  layout: { type: Object, default: null },
  netMap: { type: Object, default: () => ({}) }, // endpointId -> { id, label }
})
const emit = defineEmits([
  'rename', 'update-prop', 'set-pin', 'set-pincount', 'delete', 'duplicate',
  'set-wire-color', 'set-wire-type', 'set-wire-gauge', 'flip-wire-arc', 'delete-wire', 'set-placement',
])

const RES_PRESETS = [1, 10, 22, 47, 100, 150, 220, 330, 470, 680, 1000, 2200, 4700, 10000, 22000, 47000, 100000, 220000, 470000, 1000000]
const POT_PRESETS = [1000, 5000, 10000, 50000, 100000]
const LED_COLORS = ['red', 'green', 'blue', 'yellow', 'white', 'orange']
const CERAMIC_CAP_PRESETS = ['10pF', '22pF', '100pF', '1nF', '10nF', '100nF', '220nF', '1µF']
const ELECTROLYTIC_CAP_PRESETS = ['1µF', '4.7µF', '10µF', '22µF', '47µF', '100µF', '220µF', '470µF', '1000µF']
const INDUCTOR_PRESETS = ['1µH', '10µH', '47µH', '100µH', '220µH', '470µH', '1mH', '10mH']
const DIODE_TYPES = ['1N4148', '1N4001', '1N4007', '1N5819 (Schottky)', '1N5408', '1N4733 (Zener)']
const FUSE_RATINGS = ['100mA', '200mA', '500mA', '1A', '2A', '3A', '5A']
const WIRE_TYPES = ['M-M', 'M-F', 'F-F', 'solid core']
const WIRE_GAUGES = [30, 28, 26, 24, 22, 20]

const tpl = computed(() => getTemplate(props.item?.kind))
const isStandalone = computed(() => (props.item?.placement || tpl.value?.placement) === 'standalone')
// Dedicated boards (Pi/ESP/custom board) are always off-board; everything else
// (modules + discretes) can switch between plugging in and sitting off-board.
const canToggle = computed(() => {
  const t = tpl.value
  return !!t && !!t.body && t.body !== 'board' && t.kind !== 'wire'
})
const kindLabel = computed(() => tpl.value?.label || props.item?.kind)
const partNumber = computed(() => props.item?.props?.partNumber || tpl.value?.partNumber || '')
const maxCol = computed(() => props.layout?.cfg?.cols || 63)

const bands = computed(() => valueToBands(props.item?.props?.ohms).map((n) => BAND_COLORS[n]))
const bandNames = computed(() => valueToBands(props.item?.props?.ohms))

function rename(v) { emit('rename', v) }
function prop(key, value) { emit('update-prop', { key, value }) }

// ── pin/hole helpers ──
const RAIL_ROWS = [
  { v: 'TP', t: '+ top' }, { v: 'TM', t: '− top' }, { v: 'BP', t: '+ bot' }, { v: 'BM', t: '− bot' },
]
const rowOptions = computed(() => {
  const opts = [{ v: '', t: '—' }, ...ROWS.map((r) => ({ v: r, t: r }))]
  if (props.layout?.cfg?.rails) opts.push(...RAIL_ROWS)
  return opts
})
function isMainRow(v) { return ROWS.includes(v) }

function holeObj(pin) {
  return pin.hole ? props.layout?.holesById?.[pin.hole] : null
}
function rowOf(pin) {
  const h = holeObj(pin)
  if (!h) return ''
  return h.kind === 'rail' ? h.railKey : h.row
}
function colOf(pin) {
  const h = holeObj(pin)
  return h && h.kind === 'main' ? h.col : 1
}

function findMainHole(col, row) {
  const id = `${props.layout.bb.id}:c${col}:${row}`
  return props.layout.holesById[id] ? id : null
}
function findRailHole(railKey) {
  // nearest rail hole of this key to the item's x
  const x = props.item.x || 0
  let best = null
  let bestD = Infinity
  for (const h of props.layout.holes) {
    if (h.kind !== 'rail' || h.railKey !== railKey) continue
    const d = Math.abs(h.x - x)
    if (d < bestD) { bestD = d; best = h }
  }
  return best?.id || null
}
function setRow(pin, rowVal) {
  let hole = null
  if (rowVal === '') hole = null
  else if (isMainRow(rowVal)) hole = findMainHole(colOf(pin), rowVal)
  else hole = findRailHole(rowVal)
  emit('set-pin', { pinId: pin.id, hole })
}
function setCol(pin, col) {
  const row = rowOf(pin)
  if (!isMainRow(row)) return
  emit('set-pin', { pinId: pin.id, hole: findMainHole(col, row) })
}

function netLabel(pin) {
  const n = props.netMap[pinEndpointId(props.item, pin)]
  return n ? `→ ${n.label}` : ''
}
</script>

<style scoped>
.inspector {
  padding: 0.85rem;
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
}
.insp-empty {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  align-items: center;
  text-align: center;
  color: var(--bb-text-faint, #9a9a9a);
  font-size: 0.82rem;
  padding: 1.5rem 0.5rem;
}
.insp-head {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}
.insp-name {
  flex: 1;
  font-size: 0.95rem;
  font-weight: 700;
  border: 1px solid var(--bb-border, #e5e4e1);
  border-radius: 0.5rem;
  padding: 0.35rem 0.5rem;
  background: #fff;
  color: var(--bb-text, #1a1a1a);
}
.insp-name.static {
  flex: 1;
  font-size: 0.95rem;
  font-weight: 700;
  padding: 0.35rem 0.5rem;
  color: var(--bb-text, #1a1a1a);
}
.swatches {
  display: flex;
  gap: 0.35rem;
  flex-wrap: wrap;
}
.swatch {
  width: 1.35rem;
  height: 1.35rem;
  border-radius: 0.4rem;
  border: 2px solid transparent;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.15);
  cursor: pointer;
  padding: 0;
}
.swatch.on {
  border-color: var(--bb-text, #1a1a1a);
}
.insp-kind {
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--bb-text-faint, #9a9a9a);
  font-weight: 600;
}
.insp-pn {
  font-size: 0.72rem;
  color: #0f766e;
  font-weight: 600;
  margin-top: -0.4rem;
}
.seg {
  display: flex;
  border: 1px solid var(--bb-border, #e5e4e1);
  border-radius: 0.5rem;
  overflow: hidden;
}
.seg-btn {
  flex: 1;
  border: none;
  background: #fff;
  padding: 0.35rem 0.4rem;
  font-size: 0.76rem;
  font-weight: 600;
  cursor: pointer;
  color: var(--bb-text-dim, #5c5c5c);
}
.seg-btn + .seg-btn {
  border-left: 1px solid var(--bb-border, #e5e4e1);
}
.seg-btn.on {
  background: #14b8a6;
  color: #fff;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}
.field label {
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--bb-text-dim, #5c5c5c);
}
.field select,
.field input,
.pin-row select,
.pin-row input {
  border: 1px solid var(--bb-border, #e5e4e1);
  border-radius: 0.45rem;
  padding: 0.3rem 0.4rem;
  font-size: 0.82rem;
  background: #fff;
  color: var(--bb-text, #1a1a1a);
}
.row {
  display: flex;
  gap: 0.4rem;
}
.band-preview {
  display: flex;
  align-items: center;
  gap: 3px;
  margin-top: 0.2rem;
}
.band {
  width: 0.45rem;
  height: 1.1rem;
  border-radius: 2px;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.15);
}
.band-names {
  margin-left: 0.4rem;
  font-size: 0.72rem;
  color: var(--bb-text-dim, #5c5c5c);
}
.pins {
  border-top: 1px solid var(--bb-border-soft, #eeede9);
  padding-top: 0.55rem;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}
.pins-title {
  font-size: 0.72rem;
  font-weight: 700;
  color: var(--bb-text-dim, #5c5c5c);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.pin-row {
  display: grid;
  grid-template-columns: 1fr 4.2rem 3.2rem 1fr;
  gap: 0.3rem;
  align-items: center;
}
.pin-row.standalone {
  grid-template-columns: 1fr 1fr;
}
.pin-name {
  font-size: 0.78rem;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pin-name.wide {
  font-weight: 600;
}
.pin-col-spacer {
  display: block;
}
.pin-net {
  font-size: 0.72rem;
  color: #0f766e;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.icon-btn {
  border: none;
  background: transparent;
  cursor: pointer;
  padding: 0.3rem;
  border-radius: 0.4rem;
  color: var(--bb-text-dim, #5c5c5c);
}
.icon-btn.danger:hover {
  background: #fee2e2;
  color: #b91c1c;
}
.dup-btn {
  margin-top: 0.2rem;
  align-self: flex-start;
  display: flex;
  align-items: center;
  gap: 0.35rem;
  border: 1px solid var(--bb-border, #e5e4e1);
  background: #fff;
  border-radius: 0.5rem;
  padding: 0.35rem 0.6rem;
  font-size: 0.78rem;
  cursor: pointer;
  color: var(--bb-text, #1a1a1a);
}
.dup-btn:hover {
  background: var(--bb-sunken, #f3f2f0);
}
</style>
