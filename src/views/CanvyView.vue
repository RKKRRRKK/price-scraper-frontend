<template>
  <div class="canvy-app">
    <!-- ── Catalogue rail ── -->
    <aside class="rail" :class="{ open: railOpen }">
      <div class="rail-head">
        <div class="rail-head-text">
          <div class="eyebrow">Tools</div>
          <h1 class="rail-title">Canvy</h1>
          <div class="rail-sub">{{ store.boards.length }} {{ store.boards.length === 1 ? 'board' : 'boards' }}</div>
        </div>
        <button class="icon-btn rail-close mobile-only" @click="railOpen = false" title="Close">
          <i class="pi pi-times" style="font-size: 0.875rem;"></i>
        </button>
      </div>

      <div class="rail-actions">
        <button class="add-btn rail-new" @click="newBoard">
          <i class="pi pi-plus" style="font-size: 0.8125rem;"></i> New board
        </button>
        <button class="icon-btn rail-newfolder" title="New folder" @click="startAddFolder">
          <i class="pi pi-folder-plus" style="font-size: 0.9rem;"></i>
        </button>
      </div>

      <div class="rail-search">
        <i class="pi pi-search"></i>
        <input v-model="railQuery" type="text" placeholder="Filter boards…" />
        <button v-if="railQuery" class="rail-search-clear" @click="railQuery = ''" title="Clear">
          <i class="pi pi-times"></i>
        </button>
      </div>

      <div class="rail-list">
        <div v-if="store.loading && !store.boards.length" class="rail-state">
          <i class="pi pi-spin pi-spinner" style="font-size: 1.25rem;"></i>
        </div>
        <div v-else-if="!store.boards.length && !store.folders.length && !addingFolder" class="rail-state">
          <i class="pi pi-clone rail-state-icon"></i>
          <span>No boards yet.</span>
        </div>
        <div v-else-if="railQuery && !matchedBoards.length" class="rail-state">
          <i class="pi pi-search rail-state-icon"></i>
          <span>No matches for “{{ railQuery }}”.</span>
        </div>

        <template v-else>
          <!-- Inline new-folder input -->
          <div v-if="addingFolder" class="folder-add">
            <i class="pi pi-folder folder-icon"></i>
            <input
              ref="newFolderInput"
              v-model="newFolderName"
              type="text"
              placeholder="Folder name…"
              @keyup.enter="confirmAddFolder"
              @keyup.esc="cancelAddFolder"
              @blur="confirmAddFolder"
            />
          </div>

          <!-- Folders -->
          <div v-for="f in visibleFolders" :key="f.id" class="folder">
            <div class="folder-head" @click="toggleFolder(f.id)">
              <i class="pi folder-chevron" :class="isExpanded(f.id) ? 'pi-chevron-down' : 'pi-chevron-right'"></i>
              <i class="pi pi-folder folder-icon"></i>
              <input
                v-if="editingFolderId === f.id"
                class="folder-rename"
                v-model="editFolderName"
                @click.stop
                @keyup.enter="confirmRenameFolder(f)"
                @keyup.esc="cancelRenameFolder"
                @blur="confirmRenameFolder(f)"
                :ref="focusRenameInput"
              />
              <span v-else class="folder-name">{{ f.name }}</span>
              <span class="folder-count">{{ folderTotal(f.id) }}</span>
              <span class="folder-tools" @click.stop>
                <button class="folder-tool" title="Rename folder" @click="startRenameFolder(f)"><i class="pi pi-pencil"></i></button>
                <button class="folder-tool" title="Delete folder" @click="removeFolder(f)"><i class="pi pi-trash"></i></button>
              </span>
            </div>
            <div v-show="isExpanded(f.id)" class="folder-body">
              <component
                :is="editingBoardId === b.id ? 'div' : 'button'"
                v-for="b in folderBoards(f.id)"
                :key="b.id"
                class="rail-item"
                :class="{ active: b.id === store.activeBoardId }"
                @click="selectBoard(b.id)"
              >
                <span class="rail-item-icon"><i class="pi pi-clone"></i></span>
                <span class="rail-item-body">
                  <input
                    v-if="editingBoardId === b.id"
                    class="board-rename"
                    v-model="editBoardName"
                    @click.stop
                    @keyup.enter="confirmRenameBoard(b)"
                    @keyup.esc="cancelRenameBoard"
                    @blur="confirmRenameBoard(b)"
                    :ref="focusRenameInput"
                  />
                  <span v-else class="rail-item-name">{{ b.name }}</span>
                  <span class="rail-meta">
                    <span class="stat" title="Elements"><i class="pi pi-th-large"></i>{{ elementCount(b) || '·' }}</span>
                    <span v-if="b.updated_at" class="stat stat-time">{{ shortAgo(b.updated_at) }}</span>
                  </span>
                </span>
                <span class="rail-item-kebab" role="button" title="Options" @click.stop="openRowMenu($event, b)"><i class="pi pi-ellipsis-v"></i></span>
              </component>
              <div v-if="!folderBoards(f.id).length" class="folder-empty">Empty</div>
            </div>
          </div>

          <!-- Ungrouped boards -->
          <div v-if="ungroupedBoards.length" class="folder-loose">
            <div v-if="visibleFolders.length" class="loose-label">No folder</div>
            <component
              :is="editingBoardId === b.id ? 'div' : 'button'"
              v-for="b in ungroupedBoards"
              :key="b.id"
              class="rail-item"
              :class="{ active: b.id === store.activeBoardId }"
              @click="selectBoard(b.id)"
            >
              <span class="rail-item-icon"><i class="pi pi-clone"></i></span>
              <span class="rail-item-body">
                <input
                  v-if="editingBoardId === b.id"
                  class="board-rename"
                  v-model="editBoardName"
                  @click.stop
                  @keyup.enter="confirmRenameBoard(b)"
                  @keyup.esc="cancelRenameBoard"
                  @blur="confirmRenameBoard(b)"
                  :ref="focusRenameInput"
                />
                <span v-else class="rail-item-name">{{ b.name }}</span>
                <span class="rail-meta">
                  <span class="stat" title="Elements"><i class="pi pi-th-large"></i>{{ elementCount(b) || '·' }}</span>
                  <span v-if="b.updated_at" class="stat stat-time">{{ shortAgo(b.updated_at) }}</span>
                </span>
              </span>
              <span class="rail-item-kebab" role="button" title="Options" @click.stop="openRowMenu($event, b)"><i class="pi pi-ellipsis-v"></i></span>
            </component>
          </div>
        </template>
      </div>

      <!-- Per-board options menu -->
      <div v-if="rowMenu.open" class="sq-menu-backdrop" @click="closeRowMenu" @contextmenu.prevent="closeRowMenu"></div>
      <div v-if="rowMenu.open" class="sq-menu" :style="{ top: rowMenu.y + 'px', left: rowMenu.x + 'px' }">
        <button class="sq-menu-item" @click="renameFromMenu"><i class="pi pi-pencil"></i> Rename</button>
        <button class="sq-menu-item" @click="duplicateFromMenu"><i class="pi pi-copy"></i> Duplicate</button>
        <div class="sq-menu-sep"></div>
        <div class="sq-menu-label">Move to folder</div>
        <button class="sq-menu-item" :class="{ on: !menuBoard?.folder_id }" @click="moveTo(null)">
          <i class="pi pi-inbox"></i> No folder
        </button>
        <button
          v-for="f in foldersSorted"
          :key="f.id"
          class="sq-menu-item"
          :class="{ on: menuBoard?.folder_id === f.id }"
          @click="moveTo(f.id)"
        >
          <i class="pi pi-folder"></i> {{ f.name }}
        </button>
        <div v-if="!foldersSorted.length" class="sq-menu-hint">No folders yet — use the folder button.</div>
        <div class="sq-menu-sep"></div>
        <button class="sq-menu-item danger" @click="deleteFromMenu"><i class="pi pi-trash"></i> Delete board</button>
      </div>
    </aside>

    <!-- ── Stage ── -->
    <main class="stage" ref="stageRef" :class="{ fullscreen: isFullscreen }">
      <button class="btn-ghost btn-sm rail-toggle mobile-only" @click="railOpen = true">
        <i class="pi pi-bars" style="font-size: 0.75rem;"></i> Boards
      </button>

      <div v-if="!store.activeBoard" class="empty">
        <div class="empty-art"><i class="pi pi-clone" style="font-size: 3.5rem; color: var(--text-faint);"></i></div>
        <div class="empty-title">No board selected</div>
        <div class="empty-sub">Create a new board or pick one from the list to start whiteboarding.</div>
        <div class="empty-actions">
          <button class="add-btn add-btn-lg" @click="newBoard">
            <i class="pi pi-plus" style="font-size: 0.875rem;"></i> New board
          </button>
        </div>
      </div>

      <template v-else>
        <!-- Header -->
        <div class="stage-header">
          <input
            class="board-name"
            v-model="nameDraft"
            @change="saveName"
            placeholder="Board name"
          />
          <div class="stage-header-right">
            <span v-if="store.saving" class="save-hint"><i class="pi pi-spin pi-spinner" style="font-size: 0.7rem;"></i> Saving…</span>
            <!-- Main / Branch toggle + merge -->
            <div class="branch-toggle" title="Main is the stable board; Branch is a working copy. AI edits land in the branch.">
              <button class="branch-seg" :class="{ on: activeView === 'main' }" @click="setView('main')">Main</button>
              <button class="branch-seg" :class="{ on: activeView === 'branch' }" @click="setView('branch')">Branch</button>
            </div>
            <button class="btn-ghost btn-sm" @click="mergeBranch" title="Replace main with the branch, then clear the branch">
              <i class="pi pi-arrow-right-arrow-left" style="font-size: 0.8rem;"></i> Merge
            </button>
            <button class="btn-ghost btn-sm" @click="copyForAi" :class="{ copied }">
              <i :class="copied ? 'pi pi-check' : 'pi pi-sparkles'" style="font-size: 0.8rem;"></i>
              {{ copied ? 'Copied!' : 'Copy for AI' }}
            </button>
            <button class="btn-ghost btn-sm" @click="copyToMiro" :class="{ copied: miroCopied }" :title="selCount ? `Copy the ${selCount} selected item(s) as a Miro clipboard — paste straight into miro.com` : 'Copy the board as a Miro clipboard — paste straight into miro.com'">
              <i :class="miroCopied ? 'pi pi-check' : 'pi pi-clone'" style="font-size: 0.8rem;"></i>
              {{ miroCopied ? 'Copied!' : (selCount ? 'Copy selection to Miro' : 'Copy to Miro') }}
            </button>
            <button class="btn-ghost btn-sm" @click="openAi" title="Copy a prompt for an AI, or build the board from its reply">
              <i class="pi pi-bolt" style="font-size: 0.8rem;"></i> AI assist
            </button>
            <button class="icon-btn" @click="toggleFullscreen" :title="isFullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen'">
              <i :class="isFullscreen ? 'pi pi-window-minimize' : 'pi pi-window-maximize'" style="font-size: 0.875rem;"></i>
            </button>
            <button class="icon-btn icon-danger" @click="removeBoard" title="Delete board">
              <i class="pi pi-trash" style="font-size: 0.875rem;"></i>
            </button>
          </div>
        </div>

        <!-- Toolbar -->
        <div class="toolbar">
          <button class="tool" :class="{ on: tool === null }" title="Select / move (Esc)" @click="tool = null">
            <i class="pi pi-arrows-alt"></i>
          </button>
          <span class="tool-sep"></span>
          <button class="tool" :class="{ on: tool === 'sticky' }" title="Sticky note" @click="setTool('sticky')">
            <i class="pi pi-bookmark-fill"></i>
          </button>
          <button class="tool" :class="{ on: tool === 'text' }" title="Text block (T)" @click="setTool('text')">
            <span class="tool-glyph">T</span>
          </button>
          <span class="tool-sep"></span>
          <button class="tool" :class="{ on: tool === 'shape-rect' }" title="Rectangle" @click="setTool('shape-rect')">
            <i class="pi pi-stop"></i>
          </button>
          <button class="tool" :class="{ on: tool === 'shape-ellipse' }" title="Ellipse" @click="setTool('shape-ellipse')">
            <i class="pi pi-circle"></i>
          </button>
          <button class="tool" :class="{ on: tool === 'shape-diamond' }" title="Diamond" @click="setTool('shape-diamond')">
            <i class="pi pi-stop" style="transform: rotate(45deg);"></i>
          </button>
          <button class="tool" :class="{ on: tool === 'shape-cylinder' }" title="Cylinder" @click="setTool('shape-cylinder')">
            <i class="pi pi-database"></i>
          </button>
          <button class="tool" :class="{ on: tool === 'shape-parallelogram' }" title="Parallelogram" @click="setTool('shape-parallelogram')">
            <i class="pi pi-stop" style="transform: skewX(-18deg);"></i>
          </button>
          <button class="tool" :class="{ on: tool === 'draw' }" title="Brush / pen (P)" @click="setTool('draw')">
            <i class="pi pi-pencil"></i>
          </button>
          <span class="tool-sep"></span>
          <button class="tool" :class="{ on: tool === 'arrow' }" title="Connect with arrow" @click="setTool('arrow')">
            <i class="pi pi-arrow-right"></i>
          </button>
          <button class="tool" :class="{ on: tool === 'comment' }" title="Comment pin" @click="setTool('comment')">
            <i class="pi pi-comment"></i>
          </button>

          <!-- Contextual: rotate + layer order (act on the current selection) -->
          <template v-if="selCount">
            <span class="tool-sep"></span>
            <button class="tool" title="Rotate 15° left" @click="canvasRef?.rotateSelection(-15)">
              <i class="pi pi-replay"></i>
            </button>
            <button class="tool" title="Rotate 15° right" @click="canvasRef?.rotateSelection(15)">
              <i class="pi pi-refresh"></i>
            </button>
            <span class="tool-sep"></span>
            <button class="tool" title="Bring to front" @click="canvasRef?.bringToFront()">
              <i class="pi pi-angle-double-up"></i>
            </button>
            <button class="tool" title="Bring forward" @click="canvasRef?.bringForward()">
              <i class="pi pi-angle-up"></i>
            </button>
            <button class="tool" title="Send backward" @click="canvasRef?.sendBackward()">
              <i class="pi pi-angle-down"></i>
            </button>
            <button class="tool" title="Send to back" @click="canvasRef?.sendToBack()">
              <i class="pi pi-angle-double-down"></i>
            </button>
          </template>
        </div>

        <!-- Canvas -->
        <div class="canvas-host">
          <CanvyCanvas
            ref="canvasRef"
            :key="store.activeBoard.id + '-' + activeView + '-' + canvasKey"
            :board-id="store.activeBoard.id"
            :data="activeData"
            :tool="tool"
            @update="onCanvasUpdate"
            @tool-used="tool = null"
            @set-tool="tool = $event"
            @selection-change="onSelectionChange"
          />
        </div>
      </template>

      <p v-if="store.error" class="action-error">{{ store.error }}</p>
    </main>

    <CanvyAiModal
      :open="aiOpen"
      :board="store.activeBoard"
      :board-data="activeData"
      :scope-ids="selIds"
      :build-error="aiError"
      @build="buildFromText"
      @close="aiOpen = false"
    />
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import dayjs from 'dayjs'
import { useCanvyStore, blankData } from '@/stores/canvy'
import CanvyCanvas from '@/components/canvy/CanvyCanvas.vue'
import CanvyAiModal from '@/components/canvy/CanvyAiModal.vue'
import { boardToMarkdown } from '@/lib/canvyExport'
import { buildMiroClipboard } from '@/lib/canvyToMiro'
import { parseBuild, applyScoped, parseCommentBuild } from '@/lib/canvyAi'

