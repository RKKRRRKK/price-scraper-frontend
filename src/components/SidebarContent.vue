<template>
  <div :class="['sidebar-nav', { plain: variant === 'plain' }]">
    <div class="sidebar-head">
      <span class="sidebar-title">Folders</span>
      <span
        v-if="variant === 'plain'"
        class="drawer-close"
        role="button"
        aria-label="Close folders"
        @click="emit('close')"
        >×</span
      >
    </div>

    <div class="tree-wrapper">
      <Tree
        :value="nodes"
        nodeKey="key"
        v-model:expandedKeys="store.expandedKeys"
        v-model:selectionKeys="selectionKeys"
        selectionMode="single"
        class="folder-tree"
      >
        <template #default="{ node }">
          <div class="node-content" :class="node.leaf ? 'node-file' : 'node-folder'">
            <span class="node-label">{{ node.label }}</span>

            <span
              v-if="node.leaf && isSelected(node.key) && jobCount(node.key) > 0"
              class="job-count"
              >{{ jobCount(node.key) }}</span
            >

            <div class="action-buttons">
              <template v-if="!node.leaf">
                <Button
                  icon="pi pi-plus"
                  class="p-button-text p-button-sm node-action"
                  @click.stop="openAddFileDialog(node.key)"
                  aria-label="Add file"
                />
                <Button
                  icon="pi pi-pencil"
                  class="p-button-text p-button-sm node-action"
                  @click.stop="openRenameFolderDialog(node.key)"
                  aria-label="Rename folder"
                />
                <Button
                  icon="pi pi-trash"
                  class="p-button-text p-button-sm p-button-danger node-action"
                  @click.stop="openDeleteFolderDialog(node.key)"
                  aria-label="Delete folder"
                />
              </template>
              <template v-else>
                <Button
                  icon="pi pi-pencil"
                  class="p-button-text p-button-sm node-action"
                  @click.stop="openRenameFileDialog(node.key)"
                  aria-label="Rename file"
                />
                <Button
                  icon="pi pi-trash"
                  class="p-button-text p-button-sm p-button-danger node-action"
                  @click.stop="openDeleteFileDialog(node.key)"
                  aria-label="Delete file"
                />
              </template>
            </div>
          </div>
        </template>
      </Tree>
    </div>

    <div class="add-folder-container">
      <button class="add-folder-btn" @click="openAddFolderDialog">+ Add folder</button>
    </div>

    <!-- dialogs (logic unchanged) -->
    <Dialog
      v-model:visible="dialogState.addFolder.visible"
      :header="dialogState.addFolder.title"
      :style="{ width: '350px' }"
      modal
    >
      <div class="field">
        <label for="folderName">Folder Name</label>
        <InputText
          id="folderName"
          v-model="dialogState.addFolder.name"
          class="w-full"
          autofocus
          @keydown.enter="confirmAddFolder"
        />
      </div>
      <template #footer>
        <Button
          label="Cancel"
          icon="pi pi-times"
          class="p-button-text"
          @click="closeDialog('addFolder')"
        />
        <Button label="Save" icon="pi pi-check" @click="confirmAddFolder" autofocus />
      </template>
    </Dialog>

    <Dialog
      v-model:visible="dialogState.addFile.visible"
      :header="dialogState.addFile.title"
      :style="{ width: '350px' }"
      modal
    >
      <div class="field">
        <label for="fileName">File Name</label>
        <InputText
          id="fileName"
          v-model="dialogState.addFile.name"
          class="w-full"
          autofocus
          @keydown.enter="confirmAddFile"
        />
      </div>
      <template #footer>
        <Button
          label="Cancel"
          icon="pi pi-times"
          class="p-button-text"
          @click="closeDialog('addFile')"
        />
        <Button label="Save" icon="pi pi-check" @click="confirmAddFile" autofocus />
      </template>
    </Dialog>

    <Dialog
      v-model:visible="dialogState.renameFolder.visible"
      :header="dialogState.renameFolder.title"
      :style="{ width: '350px' }"
      modal
    >
      <div class="field">
        <label for="folderNewName">New Folder Name</label>
        <InputText
          id="folderNewName"
          v-model="dialogState.renameFolder.name"
          class="w-full"
          autofocus
          @keydown.enter="confirmRenameFolder"
        />
      </div>
      <template #footer>
        <Button
          label="Cancel"
          icon="pi pi-times"
          class="p-button-text"
          @click="closeDialog('renameFolder')"
        />
        <Button label="Save" icon="pi pi-check" @click="confirmRenameFolder" autofocus />
      </template>
    </Dialog>

    <Dialog
      v-model:visible="dialogState.renameFile.visible"
      :header="dialogState.renameFile.title"
      :style="{ width: '350px' }"
      modal
    >
      <div class="field">
        <label for="fileNewName">New File Name</label>
        <InputText
          id="fileNewName"
          v-model="dialogState.renameFile.name"
          class="w-full"
          autofocus
          @keydown.enter="confirmRenameFile"
        />
      </div>
      <template #footer>
        <Button
          label="Cancel"
          icon="pi pi-times"
          class="p-button-text"
          @click="closeDialog('renameFile')"
        />
        <Button label="Save" icon="pi pi-check" @click="confirmRenameFile" autofocus />
      </template>
    </Dialog>

    <ConfirmDialog />
  </div>
