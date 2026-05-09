<template>
  <div class="modal-backdrop" @click.self="requestClose">
    <div class="modal scanner-modal">
      <div class="modal-head">
        <span class="modal-title">{{ phaseTitle }}</span>
        <button class="modal-close" @click="requestClose" :disabled="saving || processing">
          <i class="pi pi-times" style="font-size: 0.875rem;"></i>
        </button>
      </div>

      <div class="modal-body scanner-body">
        <div v-if="phase === 'live'" class="phase phase-live">
          <div v-if="cameraError" class="cam-fallback">
            <i class="pi pi-exclamation-triangle" style="font-size: 2rem; color: var(--text-faint);"></i>
            <div class="cam-fallback-msg">{{ cameraError }}</div>
            <label class="add-btn">
              <i class="pi pi-image" style="font-size: 0.875rem;"></i>
              Choose image instead
              <input type="file" accept="image/*" capture="environment" @change="onFilePicked" hidden />
            </label>
          </div>

          <div v-else class="cam-stage">
            <div class="cam-frame">
              <video ref="videoEl" class="cam-video" autoplay playsinline muted></video>
              <svg
                v-if="videoIntrinsic.w > 0 && videoIntrinsic.h > 0"
                class="detect-overlay"
                :viewBox="`0 0 ${videoIntrinsic.w} ${videoIntrinsic.h}`"
                preserveAspectRatio="none"
              >
                <polygon
                  v-if="overlayPoints"
                  :points="overlayPoints"
                  class="detect-poly"
                />
              </svg>
            </div>

            <div v-if="!cameraReady" class="cam-loading">
              <i class="pi pi-spin pi-spinner" style="font-size: 2rem;"></i>
              <span>Starting camera…</span>
            </div>

            <div v-if="!cvReady && cameraReady" class="status-pill">
              <i class="pi pi-spin pi-spinner" style="font-size: 0.75rem;"></i>
              Preparing scanner…
            </div>

            <div v-if="processing" class="cam-loading">
              <i class="pi pi-spin pi-spinner" style="font-size: 2rem;"></i>
              <span>Processing…</span>
            </div>
          </div>
        </div>

        <div v-else-if="phase === 'save'" class="phase phase-save">
          <div v-if="capturedCorners === null" class="info-inline">
            <i class="pi pi-info-circle" style="font-size: 0.8125rem;"></i>
            Couldn't auto-detect document edges — using the raw frame.
          </div>

          <div class="filter-row">
            <button
              v-for="f in FILTERS"
              :key="f.id"
              class="filter-chip"
              :class="{ active: filter === f.id }"
              @click="setFilter(f.id)"
              :disabled="processing"
              type="button"
            >{{ f.label }}</button>
          </div>

          <div class="save-toolbar">
            <button class="tool-btn" @click="rotate(-90)" :disabled="processing" title="Rotate left">
              <i class="pi pi-undo" style="font-size: 0.875rem;"></i>
            </button>
            <button class="tool-btn" @click="rotate(90)" :disabled="processing" title="Rotate right">
              <i class="pi pi-refresh" style="font-size: 0.875rem;"></i>
            </button>
          </div>

          <div class="save-preview">
            <canvas ref="finalCanvas" class="final-canvas"></canvas>
            <div v-if="processing" class="preview-overlay">
              <i class="pi pi-spin pi-spinner" style="font-size: 1.5rem;"></i>
              <span>Applying filter…</span>
            </div>
          </div>

          <div class="field">
            <label>Name</label>
            <input
              type="text"
              class="sel"
              v-model="form.name"
              placeholder="Document name"
              @keydown.enter="saveDocument"
            />
          </div>

          <div class="field">
            <label>Folder</label>
            <select class="sel" v-model="form.folder_id">
              <option :value="null">All Documents (root)</option>
              <option
                v-for="f in folderOptions"
                :key="f.id"
                :value="f.id"
              >{{ f.label }}</option>
            </select>
          </div>

          <div v-if="saveError" class="save-error">
            <i class="pi pi-exclamation-circle" style="font-size: 0.875rem;"></i>
            {{ saveError }}
          </div>
        </div>
      </div>

      <div class="modal-foot scanner-foot">
        <template v-if="phase === 'live'">
          <button class="btn-ghost" @click="requestClose">Cancel</button>
          <div style="flex:1;"></div>
          <button
            class="add-btn capture-btn"
            @click="capture"
            :disabled="!cameraReady || cameraError || processing"
          >
            <i class="pi pi-camera" style="font-size: 0.9375rem;"></i>
            Capture
          </button>
        </template>

        <template v-else-if="phase === 'save'">
          <button class="btn-ghost" @click="retake" :disabled="saving || processing">
            <i class="pi pi-refresh" style="font-size: 0.8125rem; margin-right: 0.375rem;"></i>
            Retake
          </button>
          <div style="flex:1;"></div>
          <button class="add-btn" @click="saveDocument" :disabled="saving || processing || !form.name.trim()">
            <i v-if="saving" class="pi pi-spin pi-spinner" style="font-size: 0.875rem;"></i>
            <i v-else class="pi pi-check" style="font-size: 0.875rem;"></i>
            {{ saving ? 'Saving…' : 'Save document' }}
          </button>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import dayjs from 'dayjs'
