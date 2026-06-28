<template>
  <div v-if="open" class="modal-backdrop" @click.self="$emit('close')">
    <div class="modal">
      <div class="modal-head">
        <div class="head-titles">
          <span class="modal-title">Parts library</span>
          <span class="sub">Mark what you have so the AI builds with parts you own.</span>
        </div>
        <div class="head-actions">
          <div class="search">
            <i class="pi pi-search"></i>
            <input
              v-model="query"
              type="text"
              class="search-input"
              placeholder="Search parts…"
              spellcheck="false"
            />
            <button v-if="query" class="search-clear" title="Clear" @click="query = ''">
              <i class="pi pi-times" style="font-size: 0.7rem"></i>
            </button>
          </div>
          <button class="add-btn sm" @click="$emit('create')">
            <i class="pi pi-plus" style="font-size: 0.72rem"></i> Create part
          </button>
          <button class="modal-close" @click="$emit('close')">
            <i class="pi pi-times" style="font-size: 0.85rem"></i>
          </button>
        </div>
      </div>

      <div class="modal-body">
        <!-- Category rail -->
        <nav class="rail">
          <button
            class="rail-item"
            :class="{ active: !query && activeGroup === 'instock' }"
            @click="selectGroup('instock')"
          >
            <i class="pi pi-star-fill rail-star"></i>
            <span class="rail-label">In stock</span>
            <span class="rail-count">{{ inStock.length }}</span>
          </button>
          <button
            class="rail-item"
            :class="{ active: !query && activeGroup === 'all' }"
            @click="selectGroup('all')"
          >
            <i class="pi pi-th-large"></i>
            <span class="rail-label">All parts</span>
            <span class="rail-count">{{ allParts.length }}</span>
          </button>
          <div class="rail-cap">Categories</div>
          <button
            v-for="g in groups"
            :key="g.id"
            class="rail-item"
            :class="{ active: !query && activeGroup === g.id }"
            @click="selectGroup(g.id)"
          >
            <i class="pi" :class="meta(g.id).icon"></i>
            <span class="rail-label">{{ meta(g.id).label }}</span>
            <span class="rail-count">{{ g.parts.length }}</span>
          </button>
        </nav>

        <!-- Results -->
        <div class="pane">
          <p v-if="!hasResults" class="empty-note">{{ emptyText }}</p>

          <section v-for="s in sections" v-else :key="s.id" class="pane-section">
            <div class="pane-head">
              <span class="pane-title">{{ s.label }}</span>
              <span class="pane-count">{{ s.parts.length }}</span>
            </div>
            <div class="card-grid">
              <div
                v-for="p in s.parts"
                :key="p.kind"
                class="card"
                :class="{ stocked: lib.isInStock(p.kind) }"
              >
                <span v-if="usedSet.has(p.kind)" class="card-badge">on sheet</span>
                <button
                  class="star"
                  :class="{ on: lib.isInStock(p.kind) }"
                  :title="lib.isInStock(p.kind) ? 'In stock — click to remove' : 'Mark in stock'"
                  @click="lib.toggleStock(p.kind)"
                >
                  <i :class="lib.isInStock(p.kind) ? 'pi pi-star-fill' : 'pi pi-star'"></i>
                </button>

                <div
                  class="card-icon"
                  :style="p.accent ? { background: p.accent + '1f', boxShadow: `inset 0 0 0 1px ${p.accent}55` } : null"
                >
                  <img :src="iconUrl(p.kind)" alt="" />
                </div>
                <span class="card-label" :title="p.label">{{ p.label }}</span>
                <div class="card-meta">
                  <span v-if="p.partNumber" class="card-pn">{{ p.partNumber }}</span>
                  <span class="card-pins">
                    {{ p.pins.length }} pin{{ p.pins.length === 1 ? '' : 's' }}<span
                      v-if="p.placement === 'standalone'"
                    >
                      · board</span>
                  </span>
                </div>

                <div class="card-actions">
                  <button class="place-btn" title="Place on the sheet" @click="$emit('place', p.kind)">
                    <i class="pi pi-arrow-down-left"></i> Place
                  </button>
                  <template v-if="p.custom">
                    <button class="icon-btn" title="Edit" @click="$emit('edit', p.kind)">
                      <i class="pi pi-pencil"></i>
                    </button>
                    <button class="icon-btn danger" title="Delete" @click="remove(p)">
                      <i class="pi pi-trash"></i>
                    </button>
                  </template>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useBreadboardLibraryStore } from '@/stores/breadboardLibrary'