const store = useCanvyStore()

const railOpen = ref(false)
const railQuery = ref('')
const tool = ref(null)
const copied = ref(false)
const miroCopied = ref(false)
const nameDraft = ref('')
const aiOpen = ref(false)
const aiError = ref('')
const canvasRef = ref(null)
const canvasKey = ref(0) // bump to force the canvas to reload after an AI build

// ── Fullscreen (stage = header + toolbar + canvas, so all controls stay usable) ──
const stageRef = ref(null)
const isFullscreen = ref(false)
function toggleFullscreen() {
  if (document.fullscreenElement) {
    document.exitFullscreen?.()
  } else {
    stageRef.value?.requestFullscreen?.()
  }
}
function onFullscreenChange() {
  isFullscreen.value = !!document.fullscreenElement
  // the canvas re-measures itself via its ResizeObserver; refit after the resize
  nextTick(() => canvasRef.value?.fit?.())
}
onMounted(() => document.addEventListener('fullscreenchange', onFullscreenChange))
onBeforeUnmount(() => document.removeEventListener('fullscreenchange', onFullscreenChange))

// ── Selection (mirrored from the canvas for the toolbar + AI scope) ──
const selCount = ref(0)
const selIds = ref([])
function onSelectionChange(p) {
  selCount.value = p?.count || 0
  selIds.value = p?.ids || []
}