import { useDocumentsStore } from '@/stores/documents'

const props = defineProps({
  initialFolderId: { type: String, default: null },
})
const emit = defineEmits(['close', 'saved'])

const store = useDocumentsStore()

const FILTERS = [
  { id: 'scan',     label: 'Scan' },
  { id: 'bw',       label: 'B&W' },
  { id: 'color',    label: 'Color' },
  { id: 'original', label: 'Original' },
]

const DETECT_DOWNSCALE = 640
const DETECT_INTERVAL_MS = 150

const phase = ref('live')
const videoEl = ref(null)
const finalCanvas = ref(null)

const cameraReady = ref(false)
const cameraError = ref('')
const cvReady = ref(false)
const processing = ref(false)
const saving = ref(false)
const saveError = ref('')

const videoIntrinsic = ref({ w: 0, h: 0 })
const detectedCorners = ref(null)
const detectScale = ref(1)
const detectFrameSize = ref({ w: 0, h: 0 })
const capturedCorners = ref(null)

let stream = null
let detectTimer = null
let detectInFlight = false
let capturedImageData = null
let processedImageData = null
let cvReadyPromise = null

const rotation = ref(0)

const detectCanvas = document.createElement('canvas')
const detectCtx = detectCanvas.getContext('2d', { willReadFrequently: true })
const fullCanvas = document.createElement('canvas')
const fullCtx = fullCanvas.getContext('2d', { willReadFrequently: true })

const filter = ref('scan')

const form = ref({
  name: defaultName(),
  folder_id: props.initialFolderId || null,
})

let worker = null
const pendingMessages = new Map()

const phaseTitle = computed(() => phase.value === 'live' ? 'Scan Document' : 'Save Document')

const overlayPoints = computed(() => {
  const c = detectedCorners.value
  if (!c) return null
  const inv = 1 / detectScale.value
  return [c.tl, c.tr, c.br, c.bl]
    .map(p => `${(p.x * inv).toFixed(1)},${(p.y * inv).toFixed(1)}`)
    .join(' ')
})

const folderOptions = computed(() => {
  const out = []
  const walk = (parentId, depth) => {
    for (const f of store.folderChildren(parentId)) {
      out.push({
        id: f.id,
        label: `${'  '.repeat(depth)}${depth > 0 ? '↳ ' : ''}${f.name}`,
      })
      walk(f.id, depth + 1)
    }
  }
  walk(null, 0)
  return out
})

function defaultName() {
  return `Scan ${dayjs().format('YYYY-MM-DD HH:mm')}`
}