import { listBuiltinParts, iconUrl, GROUP_LABELS, GROUP_ORDER } from '@/lib/breadboard/templates'

const props = defineProps({
  open: { type: Boolean, default: false },
  usedKinds: { type: Array, default: () => [] },
})
defineEmits(['close', 'create', 'edit', 'place'])

const lib = useBreadboardLibraryStore()

const activeGroup = ref('all')
const query = ref('')

// Short rail labels + a leading icon per category so the nav reads as a
// deliberate menu instead of a list of truncated names. Falls back gracefully
// for any group not listed here.
const GROUP_META = {
  library: { label: 'My library', icon: 'pi-box' },
  core: { label: 'Core', icon: 'pi-circle-fill' },
  active: { label: 'Active devices', icon: 'pi-wave-pulse' },
  mine: { label: 'My parts', icon: 'pi-star' },
  ics: { label: 'Semiconductors', icon: 'pi-microchip' },
  env: { label: 'Environment', icon: 'pi-cloud' },
  motion: { label: 'Spatial & motion', icon: 'pi-compass' },
  optical: { label: 'Optical & bio', icon: 'pi-eye' },
  displays: { label: 'Displays', icon: 'pi-desktop' },
  actuators: { label: 'Actuators', icon: 'pi-cog' },
  comms: { label: 'Communications', icon: 'pi-wifi' },
  switches: { label: 'Switches', icon: 'pi-power-off' },
  power: { label: 'Power', icon: 'pi-bolt' },
  passives: { label: 'Passives', icon: 'pi-sliders-h' },
  boards: { label: 'Boards', icon: 'pi-server' },
}
const meta = (id) => GROUP_META[id] || { label: GROUP_LABELS[id] || id, icon: 'pi-circle-fill' }

const usedSet = computed(() => new Set(props.usedKinds))

// Custom parts come straight off the reactive store so the list updates live.
const customParts = computed(() =>
  lib.customParts.map((d) => ({
    kind: d.kind,
    label: d.label,
    group: 'library',
    partNumber: d.partNumber || '',
    placement: d.placement || (d.body === 'board' ? 'standalone' : 'inline'),
    pins: (d.pins || []).map((x) => x.name),
    accent: d.accent,
    custom: true,
  })),
)

const allParts = computed(() => [...customParts.value, ...listBuiltinParts()])

const inStock = computed(() => allParts.value.filter((p) => lib.isInStock(p.kind)))

const groups = computed(() => {
  const byGroup = {}
  for (const p of allParts.value) (byGroup[p.group] ||= []).push(p)
  return GROUP_ORDER.filter((id) => byGroup[id]?.length).map((id) => ({
    id, label: GROUP_LABELS[id] || id, parts: byGroup[id],
  }))
})

const results = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return []
  return allParts.value.filter((p) =>
    p.label.toLowerCase().includes(q) ||
    p.partNumber.toLowerCase().includes(q) ||
    p.kind.toLowerCase().includes(q),
  )
})

// One unified shape — list of { id, label, parts } — drives the template so the
// card markup is written once and the scoped styles actually apply to it.
const sections = computed(() => {
  if (query.value.trim()) return [{ id: 'results', label: 'Results', parts: results.value }]
  if (activeGroup.value === 'instock') return [{ id: 'instock', label: 'In stock', parts: inStock.value }]
  if (activeGroup.value === 'all') return groups.value
  const g = groups.value.find((x) => x.id === activeGroup.value)
  return g ? [g] : []
})

const hasResults = computed(() => sections.value.some((s) => s.parts.length))
const emptyText = computed(() => {
  if (query.value.trim()) return `No parts match “${query.value.trim()}”.`
  if (activeGroup.value === 'instock') return 'Nothing in stock yet. Tap the star on any part to add it.'
  return 'No parts here yet.'
})