// ── Main / branch view ──
// Which copy of the active board we're editing. Persisted per board so a board
// reopens on the same view. AI constructive builds always target the branch.
const VIEW_KEY = 'canvy.boardView'
const activeView = ref('main')
function loadViewMap() {
  try { return JSON.parse(localStorage.getItem(VIEW_KEY) || '{}') } catch { return {} }
}
function persistView(boardId, view) {
  try {
    const m = loadViewMap()
    m[boardId] = view
    localStorage.setItem(VIEW_KEY, JSON.stringify(m))
  } catch { /* ignore */ }
}
const activeData = computed(() => {
  const b = store.activeBoard
  if (!b) return blankData()
  return (activeView.value === 'branch' ? b.branch_data : b.data) || blankData()
})
function setView(view) {
  if (activeView.value === view) return
  activeView.value = view
  if (store.activeBoard) persistView(store.activeBoard.id, view)
}
async function mergeBranch() {
  const b = store.activeBoard
  if (!b) return
  if (!window.confirm('Merge the branch into main? This overwrites main and clears the branch.')) return
  try {
    await store.mergeBranch(b.id)
    setView('main')
    canvasKey.value++
  } catch { /* surfaced via store.error */ }
}

function setTool(t) {
  tool.value = tool.value === t ? null : t
}