onMounted(() => {
  console.log('[modal] onMounted')
  ensureWorker()
  console.log('[modal] sending preload')
  cvReadyPromise = postWithId('preload', {})
    .then(() => {
      console.log('[modal] preload resolved — flipping cvReady to true')
      cvReady.value = true
    })
    .catch((e) => {
      console.error('[modal] preload rejected:', e)
    })
  startCamera()
})

onBeforeUnmount(() => {
  stopDetectLoop()
  stopCamera()
  if (worker) {
    worker.terminate()
    worker = null
  }
  pendingMessages.clear()
})

function ensureWorker() {
  if (worker) return worker
  console.log('[modal] creating worker')
  worker = new Worker(
    new URL('./scannerWorker.js', import.meta.url),
    { type: 'classic' },
  )
  worker.addEventListener('message', (e) => {
    console.log('[modal] worker message received:', e.data)
    const { id, ok, error, ...rest } = e.data
    const handler = pendingMessages.get(id)
    if (!handler) {
      console.warn('[modal] no handler found for id', id, 'pending ids:', [...pendingMessages.keys()])
      return
    }
    pendingMessages.delete(id)
    if (ok) handler.resolve(rest)
    else handler.reject(new Error(error || 'Worker error'))
  })
  worker.addEventListener('error', (e) => {
    console.error('[modal] worker error event:', e.message, e)
    for (const [id, h] of pendingMessages) {
      pendingMessages.delete(id)
      h.reject(new Error(e.message || 'Worker crashed'))
    }
  })
  worker.addEventListener('messageerror', (e) => {
    console.error('[modal] worker messageerror event:', e)
  })
  console.log('[modal] worker created')
  return worker
}

function postWithId(action, payload, transferable = []) {
  const w = ensureWorker()
  const id = `${Date.now()}-${Math.random()}`
  console.log('[modal] posting to worker:', action, 'id:', id)
  return new Promise((resolve, reject) => {
    pendingMessages.set(id, { resolve, reject })
    w.postMessage({ id, action, ...payload }, transferable)
  })
}

async function startCamera() {
  cameraError.value = ''
  cameraReady.value = false
  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Camera API not available in this browser.')
    }
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 3840 },
        height: { ideal: 2160 },
      },
      audio: false,
    })
    await nextTick()
    if (videoEl.value) {
      videoEl.value.srcObject = stream
      await new Promise(resolve => {
        if (videoEl.value.readyState >= 2) resolve()
        else videoEl.value.onloadedmetadata = () => resolve()
      })
      await videoEl.value.play().catch(() => {})
      videoIntrinsic.value = {
        w: videoEl.value.videoWidth,
        h: videoEl.value.videoHeight,
      }
      cameraReady.value = true
      startDetectLoop()
    }
  } catch (e) {
    console.warn('[Scanner] camera unavailable:', e)
    cameraError.value = e.message?.includes('Permission')
      ? 'Camera permission was denied. You can pick an image instead.'
      : 'Camera not available on this device. Pick an image instead.'
  }
}

function stopCamera() {
  stopDetectLoop()
  if (stream) {
    for (const track of stream.getTracks()) track.stop()
    stream = null
  }
  if (videoEl.value) videoEl.value.srcObject = null
  cameraReady.value = false
}

function startDetectLoop() {
  if (detectTimer) return
  detectTimer = setInterval(tickDetect, DETECT_INTERVAL_MS)
}

function stopDetectLoop() {
  if (detectTimer) {
    clearInterval(detectTimer)
    detectTimer = null
  }
}