function selectGroup(id) {
  query.value = ''
  activeGroup.value = id
}

function remove(p) {
  if (window.confirm(`Delete "${p.label}" from your library? Parts already placed on sheets stay.`)) {
    lib.removeCustomPart(p.kind)
  }
}
</script>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.modal {
  background: #fff;
  border-radius: 0.9rem;
  width: min(56rem, 95vw);
  height: min(85vh, 44rem);
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.25);
  overflow: hidden;
}
.modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.9rem 1.1rem;
  border-bottom: 1px solid #eeede9;
}
.head-titles {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.modal-title {
  font-weight: 700;
  font-size: 1rem;
}
.sub {
  font-size: 0.74rem;
  color: #9a9a9a;
  margin-top: 0.1rem;
}
.head-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex: none;
}
.search {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.4rem 0.6rem;
  border: 1px solid #e5e4e1;
  border-radius: 0.55rem;
  background: #faf9f7;
  width: 14rem;
}
.search:focus-within {
  border-color: #14b8a6;
  background: #fff;
}
.search > .pi-search {
  font-size: 0.78rem;
  color: #9a9a9a;
}
.search-input {
  border: none;
  outline: none;
  background: transparent;
  font-size: 0.82rem;
  color: #1a1a1a;
  flex: 1;
  min-width: 0;
}
.search-clear {
  border: none;
  background: transparent;
  cursor: pointer;
  color: #9a9a9a;
  padding: 0;
  display: flex;
}
.search-clear:hover {
  color: #5c5c5c;
}
.modal-close {
  border: none;
  background: transparent;
  cursor: pointer;
  color: #5c5c5c;
}
.modal-body {
  display: flex;
  min-height: 0;
  flex: 1;
}

/* Category rail */
.rail {
  flex: none;
  width: 12.5rem;
  border-right: 1px solid #eeede9;
  padding: 0.7rem 0.6rem;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.12rem;
}
.rail-item {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  width: 100%;
  padding: 0.45rem 0.55rem;
  border-radius: 0.5rem;
  background: transparent;
  border: none;
  cursor: pointer;
  font-size: 0.82rem;
  color: #3d3d3d;
  text-align: left;
  transition: background 0.12s, color 0.12s;
}
.rail-item:hover {
  background: #f3f2f0;
  color: #1a1a1a;
}
.rail-item.active {
  background: #ccfbf1;
  color: #0f766e;
  font-weight: 600;
}
.rail-item > .pi {
  font-size: 0.82rem;
  width: 1rem;
  text-align: center;
  color: #b3afa6;
  flex: none;
}
.rail-item:hover > .pi {
  color: #7a766d;
}
.rail-item.active > .pi {
  color: #0f766e;
}
.rail-star {
  color: #f59e0b !important;
}
.rail-label {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.rail-count {
  font-size: 0.72rem;
  color: #b3afa6;
  flex: none;
  font-variant-numeric: tabular-nums;
}
.rail-item.active .rail-count {
  color: #0f766e;
}
.rail-cap {
  font-size: 0.64rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: #b3afa6;
  padding: 0.2rem 0.55rem;
  margin: 0.5rem 0 0.15rem;
}

/* Results pane */
.pane {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: 0.9rem 1.1rem 1.1rem;
}
.pane-section + .pane-section {
  margin-top: 1.2rem;
}
.pane-head {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin-bottom: 0.6rem;
}
.pane-title {
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #5c5c5c;
}
.pane-count {
  font-size: 0.7rem;
  color: #9a9a9a;
  background: #f3f2f0;
  border-radius: 999px;
  padding: 0 0.4rem;
}
.empty-note {
  font-size: 0.8rem;
  color: #9a9a9a;
  margin: 0.2rem 0 0;
}
.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(8.5rem, 1fr));
  gap: 0.6rem;
}