// Autofocus a freshly-shown rename input. Kept in script (not the template) so
// `document` resolves to the real global — template expressions can't see it.
function focusRenameInput(el) {
  if (el && document.activeElement !== el) el.focus()
}

// ── Catalogue grouping (mirrors Diffy) ──
const matchedBoards = computed(() => {
  const q = railQuery.value.trim().toLowerCase()
  if (!q) return store.boards
  return store.boards.filter((b) => (b.name || '').toLowerCase().includes(q))
})
const foldersSorted = computed(() => [...store.folders].sort((a, b) => a.name.localeCompare(b.name)))
const ungroupedBoards = computed(() => matchedBoards.value.filter((b) => !b.folder_id))
function folderBoards(fid) {
  return matchedBoards.value.filter((b) => b.folder_id === fid)
}
function folderTotal(fid) {
  return store.boards.filter((b) => b.folder_id === fid).length
}
const visibleFolders = computed(() => {
  if (!railQuery.value.trim()) return foldersSorted.value
  return foldersSorted.value.filter((f) => folderBoards(f.id).length)
})

function elementCount(b) {
  return b?.data?.elements?.length || 0
}
function shortAgo(ts) {
  if (!ts) return ''
  const s = Math.max(0, dayjs().diff(dayjs(ts), 'second'))
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  if (s < 2592000) return `${Math.floor(s / 86400)}d`
  if (s < 31536000) return `${Math.floor(s / 2592000)}mo`
  return `${Math.floor(s / 31536000)}y`
}

// ── Folder collapse state (persisted) ──
const COLLAPSE_KEY = 'canvy.collapsedFolders'
const collapsedFolders = ref(new Set(loadCollapsed()))
function loadCollapsed() {
  try { return JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '[]') } catch { return [] }
}
function persistCollapsed() {
  try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...collapsedFolders.value])) } catch { /* ignore */ }
}
function isExpanded(fid) {
  if (railQuery.value.trim()) return true
  return !collapsedFolders.value.has(fid)
}
function toggleFolder(fid) {
  const next = new Set(collapsedFolders.value)
  next.has(fid) ? next.delete(fid) : next.add(fid)
  collapsedFolders.value = next
  persistCollapsed()
}

// ── Folder create / rename / delete ──
const addingFolder = ref(false)
const newFolderName = ref('')
const newFolderInput = ref(null)
const editingFolderId = ref(null)
const editFolderName = ref('')

function startAddFolder() {
  addingFolder.value = true
  newFolderName.value = ''
  nextTick(() => newFolderInput.value?.focus())
}
function cancelAddFolder() {
  addingFolder.value = false
  newFolderName.value = ''
}
async function confirmAddFolder() {
  const name = newFolderName.value.trim()
  addingFolder.value = false
  newFolderName.value = ''
  if (!name) return
  try { await store.createFolder(name) } catch { /* surfaced via store.error */ }
}
function startRenameFolder(f) {
  editingFolderId.value = f.id
  editFolderName.value = f.name
}
function cancelRenameFolder() {
  editingFolderId.value = null
  editFolderName.value = ''
}
async function confirmRenameFolder(f) {
  const name = editFolderName.value.trim()
  editingFolderId.value = null
  editFolderName.value = ''
  if (name && name !== f.name) {
    try { await store.renameFolder(f.id, name) } catch { /* ignore */ }
  }
}
async function removeFolder(f) {
  const n = folderTotal(f.id)
  const msg = n
    ? `Delete folder “${f.name}”? Its ${n} ${n === 1 ? 'board' : 'boards'} will become ungrouped (not deleted).`
    : `Delete folder “${f.name}”?`
  if (!window.confirm(msg)) return
  try { await store.deleteFolder(f.id) } catch { /* ignore */ }
}