async function tickDetect() {
  if (!cvReady.value || !cameraReady.value || detectInFlight) return
  if (phase.value !== 'live') return
  const v = videoEl.value
  if (!v || !v.videoWidth || !v.videoHeight) return

  const longSide = Math.max(v.videoWidth, v.videoHeight)
  const scale = longSide > DETECT_DOWNSCALE ? DETECT_DOWNSCALE / longSide : 1
  const dw = Math.round(v.videoWidth * scale)
  const dh = Math.round(v.videoHeight * scale)
  if (detectCanvas.width !== dw || detectCanvas.height !== dh) {
    detectCanvas.width = dw
    detectCanvas.height = dh
  }
  detectCtx.drawImage(v, 0, 0, dw, dh)
  const imageData = detectCtx.getImageData(0, 0, dw, dh)

  detectInFlight = true
  try {
    const { corners } = await postWithId('detect', { imageData }, [imageData.data.buffer])
    detectedCorners.value = corners
    detectScale.value = scale
    detectFrameSize.value = { w: dw, h: dh }
  } catch {
    detectedCorners.value = null
  } finally {
    detectInFlight = false
  }
}

async function capture() {
  if (!videoEl.value || !cameraReady.value || processing.value) return
  stopDetectLoop()

  let drewStill = false
  if (typeof ImageCapture !== 'undefined' && stream) {
    try {
      const track = stream.getVideoTracks()[0]
      const ic = new ImageCapture(track)
      let opts
      try {
        const caps = await ic.getPhotoCapabilities()
        if (caps.imageWidth?.max && caps.imageHeight?.max) {
          opts = { imageWidth: caps.imageWidth.max, imageHeight: caps.imageHeight.max }
        }
      } catch { /* photoCapabilities unsupported — fall through */ }
      const blob = await ic.takePhoto(opts)
      const bitmap = await createImageBitmap(blob)
      fullCanvas.width = bitmap.width
      fullCanvas.height = bitmap.height
      fullCtx.drawImage(bitmap, 0, 0)
      bitmap.close?.()
      drewStill = true
      console.log('[Scanner] captured via ImageCapture:', bitmap.width, 'x', bitmap.height)
    } catch (e) {
      console.warn('[Scanner] ImageCapture failed, falling back to video frame:', e)
    }
  }

  if (!drewStill) {
    const v = videoEl.value
    fullCanvas.width = v.videoWidth
    fullCanvas.height = v.videoHeight
    fullCtx.drawImage(v, 0, 0)
    console.log('[Scanner] captured via video frame:', v.videoWidth, 'x', v.videoHeight)
  }

  capturedImageData = fullCtx.getImageData(0, 0, fullCanvas.width, fullCanvas.height)

  const ds = detectFrameSize.value
  if (detectedCorners.value && ds.w && ds.h) {
    const xf = fullCanvas.width / ds.w
    const yf = fullCanvas.height / ds.h
    const c = detectedCorners.value
    capturedCorners.value = {
      tl: { x: c.tl.x * xf, y: c.tl.y * yf },
      tr: { x: c.tr.x * xf, y: c.tr.y * yf },
      br: { x: c.br.x * xf, y: c.br.y * yf },
      bl: { x: c.bl.x * xf, y: c.bl.y * yf },
    }
  } else {
    capturedCorners.value = null
  }

  stopCamera()
  await goToSave()
}

async function onFilePicked(event) {
  const file = event.target.files?.[0]
  if (!file) return
  const url = URL.createObjectURL(file)
  try {
    const img = await loadImage(url)
    fullCanvas.width = img.naturalWidth
    fullCanvas.height = img.naturalHeight
    fullCtx.drawImage(img, 0, 0)
    capturedImageData = fullCtx.getImageData(0, 0, img.naturalWidth, img.naturalHeight)

    if (cvReadyPromise) await cvReadyPromise
    capturedCorners.value = await detectOnImage(img)
    stopCamera()
    await goToSave()
  } catch (e) {
    console.warn('[Scanner] file pick failed:', e)
    cameraError.value = 'Failed to load that image.'
  } finally {
    URL.revokeObjectURL(url)
  }
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Image load failed'))
    img.src = src
  })
}