/* Part card */
.card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.35rem;
  padding: 0.85rem 0.5rem 0.65rem;
  border: 1px solid #e5e4e1;
  border-radius: 0.7rem;
  background: #fff;
  text-align: center;
  overflow: hidden;
  transition: border-color 0.12s, box-shadow 0.12s;
}
.card:hover {
  border-color: #14b8a6;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.08);
}
.card.stocked {
  background: #f6fdfb;
  border-color: #cdeee7;
}
.card.stocked:hover {
  border-color: #14b8a6;
}
.card-badge {
  position: absolute;
  top: 0.45rem;
  left: 0.45rem;
  font-size: 0.56rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: #0f766e;
  background: #ccfbf1;
  border-radius: 999px;
  padding: 0.08rem 0.38rem;
}
.star {
  position: absolute;
  top: 0.4rem;
  right: 0.4rem;
  border: none;
  background: transparent;
  cursor: pointer;
  color: #cfcabf;
  padding: 0.1rem;
  line-height: 1;
  display: flex;
}
.star .pi {
  font-size: 0.82rem;
}
.star:hover {
  color: #f59e0b;
}
.star.on {
  color: #f59e0b;
}
.card-icon {
  width: 2.6rem;
  height: 2.6rem;
  flex: none;
  margin-top: 0.15rem;
  padding: 3px;
  border-radius: 0.5rem;
  background: #f3f2f0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.card-icon img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.card-label {
  font-size: 0.8rem;
  font-weight: 500;
  color: #1a1a1a;
  line-height: 1.2;
  max-width: 100%;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.card-meta {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.05rem;
  margin-top: auto;
  padding-top: 0.1rem;
}
.card-pn {
  font-size: 0.68rem;
  color: #0f766e;
  font-weight: 600;
}
.card-pins {
  font-size: 0.68rem;
  color: #9a9a9a;
}
/* Hover action bar — overlays the meta line, no layout shift */
.card-actions {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.25rem;
  padding: 0.55rem 0.4rem 0.5rem;
  background: linear-gradient(rgba(255, 255, 255, 0), #fff 45%);
  opacity: 0;
  transform: translateY(0.3rem);
  transition: opacity 0.12s, transform 0.12s;
}
.card.stocked .card-actions {
  background: linear-gradient(rgba(246, 253, 251, 0), #f6fdfb 45%);
}
.card:hover .card-actions,
.card:focus-within .card-actions {
  opacity: 1;
  transform: none;
}
.place-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  border: none;
  background: #14b8a6;
  color: #fff;
  font-size: 0.72rem;
  font-weight: 600;
  border-radius: 0.45rem;
  padding: 0.3rem 0.6rem;
  cursor: pointer;
}
.place-btn:hover {
  background: #0f766e;
}
.place-btn .pi {
  font-size: 0.66rem;
}
.icon-btn {
  border: 1px solid #e5e4e1;
  background: #fff;
  cursor: pointer;
  padding: 0.25rem 0.32rem;
  border-radius: 0.45rem;
  color: #5c5c5c;
  display: inline-flex;
}
.icon-btn .pi {
  font-size: 0.7rem;
}
.icon-btn:hover {
  background: #eeede9;
}
.icon-btn.danger:hover {
  background: #fee2e2;
  border-color: #fecaca;
  color: #b91c1c;
}
.add-btn {
  background: #14b8a6;
  color: #fff;
  border: none;
  border-radius: 0.55rem;
  padding: 0.5rem 0.9rem;
  font-weight: 600;
  font-size: 0.85rem;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}
.add-btn.sm {
  padding: 0.42rem 0.7rem;
  font-size: 0.78rem;
  white-space: nowrap;
}

/* Narrow: rail becomes a horizontal chip row above the grid */
@media (max-width: 40rem) {
  .modal-body {
    flex-direction: column;
  }
  .rail {
    width: auto;
    flex-direction: row;
    flex-wrap: nowrap;
    overflow-x: auto;
    border-right: none;
    border-bottom: 1px solid #eeede9;
    padding: 0.5rem 0.6rem;
    gap: 0.3rem;
  }
  .rail-item {
    width: auto;
    flex: none;
  }
  .rail-cap {
    display: none;
  }
  .search {
    width: 10rem;
  }
}
</style>