</template>

<script setup>
import { computed, reactive } from 'vue'
import Tree from 'primevue/tree'
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import ConfirmDialog from 'primevue/confirmdialog'
import { useConfirm } from 'primevue/useconfirm'
import { useSidebarStore } from '@/stores/sidebar'
import { useSearchTerms } from '@/stores/searchTerms'

defineProps({
  /** 'card' = desktop rail · 'plain' = mobile drawer */
  variant: { type: String, default: 'card' },
})
const emit = defineEmits(['file-selected', 'close'])

const store = useSidebarStore()
const termsStore = useSearchTerms()
const confirm = useConfirm()

/* -------- job counts per file (kleinanzeigen-only) -------- */
function jobCount(compositeKey) {
  const [, fileIdStr] = compositeKey.split('__')
  const fileId = Number(fileIdStr)
  return termsStore.terms.filter(
    (t) => t.fileId === fileId && t.marketplace === 'kleinanzeigen',
  ).length
}
function isSelected(compositeKey) {
  if (!store.selectedFile) return false
  const { folderId, fileId } = store.selectedFile
  return compositeKey === `${folderId}__${fileId}`
}

/* -------- state & helpers (unchanged) -------- */
const dialogState = reactive({
  addFolder: { visible: false, title: 'Add New Folder', name: '' },
  addFile: { visible: false, title: 'Add New File', folderId: null, name: '' },
  renameFolder: { visible: false, title: 'Rename Folder', id: null, name: '' },
  renameFile: { visible: false, title: 'Rename File', id: null, name: '' },
})

const nodes = computed(() =>
  store.folders.map((folder) => ({
    key: String(folder.id),
    label: folder.name,
    selectable: false,
    children: folder.files.map((file) => ({
      key: `${folder.id}__${file.id}`,
      label: file.name,
      leaf: true,
      selectable: true,
    })),
  })),
)

const selectionKeys = computed({
  get() {
    if (!store.selectedFile) return {}
    const { folderId, fileId } = store.selectedFile
    return { [`${folderId}__${fileId}`]: true }
  },
  set(val) {
    let newSelectedNodeKey = null
    if (val && typeof val === 'object' && Object.keys(val).length > 0) {
      newSelectedNodeKey = Object.keys(val)[0]
    }

    if (newSelectedNodeKey && newSelectedNodeKey.includes('__')) {
      const [folderIdStr, fileIdStr] = newSelectedNodeKey.split('__')
      const folderId = Number(folderIdStr)
      const fileId = Number(fileIdStr)
      if (
        !store.selectedFile ||
        store.selectedFile.folderId !== folderId ||
        store.selectedFile.fileId !== fileId
      ) {
        store.selectFile(folderId, fileId)
        emit('file-selected', fileId)
      }
    } else if (newSelectedNodeKey && !newSelectedNodeKey.includes('__')) {
      if (store.selectedFile) store.resetSelection()
    } else {
      if (store.selectedFile) store.resetSelection()
    }
  },
})