async function detectOnImage(img) {
  const longSide = Math.max(img.naturalWidth, img.naturalHeight)
  const scale = longSide > DETECT_DOWNSCALE ? DETECT_DOWNSCALE / longSide : 1
  const dw = Math.round(img.naturalWidth * scale)
  const dh = Math.round(img.naturalHeight * scale)
  detectCanvas.width = dw
  detectCanvas.height = dh
  detectCtx.drawImage(img, 0, 0, dw, dh)
  const imageData = detectCtx.getImageData(0, 0, dw, dh)
  try {
    const { corners } = await postWithId('detect', { imageData }, [imageData.data.buffer])
    if (!corners) return null
    const inv = 1 / scale
    return {
      tl: { x: corners.tl.x * inv, y: corners.tl.y * inv },
      tr: { x: corners.tr.x * inv, y: corners.tr.y * inv },
      br: { x: corners.br.x * inv, y: corners.br.y * inv },
      bl: { x: corners.bl.x * inv, y: corners.bl.y * inv },
    }
  } catch {
    return null
  }
}

async function goToSave() {
  if (cvReadyPromise) await cvReadyPromise
  phase.value = 'save'
  await nextTick()
  await processAndDraw()
}

async function processAndDraw() {
  if (!capturedImageData) return
  processing.value = true
  saveError.value = ''
  try {
    const copy = new ImageData(
      new Uint8ClampedArray(capturedImageData.data),
      capturedImageData.width,
      capturedImageData.height,
    )
    const c = capturedCorners.value
    const plainCorners = c ? {
      tl: { x: c.tl.x, y: c.tl.y },
      tr: { x: c.tr.x, y: c.tr.y },
      br: { x: c.br.x, y: c.br.y },
      bl: { x: c.bl.x, y: c.bl.y },
    } : null
    const { imageData } = await postWithId(
      'process',
      { imageData: copy, corners: plainCorners, filter: filter.value },
      [copy.data.buffer],
    )
    processedImageData = imageData
    drawProcessedToFinalCanvas()
  } catch (e) {
    console.warn('[Scanner] processing failed:', e)
    saveError.value = `Processing failed: ${e.message}`
  } finally {
    processing.value = false
  }
}

function drawProcessedToFinalCanvas() {
  if (!processedImageData || !finalCanvas.value) return
  const r = rotation.value
  const swap = r === 90 || r === 270
  const sw = processedImageData.width
  const sh = processedImageData.height
  const w = swap ? sh : sw
  const h = swap ? sw : sh
  const cnv = finalCanvas.value
  cnv.width = w
  cnv.height = h
  const ctx = cnv.getContext('2d')
  if (r === 0) {
    ctx.putImageData(processedImageData, 0, 0)
    return
  }
  const temp = document.createElement('canvas')
  temp.width = sw
  temp.height = sh
  temp.getContext('2d').putImageData(processedImageData, 0, 0)
  ctx.save()
  ctx.translate(w / 2, h / 2)
  ctx.rotate((r * Math.PI) / 180)
  ctx.drawImage(temp, -sw / 2, -sh / 2)
  ctx.restore()
}

function rotate(delta) {
  if (processing.value) return
  rotation.value = ((rotation.value + delta) % 360 + 360) % 360
  drawProcessedToFinalCanvas()
}

async function setFilter(id) {
  if (filter.value === id || processing.value) return
  filter.value = id
  await processAndDraw()
}

async function retake() {
  capturedImageData = null
  processedImageData = null
  capturedCorners.value = null
  rotation.value = 0
  filter.value = 'scan'
  phase.value = 'live'
  await startCamera()
}

async function saveDocument() {
  if (!form.value.name.trim() || saving.value || processing.value) return
  if (!finalCanvas.value) return
  saving.value = true
  saveError.value = ''
  try {
    const blob = await new Promise((resolve, reject) => {
      finalCanvas.value.toBlob(
        b => (b ? resolve(b) : reject(new Error('Failed to encode image'))),
        'image/jpeg',
        0.92,
      )
    })
    await store.uploadDocument({
      blob,
      name: form.value.name.trim(),
      folder_id: form.value.folder_id,
    })
    emit('saved')
    emit('close')
  } catch (e) {
    saveError.value = e.message || 'Failed to save'
  } finally {
    saving.value = false
  }
}