// ── Board rename (inline) ──
const editingBoardId = ref(null)
const editBoardName = ref('')
function startRenameBoard(b) {
  editingBoardId.value = b.id
  editBoardName.value = b.name
}
function cancelRenameBoard() {
  editingBoardId.value = null
  editBoardName.value = ''
}
async function confirmRenameBoard(b) {
  const name = editBoardName.value.trim()
  editingBoardId.value = null
  editBoardName.value = ''
  if (name && name !== b.name) {
    try { await store.renameBoard(b.id, name) } catch { /* ignore */ }
  }
}

// ── Per-board menu ──
const rowMenu = ref({ open: false, boardId: null, x: 0, y: 0 })
const menuBoard = computed(() => store.boards.find((b) => b.id === rowMenu.value.boardId) || null)
function openRowMenu(e, b) {
  const r = e.currentTarget.getBoundingClientRect()
  const left = Math.min(r.left, window.innerWidth - 232)
  rowMenu.value = { open: true, boardId: b.id, x: Math.max(8, left), y: r.bottom + 4 }
}
function closeRowMenu() {
  rowMenu.value = { open: false, boardId: null, x: 0, y: 0 }
}
async function moveTo(folderId) {
  const id = rowMenu.value.boardId
  closeRowMenu()
  if (!id) return
  try { await store.moveBoardToFolder(id, folderId) } catch { /* ignore */ }
}
function renameFromMenu() {
  const b = menuBoard.value
  closeRowMenu()
  if (b) startRenameBoard(b)
}
async function duplicateFromMenu() {
  const b = menuBoard.value
  closeRowMenu()
  if (b) { try { await store.duplicateBoard(b.id) } catch { /* ignore */ } }
}
async function deleteFromMenu() {
  const b = menuBoard.value
  closeRowMenu()
  if (!b) return
  if (!window.confirm(`Delete board “${b.name}”?`)) return
  try { await store.deleteBoard(b.id) } catch { /* ignore */ }
}

// ── Active board ──
function selectBoard(id) {
  if (editingBoardId.value === id) return
  railOpen.value = false
  store.selectBoard(id)
}
watch(
  () => store.activeBoard,
  (b) => {
    nameDraft.value = b?.name || ''
    // Restore this board's last-used view (default main).
    if (b) activeView.value = loadViewMap()[b.id] === 'branch' ? 'branch' : 'main'
    selCount.value = 0
    selIds.value = []
  },
  { immediate: true },
)
async function saveName() {
  const b = store.activeBoard
  if (!b) return
  const name = nameDraft.value.trim()
  if (!name || name === b.name) { nameDraft.value = b.name; return }
  try { await store.renameBoard(b.id, name) } catch { /* ignore */ }
}
function onCanvasUpdate(data) {
  if (store.activeBoard) store.updateBoardData(store.activeBoard.id, data, activeView.value)
}
async function newBoard() {
  try { await store.createBoard({}) } catch { /* ignore */ }
}
async function removeBoard() {
  const b = store.activeBoard
  if (!b) return
  if (!window.confirm(`Delete board “${b.name}”?`)) return
  try { await store.deleteBoard(b.id) } catch { /* ignore */ }
}

// ── Copy for AI ──
async function copyForAi() {
  const b = store.activeBoard
  if (!b) return
  try {
    await navigator.clipboard.writeText(boardToMarkdown({ name: b.name, data: activeData.value }))
    copied.value = true
    setTimeout(() => { copied.value = false }, 1600)
  } catch (e) {
    console.error('[Canvy] copyForAi error:', e)
  }
}

// ── Copy to Miro ──
// Write a Miro clipboard payload (rich text/html) so the board can be pasted
// straight into miro.com. Needs the async Clipboard API + ClipboardItem.
async function copyToMiro() {
  const b = store.activeBoard
  if (!b) return
  try {
    // If a selection is active, copy just those elements (and arrows between
    // them); otherwise copy the whole board.
    const opts = selIds.value.length ? { onlyIds: selIds.value } : {}
    const { html, text } = buildMiroClipboard({ name: b.name, data: activeData.value }, opts)
    if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' }),
        }),
      ])
    } else {
      // Fallback for browsers without ClipboardItem: plain text only.
      await navigator.clipboard.writeText(text)
    }
    miroCopied.value = true
    setTimeout(() => { miroCopied.value = false }, 1600)
  } catch (e) {
    console.error('[Canvy] copyToMiro error:', e)
  }
}

// ── AI assist (copy prompt / build from reply) ──
function openAi() {
  aiError.value = ''
  aiOpen.value = true
}
function buildFromText(payload) {
  aiError.value = ''
  const b = store.activeBoard
  if (!b) return
  const text = typeof payload === 'string' ? payload : payload.text
  const mode = typeof payload === 'string' ? 'edit' : payload.mode
  const scoped = typeof payload === 'string' ? false : payload.scoped

  // Comment-only review: merge comments into whichever view is shown — never
  // restructures the board.
  if (mode === 'comment') {
    const res = parseCommentBuild(text, activeData.value)
    if (!res.ok) { aiError.value = res.error; return }
    store.updateBoardData(b.id, { ...activeData.value, comments: res.comments }, activeView.value)
    aiOpen.value = false
    canvasKey.value++
    if (res.warnings?.length) console.warn('[Canvy] AI comment warnings:', res.warnings)
    return
  }

  // Constructive edit: always lands in the branch. Scoped edits merge the
  // assistant's section back into the data the prompt was built from (the current
  // view); full builds replace it. Either way the result is stored as the branch.
  const res = scoped ? applyScoped(text, activeData.value, new Set(selIds.value)) : parseBuild(text)
  if (!res.ok) { aiError.value = res.error; return }
  store.updateBoardData(b.id, res.data, 'branch')
  if (activeView.value !== 'branch') {
    setView('branch')
  }
  aiOpen.value = false
  canvasKey.value++ // force the canvas to reload from the new data and re-fit
  if (res.warnings?.length) console.warn('[Canvy] AI build warnings:', res.warnings)
}
</script>