function closeDialog(type) {
  dialogState[type].visible = false
  dialogState[type].name = ''
  if (type === 'addFile') dialogState[type].folderId = null
  if (type === 'renameFolder' || type === 'renameFile') dialogState[type].id = null
}
function openAddFolderDialog() {
  dialogState.addFolder.visible = true
}
function confirmAddFolder() {
  const name = dialogState.addFolder.name.trim()
  if (name) {
    store.addFolder(name)
    closeDialog('addFolder')
  }
}
function openAddFileDialog(folderKey) {
  dialogState.addFile.folderId = Number(folderKey)
  dialogState.addFile.visible = true
}
function confirmAddFile() {
  const name = dialogState.addFile.name.trim()
  if (name && dialogState.addFile.folderId) {
    store.addFile(dialogState.addFile.folderId, name)
    closeDialog('addFile')
  }
}
function openRenameFolderDialog(key) {
  const id = Number(key)
  const folder = store.folders.find((f) => f.id === id)
  if (folder) {
    dialogState.renameFolder.id = id
    dialogState.renameFolder.name = folder.name
    dialogState.renameFolder.visible = true
  }
}
function confirmRenameFolder() {
  const name = dialogState.renameFolder.name.trim()
  if (name && dialogState.renameFolder.id) {
    store.renameFolder(dialogState.renameFolder.id, name)
    closeDialog('renameFolder')
  }
}
function openRenameFileDialog(compositeKey) {
  const [, fileIdStr] = compositeKey.split('__')
  const fileId = Number(fileIdStr)
  let fileName = ''
  for (const folder of store.folders) {
    const file = folder.files.find((f) => f.id === fileId)
    if (file) {
      fileName = file.name
      break
    }
  }
  dialogState.renameFile.id = fileId
  dialogState.renameFile.name = fileName
  dialogState.renameFile.visible = true
}
function confirmRenameFile() {
  const name = dialogState.renameFile.name.trim()
  if (name && dialogState.renameFile.id) {
    store.renameFile(dialogState.renameFile.id, name)
    closeDialog('renameFile')
  }
}
function openDeleteFolderDialog(key) {
  const id = Number(key)
  const folder = store.folders.find((f) => f.id === id)
  if (folder) {
    confirm.require({
      message: `Are you sure you want to delete the folder "${folder.name}" and all its files?`,
      header: 'Delete Folder',
      icon: 'pi pi-exclamation-triangle',
      acceptClass: 'p-button-danger',
      accept: () => store.deleteFolder(id),
    })
  }
}
function openDeleteFileDialog(compositeKey) {
  const [, fileIdStr] = compositeKey.split('__')
  const fileId = Number(fileIdStr)
  let fileName = '',
    file = null
  for (const folder of store.folders) {
    file = folder.files.find((f) => f.id === fileId)
    if (file) {
      fileName = file.name
      break
    }
  }
  if (file) {
    confirm.require({
      message: `Are you sure you want to delete the file "${fileName}"?`,
      header: 'Delete File',
      icon: 'pi pi-exclamation-triangle',
      acceptClass: 'p-button-danger',
      accept: () => store.deleteFile(fileId),
    })
  }
}
</script>

<style scoped>
.sidebar-nav {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 2px;
  background: #fffdf9;
  border-right: 1px solid #eadfcf;
  padding: 20px 12px;
}
.sidebar-nav.plain {
  border-right: none;
}