function requestClose() {
  if (saving.value || processing.value) return
  stopCamera()
  emit('close')
}
</script>

<style scoped>
.scanner-modal {
  width: 40rem;
  max-width: calc(100vw - 1.5rem);
}

.scanner-body {
  padding: 1.25rem 1.5rem;
  gap: 1rem;
}

.phase {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  min-height: 18rem;
}

.cam-stage {
  position: relative;
  background: #000;
  border-radius: 0.75rem;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 18rem;
}

.cam-frame {
  position: relative;
  display: inline-block;
  line-height: 0;
  max-width: 100%;
  max-height: 60vh;
}

.cam-video {
  display: block;
  max-width: 100%;
  max-height: 60vh;
  width: auto;
  height: auto;
  background: #000;
}

.detect-overlay {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  overflow: visible;
}
.detect-poly {
  fill: oklch(0.56 0.18 295 / 0.18);
  stroke: oklch(0.68 0.16 295);
  stroke-width: 3;
  vector-effect: non-scaling-stroke;
  transition: opacity 120ms;
}

.cam-loading {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  color: #fff;
  background: rgba(0, 0, 0, 0.55);
  font-size: 0.875rem;
  border-radius: 0.75rem;
  pointer-events: none;
}

.status-pill {
  position: absolute;
  top: 0.75rem;
  left: 50%;
  transform: translateX(-50%);
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.375rem 0.875rem;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  font-size: 0.75rem;
  font-weight: 500;
  pointer-events: none;
}