<style scoped>
.canvy-app {
  --accent-hue: 10; /* red — shared Tools brand (matches Diffy / Breadly) */
  --accent-500: #ef4444;
  --accent-600: #b91c1c;
  --accent-400: #f87171;
  --accent-100: #fee2e2;
  --accent-050: #fef2f2;

  --bg-card:     #ffffff;
  --bg-sunken:   #f3f2f0;
  --border:      #e5e4e1;
  --border-soft: #eeede9;
  --text:        #1a1a1a;
  --text-dim:    #5c5c5c;
  --text-faint:  #9a9a9a;

  --radius:    0.75rem;
  --radius-lg: 1rem;
  --shadow-sm: 0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.02);
  --shadow:    0 2px 8px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.04);
  --shadow-lg: 0 8px 30px rgba(0,0,0,0.08), 0 2px 8px rgba(0,0,0,0.04);

  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Helvetica, Arial, sans-serif;
  color: var(--text);
  font-size: 0.9375rem;
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
  height: calc(100vh - 5rem);
  display: flex;
  align-items: stretch;
}
.canvy-app button { font: inherit; color: inherit; cursor: pointer; background: none; border: none; padding: 0; }
.canvy-app input, .canvy-app select, .canvy-app textarea { font: inherit; color: inherit; }

/* ── Rail ── */
.rail {
  width: 18.5rem;
  flex-shrink: 0;
  border-right: 1px solid var(--border);
  padding: 1.25rem 0.85rem 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  background: var(--bg-card);
}
.rail-head { display: flex; justify-content: space-between; align-items: flex-start; }
.eyebrow {
  font-size: 0.68rem; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.09em; color: var(--accent-500);
}
.rail-title { font-size: 1.4rem; font-weight: 800; margin: 0.1rem 0 0; letter-spacing: -0.01em; }
.rail-sub { margin-top: 0.15rem; font-size: 0.75rem; color: var(--text-faint); }