.sidebar-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px 10px;
}
.sidebar-title {
  font-size: 0.6875rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #c9a877;
}
.drawer-close {
  color: #c4ad8a;
  font-size: 1.125rem;
  line-height: 1;
  padding: 2px 6px;
  cursor: pointer;
}
.drawer-close:hover {
  color: #3d3226;
}

.tree-wrapper {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
}

/* ───── tree reset + restyle ───── */
.folder-tree,
.folder-tree :deep(.p-tree) {
  border: none;
  background: transparent;
  padding: 0;
}
.folder-tree :deep(.p-treenode) {
  padding: 0;
}
.folder-tree :deep(.p-tree-node-children),
.folder-tree :deep(.p-treenode-children) {
  padding-left: 14px;
}
.folder-tree :deep(.p-treenode-content),
.folder-tree :deep(.p-tree-node-content) {
  padding: 7px 12px;
  border-radius: 8px;
  transition: background-color 0.15s;
}
.folder-tree :deep(.p-treenode-content:hover),
.folder-tree :deep(.p-tree-node-content:hover) {
  background-color: #f8f0e4;
}
.folder-tree :deep(.p-tree-toggler) {
  width: 1.25rem;
  height: 1.25rem;
  margin-right: 0.25rem;
  color: #40382e;
}
.folder-tree :deep(.p-tree-toggler-icon) {
  color: #c9a877;
}

/* selected file */
.folder-tree :deep(.p-treenode-content.p-highlight),
.folder-tree :deep(.p-tree-node-content.p-tree-node-selected),
.folder-tree :deep(.p-tree-node-content[data-p-selected='true']) {
  background-color: #ffe8d2 !important;
}
.folder-tree :deep(.p-treenode-content.p-highlight) .node-label,
.folder-tree :deep(.p-tree-node-content[data-p-selected='true']) .node-label {
  color: #b3520e;
  font-weight: 600;
}

.node-content {
  display: flex;
  align-items: center;
  width: 100%;
  gap: 8px;
}
.node-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.875rem;
}
.node-file .node-label {
  color: #8a7a64;
}
.node-folder .node-label {
  color: #40382e;
  font-weight: 600;
}

.job-count {
  font-size: 0.6875rem;
  font-weight: 700;
  background: #fdd9b5;
  color: #b3520e;
  border-radius: 99px;
  padding: 2px 8px;
  flex-shrink: 0;
}

.action-buttons {
  display: none;
  align-items: center;
  gap: 2px;
}
.node-content:hover .action-buttons {
  display: flex;
}
.action-buttons :deep(.node-action.p-button) {
  width: 1.5rem;
  height: 1.5rem;
  padding: 0.25rem;
}

/* ───── add folder ghost button ───── */
.add-folder-container {
  margin-top: auto;
  padding: 8px 4px 0;
}
.add-folder-btn {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1.5px dashed #e2b98f;
  background: transparent;
  color: #c2540a;
  font-family: inherit;
  font-size: 0.8125rem;
  font-weight: 600;
  border-radius: 10px;
  padding: 10px;
  cursor: pointer;
  transition: background-color 0.15s;
}
.add-folder-btn:hover {
  background: #fff3e8;
}

/* ───── plain (mobile drawer) — taller touch targets ───── */
.sidebar-nav.plain .folder-tree :deep(.p-treenode-content),
.sidebar-nav.plain .folder-tree :deep(.p-tree-node-content) {
  padding: 11px 14px;
  border-radius: 10px;
}
.sidebar-nav.plain .node-label {
  font-size: 0.9375rem;
}
.sidebar-nav.plain .add-folder-btn {
  padding: 12px;
  font-size: 0.875rem;
}

.field {
  margin-bottom: 1rem;
}
.field label {
  display: block;
  margin-bottom: 0.5rem;
  font-weight: 500;
}
</style>
