<template>
  <div v-if="open" class="modal-backdrop" @click.self="$emit('close')">
    <div class="modal">
      <div class="modal-head">
        <div>
          <span class="modal-title">Parts library</span>
          <span class="sub">Mark what you have so the AI builds with parts you own.</span>
        </div>
        <div class="head-actions">
          <button class="add-btn sm" @click="$emit('create')">
            <i class="pi pi-plus" style="font-size: 0.72rem"></i> Create part
          </button>
          <button class="modal-close" @click="$emit('close')">
            <i class="pi pi-times" style="font-size: 0.85rem"></i>
          </button>
        </div>
      </div>

      <div class="modal-body">
        <!-- In-stock summary -->
        <section class="lib-section">
          <div class="sec-head">
            <i class="pi pi-check-circle" style="font-size: 0.8rem; color: #0f766e"></i>
            <span class="sec-title">In stock</span>
            <span class="sec-count">{{ inStock.length }}</span>
          </div>
          <p v-if="!inStock.length" class="empty-note">
            Nothing in stock yet. Toggle the star on any part below to add it.
          </p>
          <div v-else class="part-list">
            <div v-for="p in inStock" :key="p.kind" class="part-row in-stock">
              <img class="part-icon" :src="iconUrl(p.kind)" alt="" />
              <div class="part-main">
                <span class="part-label">{{ p.label }}</span>
                <span v-if="p.partNumber" class="part-pn">{{ p.partNumber }}</span>
              </div>
              <span v-if="usedSet.has(p.kind)" class="badge">on sheet</span>
              <button class="star on" title="Remove from stock" @click="lib.setStock(p.kind, false)">
                <i class="pi pi-star-fill" style="font-size: 0.8rem"></i>
              </button>
            </div>
          </div>
        </section>

        <!-- All parts by group -->
        <section v-for="g in groups" :key="g.id" class="lib-section">
          <div class="sec-head">
            <span class="sec-title">{{ g.label }}</span>
            <span class="sec-count">{{ g.parts.length }}</span>
          </div>
          <div class="part-list">
            <div v-for="p in g.parts" :key="p.kind" class="part-row">
              <img class="part-icon" :src="iconUrl(p.kind)" alt="" />
              <div class="part-main">
                <span class="part-label">{{ p.label }}</span>
                <span class="part-meta">
                  <span v-if="p.partNumber" class="part-pn">{{ p.partNumber }}</span>
                  <span class="part-pins">{{ p.pins.length }} pin{{ p.pins.length === 1 ? '' : 's' }}</span>
                  <span v-if="p.placement === 'standalone'" class="part-pins">board</span>
                </span>
              </div>
              <span v-if="usedSet.has(p.kind)" class="badge">on sheet</span>
              <button class="link-btn" title="Place on sheet" @click="$emit('place', p.kind)">place</button>
              <template v-if="p.custom">
                <button class="icon-btn" title="Edit" @click="$emit('edit', p.kind)">
                  <i class="pi pi-pencil" style="font-size: 0.72rem"></i>
                </button>
                <button class="icon-btn danger" title="Delete" @click="remove(p)">
                  <i class="pi pi-trash" style="font-size: 0.72rem"></i>
                </button>
              </template>
              <button
                class="star" :class="{ on: lib.isInStock(p.kind) }"
                :title="lib.isInStock(p.kind) ? 'In stock' : 'Mark in stock'"
                @click="lib.toggleStock(p.kind)"
              >
                <i :class="lib.isInStock(p.kind) ? 'pi pi-star-fill' : 'pi pi-star'" style="font-size: 0.8rem"></i>
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useBreadboardLibraryStore } from '@/stores/breadboardLibrary'
import { listBuiltinParts, iconUrl, GROUP_LABELS, GROUP_ORDER } from '@/lib/breadboard/templates'

const props = defineProps({
  open: { type: Boolean, default: false },
  usedKinds: { type: Array, default: () => [] },
})
defineEmits(['close', 'create', 'edit', 'place'])

const lib = useBreadboardLibraryStore()

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
  width: min(34rem, 95vw);
  max-height: 88vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.25);
  overflow: hidden;
}
.modal-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.9rem 1.1rem;
  border-bottom: 1px solid #eeede9;
}
.modal-title {
  font-weight: 700;
  font-size: 1rem;
}
.sub {
  display: block;
  font-size: 0.74rem;
  color: #9a9a9a;
  margin-top: 0.1rem;
}
.head-actions {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}
.modal-close {
  border: none;
  background: transparent;
  cursor: pointer;
  color: #5c5c5c;
}
.modal-body {
  padding: 0.6rem 1.1rem 1.1rem;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.lib-section {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.sec-head {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding-top: 0.3rem;
}
.sec-title {
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #5c5c5c;
}
.sec-count {
  font-size: 0.7rem;
  color: #9a9a9a;
  background: #f3f2f0;
  border-radius: 999px;
  padding: 0 0.4rem;
}
.empty-note {
  font-size: 0.78rem;
  color: #9a9a9a;
  margin: 0.1rem 0 0;
}
.part-list {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}
.part-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.35rem 0.4rem;
  border-radius: 0.5rem;
  border: 1px solid transparent;
}
.part-row:hover {
  background: #f8f7f5;
}
.part-row.in-stock {
  background: #f0fdfa;
}
.part-icon {
  width: 2.25rem;
  height: 2.25rem;
  flex: none;
  padding: 2px;
  border-radius: 5px;
  background: #f3f2f0;
  object-fit: contain;
}
.part-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.part-label {
  font-size: 0.83rem;
  color: #1a1a1a;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.part-meta {
  display: flex;
  gap: 0.45rem;
  align-items: center;
}
.part-pn {
  font-size: 0.7rem;
  color: #0f766e;
  font-weight: 600;
}
.part-pins {
  font-size: 0.7rem;
  color: #9a9a9a;
}
.badge {
  font-size: 0.64rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: #0f766e;
  background: #ccfbf1;
  border-radius: 999px;
  padding: 0.05rem 0.4rem;
  flex: none;
}
.link-btn {
  border: none;
  background: transparent;
  color: #0f766e;
  font-size: 0.74rem;
  font-weight: 600;
  cursor: pointer;
  flex: none;
}
.link-btn:hover {
  text-decoration: underline;
}
.icon-btn {
  border: none;
  background: transparent;
  cursor: pointer;
  padding: 0.25rem;
  border-radius: 0.4rem;
  color: #5c5c5c;
  flex: none;
}
.icon-btn:hover {
  background: #eeede9;
}
.icon-btn.danger:hover {
  background: #fee2e2;
  color: #b91c1c;
}
.star {
  border: none;
  background: transparent;
  cursor: pointer;
  padding: 0.25rem;
  border-radius: 0.4rem;
  color: #c4c0b8;
  flex: none;
}
.star:hover {
  color: #f59e0b;
}
.star.on {
  color: #f59e0b;
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
  padding: 0.35rem 0.6rem;
  font-size: 0.78rem;
}
</style>