.rail-search {
  display: flex; align-items: center; gap: 0.45rem;
  border: 1px solid var(--border); border-radius: 0.6rem;
  padding: 0 0.6rem; background: var(--bg-sunken);
  transition: border-color 120ms, background 120ms;
}
.rail-search:focus-within { border-color: var(--accent-500); background: #fff; box-shadow: 0 0 0 3px var(--accent-050); }
.rail-search .pi-search { font-size: 0.8rem; color: var(--text-faint); }
.rail-search input {
  flex: 1; min-width: 0; border: none; outline: none; background: transparent;
  padding: 0.5rem 0; font-size: 0.85rem; color: var(--text);
}
.rail-search input::placeholder { color: var(--text-faint); }
.rail-search-clear { color: var(--text-faint); padding: 0.15rem; font-size: 0.72rem; display: inline-flex; }
.rail-search-clear:hover { color: var(--text-dim); }

.rail-list {
  flex: 1; overflow-y: auto; display: flex; flex-direction: column;
  gap: 0.4rem; min-height: 4rem; padding: 0.15rem 0.15rem 0.4rem;
}
.canvy-app .rail-item {
  position: relative;
  display: flex; align-items: flex-start; gap: 0.6rem;
  width: 100%; text-align: left;
  padding: 0.65rem 0.7rem; border-radius: 0.65rem;
  background: var(--bg-card);
  border: 1px solid var(--border);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
  transition: border-color 120ms, box-shadow 120ms, background 120ms;
}
.canvy-app .rail-item:hover { border-color: var(--accent-400); box-shadow: 0 2px 7px rgba(0, 0, 0, 0.07); }
.canvy-app .rail-item.active {
  background: var(--accent-050);
  border-color: var(--accent-500);
  box-shadow: 0 1px 3px rgba(239, 68, 68, 0.18);
}
.rail-item-icon {
  flex: none; width: 1.85rem; height: 1.85rem; border-radius: 0.5rem;
  display: inline-flex; align-items: center; justify-content: center;
  background: var(--bg-sunken); color: var(--text-dim); font-size: 0.9rem;
}
.rail-item.active .rail-item-icon { background: #fff; color: var(--accent-600); }
.rail-item-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.3rem; }
.rail-item-name {
  font-weight: 700; font-size: 0.9rem; line-height: 1.25;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.rail-item.active .rail-item-name { color: var(--accent-600); }
.board-rename {
  width: 100%; border: 1px solid var(--accent-400); border-radius: 0.4rem;
  padding: 0.15rem 0.4rem; font-size: 0.88rem; font-weight: 700; outline: none;
  background: #fff; color: var(--text);
}

.rail-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 0.4rem; margin-top: 0.05rem; }
.rail-meta .stat { display: inline-flex; align-items: center; gap: 0.25rem; font-size: 0.72rem; color: var(--text-dim); }
.rail-meta .stat i { font-size: 0.68rem; color: var(--text-faint); }
.rail-meta .stat-time { margin-left: auto; color: var(--text-faint); font-size: 0.7rem; }

.rail-state {
  display: flex; flex-direction: column; align-items: center; gap: 0.45rem;
  padding: 1.75rem 0.5rem; color: var(--text-faint); font-size: 0.875rem; text-align: center;
}
.rail-state-icon { font-size: 1.5rem; opacity: 0.55; }

.rail-actions { display: flex; gap: 0.4rem; align-items: stretch; }
.canvy-app .add-btn.rail-new { width: auto; flex: 1; height: 2.6rem; padding: 0 1rem; border-radius: 0.6rem; font-weight: 600; }
.canvy-app .rail-actions .rail-newfolder {
  width: 2.6rem; height: 2.6rem; border-radius: 0.6rem;
  border: 1px solid var(--border); background: var(--bg-card); color: var(--text-dim);
}
.canvy-app .rail-actions .rail-newfolder:hover { background: var(--accent-050); border-color: var(--accent-400); color: var(--accent-600); }

.folder-add {
  display: flex; align-items: center; gap: 0.45rem;
  padding: 0.5rem 0.6rem; border: 1px dashed var(--accent-400);
  border-radius: 0.6rem; background: var(--accent-050);
}
.folder-add .folder-icon { color: var(--accent-600); font-size: 0.85rem; }
.folder-add input {
  flex: 1; min-width: 0; border: none; outline: none; background: transparent;
  font-size: 0.85rem; font-weight: 600; color: var(--text);
}

.folder { display: flex; flex-direction: column; }
.folder-head {
  display: flex; align-items: center; gap: 0.4rem;
  padding: 0.4rem; border-radius: 0.5rem; cursor: pointer;
  user-select: none; transition: background 120ms;
}
.folder-head:hover { background: var(--bg-sunken); }
.folder-chevron { font-size: 0.7rem; color: var(--text-faint); width: 0.8rem; text-align: center; }
.folder-head .folder-icon { font-size: 0.85rem; color: var(--accent-600); }
.folder-name {
  flex: 1; min-width: 0; font-size: 0.82rem; font-weight: 700;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.folder-rename {
  flex: 1; min-width: 0; border: 1px solid var(--accent-400); border-radius: 0.4rem;
  padding: 0.15rem 0.4rem; font-size: 0.82rem; font-weight: 700; outline: none;
  background: #fff; color: var(--text);
}
.folder-count {
  font-size: 0.68rem; font-weight: 700; color: var(--text-faint);
  background: var(--bg-sunken); border-radius: 999px;
  padding: 0.05rem 0.4rem; min-width: 1.1rem; text-align: center;
}
.folder-tools { display: none; align-items: center; gap: 0.1rem; }
.folder-head:hover .folder-tools { display: flex; }
.canvy-app .folder-tool {
  width: 1.5rem; height: 1.5rem; border-radius: 0.35rem; display: inline-flex;
  align-items: center; justify-content: center; color: var(--text-faint); font-size: 0.7rem;
}
.canvy-app .folder-tool:hover { background: #fff; color: var(--accent-600); box-shadow: 0 1px 2px rgba(0,0,0,0.08); }
.canvy-app .folder-tool:last-child:hover { color: #c33; }
.folder-body {
  display: flex; flex-direction: column; gap: 0.35rem;
  padding: 0.35rem 0 0.2rem 0.55rem; margin: 0.1rem 0 0.15rem 0.45rem;
  border-left: 1px solid var(--border-soft);
}
.folder-empty { font-size: 0.74rem; color: var(--text-faint); padding: 0.2rem 0.4rem; font-style: italic; }

.folder-loose { display: flex; flex-direction: column; gap: 0.4rem; }
.loose-label {
  font-size: 0.62rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em;
  color: var(--text-faint); padding: 0.5rem 0.4rem 0.05rem;
}

.rail-item-kebab {
  flex: none; align-self: center; width: 1.4rem; height: 1.4rem;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 0.35rem; color: var(--text-faint); font-size: 0.8rem;
  opacity: 0; transition: opacity 120ms, background 120ms, color 120ms;
}
.rail-item:hover .rail-item-kebab,
.rail-item.active .rail-item-kebab { opacity: 1; }
.rail-item-kebab:hover { background: #fff; color: var(--accent-600); box-shadow: 0 1px 2px rgba(0,0,0,0.08); }

.sq-menu-backdrop { position: fixed; inset: 0; z-index: 120; }
.sq-menu {
  position: fixed; z-index: 121; width: 13.5rem; max-height: 60vh; overflow-y: auto;
  background: #fff; border: 1px solid var(--border); border-radius: 0.6rem;
  box-shadow: var(--shadow-lg); padding: 0.3rem;
}
.sq-menu-label {
  font-size: 0.62rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em;
  color: var(--text-faint); padding: 0.3rem 0.5rem 0.2rem;
}
.canvy-app .sq-menu-item {
  display: flex; align-items: center; gap: 0.5rem; width: 100%; text-align: left;
  padding: 0.4rem 0.5rem; border-radius: 0.4rem; font-size: 0.83rem; color: var(--text);
}
.canvy-app .sq-menu-item i { font-size: 0.78rem; color: var(--text-faint); width: 0.9rem; }
.canvy-app .sq-menu-item:hover { background: var(--accent-050); }
.canvy-app .sq-menu-item.on { color: var(--accent-600); font-weight: 600; }
.canvy-app .sq-menu-item.on i { color: var(--accent-600); }
.canvy-app .sq-menu-item.danger { color: #c33; }
.canvy-app .sq-menu-item.danger i { color: #c33; }
.canvy-app .sq-menu-item.danger:hover { background: #fff0f0; }
.sq-menu-hint { font-size: 0.72rem; color: var(--text-faint); padding: 0.2rem 0.5rem 0.4rem; line-height: 1.35; }
.sq-menu-sep { height: 1px; background: var(--border-soft); margin: 0.3rem 0.2rem; }

/* ── Stage ── */
.stage {
  flex: 1; min-width: 0;
  display: flex; flex-direction: column;
  padding: 1.25rem 1.25rem 0;
  gap: 0.85rem;
  min-height: 0;
}
.rail-toggle { align-self: flex-start; }

/* Fullscreen: the stage is rendered in the top layer, so give it the app
   background + a little padding and let the canvas fill the rest. */
.stage:fullscreen { background: var(--bg-card, #fff); padding: 1rem 1rem 0; }
.stage:fullscreen .canvas-host { border-radius: 0.75rem; }

.stage-header { display: flex; justify-content: space-between; align-items: center; gap: 1rem; flex-wrap: wrap; }
.board-name {
  font-size: 1.5rem; font-weight: 700; letter-spacing: -0.02em;
  border: none; outline: none; background: none;
  flex: 1; min-width: 10rem; padding: 0.2rem 0;
  border-bottom: 2px solid transparent;
}
.board-name:focus { border-bottom-color: var(--accent-400); }
.stage-header-right { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
.save-hint { font-size: 0.78rem; color: var(--text-faint); }

/* Main / branch segmented toggle */
.branch-toggle {
  display: inline-flex; align-items: center;
  border: 1px solid var(--border); border-radius: 0.55rem;
  background: var(--bg-sunken); padding: 0.15rem; gap: 0.1rem;
}
.canvy-app .branch-seg {
  padding: 0.3rem 0.7rem; border-radius: 0.4rem;
  font-size: 0.8rem; font-weight: 600; color: var(--text-dim);
}
.canvy-app .branch-seg.on { background: #fff; color: var(--accent-600); box-shadow: 0 1px 2px rgba(0,0,0,0.08); }

/* toolbar */
.toolbar {
  display: flex; align-items: center; gap: 0.2rem; flex-wrap: wrap;
  padding: 0.35rem;
  background: var(--bg-card); border: 1px solid var(--border);
  border-radius: 0.7rem; box-shadow: var(--shadow-sm);
  align-self: flex-start;
}
.canvy-app .tool {
  width: 2.2rem; height: 2.2rem; border-radius: 0.5rem;
  display: inline-flex; align-items: center; justify-content: center;
  color: var(--text-dim); font-size: 0.95rem; transition: all 120ms;
}
.canvy-app .tool:hover { background: var(--bg-sunken); color: var(--text); }
.canvy-app .tool.on { background: var(--accent-050); color: var(--accent-600); box-shadow: inset 0 0 0 1px var(--accent-400); }
.tool-glyph { font-weight: 800; font-size: 1.05rem; line-height: 1; font-family: Georgia, 'Times New Roman', serif; }
.tool-sep { width: 1px; height: 1.4rem; background: var(--border); margin: 0 0.25rem; }

/* canvas host */
.canvas-host {
  flex: 1; min-height: 0;
  border: 1px solid var(--border);
  border-top-left-radius: 0.75rem;
  border-top-right-radius: 0.75rem;
  overflow: hidden;
}

/* ── Buttons ── */
.canvy-app .add-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem;
  background: var(--accent-500); color: #fff;
  padding: 0.625rem 1.25rem; height: 2.625rem; border-radius: 0.625rem;
  font-size: 0.9375rem; font-weight: 600;
  box-shadow: 0 0.125rem 0.5rem rgba(239, 68, 68, 0.25);
  transition: background 120ms, transform 120ms;
}
.canvy-app .add-btn:hover:not(:disabled) { background: var(--accent-600); transform: translateY(-1px); }
.canvy-app .add-btn-lg { height: 3.125rem; padding: 0.875rem 2.5rem; font-size: 1rem; }

.canvy-app .btn-ghost {
  padding: 0.5rem 1rem; height: 2.5rem; border-radius: 0.625rem;
  font-size: 0.875rem; color: var(--text-dim);
  border: 1px solid var(--border); background: #fff;
  display: inline-flex; align-items: center; gap: 0.375rem; font-weight: 500;
  transition: all 120ms;
}
.canvy-app .btn-ghost:hover:not(:disabled) { border-color: var(--text-faint); color: var(--text); background: var(--bg-sunken); }
.canvy-app .btn-ghost.copied { color: var(--accent-600); border-color: var(--accent-400); background: var(--accent-050); }
.canvy-app .btn-sm { height: 2.125rem; padding: 0.375rem 0.75rem; font-size: 0.8125rem; justify-content: center; }

.canvy-app .icon-btn {
  width: 2.25rem; height: 2.25rem; border-radius: 0.5rem;
  display: flex; align-items: center; justify-content: center;
  color: var(--text-faint); transition: all 120ms; flex-shrink: 0;
}
.canvy-app .icon-btn:hover { background: var(--bg-sunken); color: var(--text); }
.canvy-app .icon-danger:hover { background: #fff0f0; color: #c33; }

/* ── Empty ── */
.empty {
  background: var(--bg-card); border: 2px dashed var(--border); border-radius: var(--radius-lg);
  padding: 5rem 2.5rem; text-align: center; margin: auto;
  display: flex; flex-direction: column; align-items: center; gap: 0.75rem;
}
.empty-title { font-size: 1.25rem; font-weight: 600; }
.empty-sub { font-size: 0.9375rem; color: var(--text-dim); max-width: 24rem; }
.empty-actions { margin-top: 1rem; }

.action-error { color: oklch(0.55 0.16 25); font-size: 0.875rem; margin: 0; }

/* ── Mobile ── */
.canvy-app .mobile-only { display: none; }
@media (max-width: 47.99em) {
  .canvy-app .mobile-only { display: inline-flex; }
  .rail {
    position: fixed; top: 0; left: 0; bottom: 0; z-index: 90;
    width: 17rem; transform: translateX(-100%); transition: transform 200ms;
    box-shadow: var(--shadow-lg);
  }
  .rail.open { transform: translateX(0); }
  .stage { padding: 1rem 1rem 0; }
}
</style>