.cam-fallback {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  padding: 3rem 1.5rem;
  background: var(--bg-sunken, #f3f2f0);
  border-radius: 0.75rem;
  text-align: center;
  min-height: 18rem;
}
.cam-fallback-msg {
  font-size: 0.9375rem;
  color: var(--text-dim, #5c5c5c);
  max-width: 22rem;
  line-height: 1.45;
}
.cam-fallback .add-btn {
  cursor: pointer;
}

.info-inline {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  border-radius: 0.5rem;
  background: oklch(0.96 0.06 65);
  color: oklch(0.45 0.16 65);
  font-size: 0.8125rem;
}

.filter-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.filter-chip {
  padding: 0.4rem 0.875rem;
  border-radius: 999px;
  border: 1px solid var(--border, #e5e4e1);
  background: #fff;
  color: var(--text-dim, #5c5c5c);
  font-size: 0.8125rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 120ms;
}
.filter-chip:hover:not(:disabled) {
  border-color: oklch(0.68 0.14 295);
  color: var(--text, #1a1a1a);
}
.filter-chip.active {
  background: oklch(0.56 0.18 295);
  border-color: oklch(0.56 0.18 295);
  color: #fff;
}
.filter-chip:disabled { opacity: 0.55; cursor: not-allowed; }

.save-toolbar {
  display: flex;
  align-items: center;
  gap: 0.375rem;
}

.tool-btn {
  height: 2.25rem;
  padding: 0 0.75rem;
  border-radius: 0.5rem;
  border: 1px solid var(--border, #e5e4e1);
  background: #fff;
  color: var(--text-dim, #5c5c5c);
  font-size: 0.8125rem;
  font-weight: 500;
  display: inline-flex;
  align-items: center;
  cursor: pointer;
  transition: all 120ms;
}
.tool-btn:hover:not(:disabled) {
  border-color: var(--text-faint, #9a9a9a);
  background: var(--bg-sunken, #f3f2f0);
  color: var(--text, #1a1a1a);
}
.tool-btn:disabled { opacity: 0.55; cursor: not-allowed; }

.save-preview {
  position: relative;
  background: var(--bg-sunken, #f3f2f0);
  border-radius: 0.5rem;
  padding: 0.625rem;
  display: flex;
  justify-content: center;
}
.final-canvas {
  max-width: 100%;
  max-height: 50vh;
  display: block;
  background: #fff;
  border-radius: 0.375rem;
  box-shadow: 0 0.125rem 0.5rem rgba(0, 0, 0, 0.12);
}
.preview-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  color: #fff;
  background: rgba(0, 0, 0, 0.5);
  border-radius: 0.5rem;
  font-size: 0.8125rem;
  pointer-events: none;
}

.phase-save .field {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}
.phase-save .field > label {
  font-size: 0.6875rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-faint, #9a9a9a);
  font-weight: 600;
}
.sel {
  border: 1px solid var(--border, #e5e4e1);
  border-radius: 0.5rem;
  padding: 0.5625rem 1rem;
  height: 2.5rem;
  font-size: 0.875rem;
  background: #fff;
  outline: none;
  font-family: inherit;
  color: inherit;
}
.sel:focus {
  border-color: oklch(0.68 0.14 295);
  box-shadow: 0 0 0 3px oklch(0.96 0.025 295);
}

.save-error {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.625rem 0.875rem;
  border-radius: 0.5rem;
  background: #fff0f0;
  color: #c33;
  font-size: 0.8125rem;
}

.scanner-foot {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  padding: 1rem 1.5rem;
  border-top: 1px solid var(--border-soft, #eeede9);
}

.capture-btn { min-width: 8rem; }

.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.modal {
  --accent-hue: 295;
  --accent-500: oklch(0.56 0.18 var(--accent-hue));
  --accent-600: oklch(0.5 0.18 var(--accent-hue));
  --accent-100: oklch(0.96 0.025 var(--accent-hue));
  background: #fff;
  border-radius: 1rem;
  box-shadow: 0 0.5rem 1.875rem rgba(0, 0, 0, 0.18);
  display: flex;
  flex-direction: column;
  max-height: calc(100vh - 1.5rem);
  overflow: hidden;
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Helvetica, Arial, sans-serif;
}
.modal-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1.125rem 1.5rem;
  border-bottom: 1px solid var(--border-soft, #eeede9);
}
.modal-title { font-size: 1.125rem; font-weight: 700; }
.modal-close {
  width: 2rem;
  height: 2rem;
  border-radius: 0.5rem;
  border: none;
  background: none;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-faint, #9a9a9a);
  cursor: pointer;
}
.modal-close:hover {
  background: var(--bg-sunken, #f3f2f0);
  color: var(--text, #1a1a1a);
}

.modal-body {
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}

.add-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  background: var(--accent-500);
  color: #fff;
  padding: 0.625rem 1.5rem;
  height: 2.625rem;
  border-radius: 0.625rem;
  border: none;
  font-size: 0.9375rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 120ms;
  white-space: nowrap;
}
.add-btn:hover:not(:disabled) { background: var(--accent-600); }
.add-btn:disabled { opacity: 0.55; cursor: not-allowed; }

.btn-ghost {
  padding: 0.5625rem 1.25rem;
  height: 2.5rem;
  border-radius: 0.625rem;
  font-size: 0.875rem;
  color: var(--text-dim, #5c5c5c);
  border: 1px solid var(--border, #e5e4e1);
  background: #fff;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  font-weight: 500;
}
.btn-ghost:hover:not(:disabled) {
  border-color: var(--text-faint, #9a9a9a);
  color: var(--text, #1a1a1a);
  background: var(--bg-sunken, #f3f2f0);
}
.btn-ghost:disabled { opacity: 0.55; cursor: not-allowed; }

@media (max-width: 36em) {
  .scanner-foot { flex-wrap: wrap; }
  .scanner-foot .add-btn,
  .scanner-foot .btn-ghost { flex: 1; }
}
</style>
