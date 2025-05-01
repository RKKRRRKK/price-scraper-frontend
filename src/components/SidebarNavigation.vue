<!-- File: src/components/SidebarNavigation.vue -->
<template>
    <div class="sidebar-nav">
      <h3 class="sidebar-title">Folders</h3>
      
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
            <div class="node-content">
              <!-- Only show one icon based on whether it's a folder or file -->
              <i :class="[node.leaf ? 'pi pi-file' : 'pi pi-folder', 'node-icon']"></i>
              <span class="node-label">{{ node.label }}</span>
              
              <!-- Show action buttons only when hovering -->
              <div class="action-buttons">
                <template v-if="!node.leaf">
                  <Button 
                    icon="pi pi-plus" 
                    class="p-button-text p-button-sm" 
                    @click.stop="openAddFileDialog(node.key)"
                    aria-label="Add file"
                  />
                  <Button 
                    icon="pi pi-pencil" 
                    class="p-button-text p-button-sm" 
                    @click.stop="openRenameFolderDialog(node.key)"
                    aria-label="Rename folder"
                  />
                  <Button 
                    icon="pi pi-trash" 
                    class="p-button-text p-button-sm p-button-danger" 
                    @click.stop="openDeleteFolderDialog(node.key)"
                    aria-label="Delete folder"
                  />
                </template>
                <template v-else>
                  <Button 
                    icon="pi pi-pencil" 
                    class="p-button-text p-button-sm" 
                    @click.stop="openRenameFileDialog(node.key)"
                    aria-label="Rename file"
                  />
                  <Button 
                    icon="pi pi-trash" 
                    class="p-button-text p-button-sm p-button-danger" 
                    @click.stop="openDeleteFileDialog(node.key)"
                    aria-label="Delete file"
                  />
                </template>
              </div>
            </div>
          </template>
        </Tree>
        <div class="add-folder-container">
        <Button 
          icon="pi pi-plus" 
          label="Add Folder" 
          severity='primary'
          class="p-button-sm add-folder-btn" 
          @click="openAddFolderDialog"
        />
      </div>
      </div>
      
    
  


      <!-- Modal dialogs for CRUD operations -->
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
          <Button label="Cancel" icon="pi pi-times" class="p-button-text" @click="closeDialog('addFolder')" />
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
          <Button label="Cancel" icon="pi pi-times" class="p-button-text" @click="closeDialog('addFile')" />
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
          <Button label="Cancel" icon="pi pi-times" class="p-button-text" @click="closeDialog('renameFolder')" />
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
          <Button label="Cancel" icon="pi pi-times" class="p-button-text" @click="closeDialog('renameFile')" />
          <Button label="Save" icon="pi pi-check" @click="confirmRenameFile" autofocus />
        </template>
      </Dialog>
  
      <!-- Confirmation dialog -->
      <ConfirmDialog />
    </div>
  </template>
  
  <script setup>
  import { ref, computed, reactive } from 'vue'
  import Tree from 'primevue/tree'
  import Button from 'primevue/button'
  import Dialog from 'primevue/dialog'
  import InputText from 'primevue/inputtext'
  import ConfirmDialog from 'primevue/confirmdialog'
  import { useConfirm } from 'primevue/useconfirm'
  import { useSidebarStore } from '@/stores/sidebar'
  
  const store = useSidebarStore()
  const confirm = useConfirm()
  const emit = defineEmits(['file-selected'])
  
  // Dialog state management
  const dialogState = reactive({
    addFolder: {
      visible: false,
      title: 'Add New Folder',
      name: ''
    },
    addFile: {
      visible: false,
      title: 'Add New File',
      folderId: null,
      name: ''
    },
    renameFolder: {
      visible: false,
      title: 'Rename Folder',
      id: null,
      name: ''
    },
    renameFile: {
      visible: false,
      title: 'Rename File',
      id: null,
      name: ''
    }
  })
  
  // Tree nodes
  const nodes = computed(() =>
    store.folders.map(folder => ({
      key: String(folder.id),
      label: folder.name,
      children: folder.files.map(file => ({
        key: `${folder.id}__${file.id}`,
        label: file.name,
        leaf: true
      }))
    }))
  )
  
  // Selection handling
  const selectionKeys = computed({
    get() {
      if (!store.selectedFile) return null
      const { folderId, fileId } = store.selectedFile
      return `${folderId}__${fileId}`
    },
    set(val) {
      let key
      if (val == null) {
        key = null
      } else if (typeof val === 'object') {
        const keys = Object.keys(val)
        if (!keys.length) return
        key = keys[0]
      } else {
        key = String(val)
      }
  
      // only react to actual file keys
      if (!key || !key.includes('__')) return
  
      const [folderId, fileId] = key.split('__').map(Number)
      console.log('📁 clicked file:', { folderId, fileId })
      store.selectFile(folderId, fileId)
      emit('file-selected', fileId)
    }
  })
  
  // Dialog management functions
  function closeDialog(type) {
    dialogState[type].visible = false
    dialogState[type].name = ''
    if (type === 'addFile') {
      dialogState[type].folderId = null
    }
    if (type === 'renameFolder' || type === 'renameFile') {
      dialogState[type].id = null
    }
  }
  
  // Add folder
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
  
  // Add file
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
  
  // Rename folder
  function openRenameFolderDialog(key) {
    const id = Number(key)
    const folder = store.folders.find(x => x.id === id)
    
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
  
  // Rename file
  function openRenameFileDialog(compositeKey) {
    const [, fileIdStr] = compositeKey.split('__')
    const fileId = Number(fileIdStr)
    
    let fileName = ''
    for (const folder of store.folders) {
      const file = folder.files.find(x => x.id === fileId)
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
  
  // Delete folder
  function openDeleteFolderDialog(key) {
    const id = Number(key)
    const folder = store.folders.find(x => x.id === id)
    
    if (folder) {
      confirm.require({
        message: `Are you sure you want to delete the folder "${folder.name}" and all its files?`,
        header: 'Delete Folder',
        icon: 'pi pi-exclamation-triangle',
        acceptClass: 'p-button-danger',
        accept: () => {
          store.deleteFolder(id)
        }
      })
    }
  }
  
  // Delete file
  function openDeleteFileDialog(compositeKey) {
    const [, fileIdStr] = compositeKey.split('__')
    const fileId = Number(fileIdStr)
    
    let fileName = ''
    let file = null
    
    for (const folder of store.folders) {
      file = folder.files.find(x => x.id === fileId)
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
        accept: () => {
          store.deleteFile(fileId)
        }
      })
    }
  }
  </script>
  
  <style scoped>
 .sidebar-nav {
  width: 100%;
  display: flex;
  flex-direction: column;
  background-color: var(--primary-color);        /* PrimeVue primary */
  border-radius: 0.5rem;                          /* soften edges */
  padding: 0.5rem;
  box-shadow:
    /* main drop shadow */
    0 4px 8px rgba(0, 0, 0, 0.2),
    /* subtle uplight for 3D feel */
    0 -2px 6px rgba(255, 255, 255, 0.2);
  transform: translateZ(0);                       /* create a new stacking context */
  transition:
    box-shadow 0.3s ease,
    transform 0.3s ease,
    background-color 0.3s ease,
    scale 1.5s ease;
 
}

/* On hover, “lift” it up and deepen the shadow */
.sidebar-nav:hover {
  transform: translateY(-4px);
  box-shadow:
    0 16px 32px rgba(0, 0, 0, 0.15),
    0 -8px 16px rgba(255, 255, 255, 0.1);
  background-color: var(--primary-dark);         /* darker shade on hover */
 scale: 1.1;
 transform: translateZ(50)
}

/* If you want each nav item to pop out slightly on hover */
.sidebar-nav .p-menuitem {
  transition: transform 0.2s ease, background-color 0.2s ease;
}

.sidebar-nav .p-menuitem:hover {
  transform: translateX(4px);
  background-color: var(--primary-light);        /* lighter shade on item hover */
}
  
  .sidebar-title {
    font-weight: 600;
    color: #495057;
    padding: 0.75rem 1rem;
    margin: 0;
  }

  .tree-wrapper {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
  }
  
  .folder-tree {
    border: none;
    background: transparent;
    padding: 0;
  }
  
  /* Remove default PrimeVue tree styling */
  .folder-tree :deep(.p-tree) {
    padding: 0;
    border: none;
  }
  
  .folder-tree :deep(.p-treenode) {
    padding: 0;
  }
  
  .folder-tree :deep(.p-treenode-content) {
    padding: 0.35rem 0.5rem;
    border-radius: 0;
    transition: background-color 0.2s;
  }
  
  .folder-tree :deep(.p-treenode-content:hover) {
    background-color: var(--surface-b);
  }
  
  .folder-tree :deep(.p-treenode-content.p-highlight) {
    background-color: var(--surface-b) ;
  }
  
  .folder-tree :deep(.p-tree-toggler) {
    margin-right: 0.25rem;
  }


  .node-content {
    display: flex;
    align-items: center;
    width: 100%;
    margin-right: 0.75rem;
  }
  
  .node-icon {
    margin-right: 0.5rem;
 
    color: #6c757d;
  }
  
  .node-label {
    flex: 1;
 
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  
  .action-buttons {
    display: none;
    align-items: center;
  }
  
  .node-content:hover .action-buttons {
    display: flex;
  }
  
  .action-buttons .p-button {
    padding: 0.25rem;
    width: 1.5rem;
    height: 1.5rem;
    margin-left: 0.2rem;
  }
  
 
  
  .add-folder-container {
    margin-top: 1rem;
    padding: 0.75rem 1rem;

  }
  
  .add-folder-btn {
    width: 100%;
 
    display: flex;
    align-items: center;
    justify-content: center;
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