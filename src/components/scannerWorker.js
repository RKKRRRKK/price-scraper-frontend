/* eslint-disable no-restricted-globals */
const OPENCV_URL = 'https://docs.opencv.org/4.10.0/opencv.js'

console.log('[worker] script start, location:', self.location?.href)

self.addEventListener('error', (e) => {
  console.error('[worker] global error event:', e.message, 'at', e.filename, ':', e.lineno, ':', e.colno, 'error:', e.error)
})
self.addEventListener('unhandledrejection', (e) => {
  console.error('[worker] unhandled rejection:', e.reason)
})

const cvReady = new Promise((resolve, reject) => {
  let resolved = false
  const finish = (instance, source) => {
    console.log('[worker] finish() entered, source:', source, 'already resolved?', resolved)
    if (resolved) return
    resolved = true
    self.cv = instance
    console.log('[worker] cv ready via', source, '— has Mat:', !!instance?.Mat)
    // IMPORTANT: do NOT pass `instance` to resolve — Emscripten Module objects
    // are thenable, which makes `await cvReady` recurse into Module.then() and hang.
    resolve(true)
  }

  self.Module = {
    onRuntimeInitialized() {
      console.log('[worker] Module.onRuntimeInitialized fired. typeof cv:', typeof self.cv, 'cv has Mat:', !!(self.cv && self.cv.Mat), 'Module has Mat:', !!self.Module.Mat)
      const ready = (self.cv && self.cv.Mat) ? self.cv : self.Module
      finish(ready, 'onRuntimeInitialized')
    },
  }

  console.log('[worker] importing opencv.js…')
  const t0 = Date.now()
  try {
    self.importScripts(OPENCV_URL)
    console.log('[worker] importScripts returned in', Date.now() - t0, 'ms. typeof cv:', typeof self.cv, 'typeof Module:', typeof self.Module)
    if (typeof self.cv !== 'undefined') {
      console.log('[worker] cv keys sample:', Object.keys(self.cv).slice(0, 10))
    }
  } catch (e) {
    console.error('[worker] importScripts threw:', e)
    reject(e)
    return
  }

  if (typeof self.cv === 'function') {
    console.log('[worker] cv is a function — calling cv() to instantiate')
    Promise.resolve(self.cv()).then((inst) => finish(inst, 'cv() factory')).catch(reject)
    return
  }

  if (self.cv && self.cv.Mat) {
    finish(self.cv, 'sync (cv.Mat present after importScripts)')
    return
  }

  console.log('[worker] waiting for runtime init (no synchronous resolution path matched)')

  setTimeout(() => {
    if (!resolved) {
      const err = `OpenCV.js initialization timeout (typeof cv = ${typeof self.cv}, has Mat = ${!!(self.cv && self.cv.Mat)}, has Module.Mat = ${!!(self.Module && self.Module.Mat)})`
      console.error('[worker]', err)
      reject(new Error(err))
    }
  }, 30000)
})

function ensureCv() {
  return cvReady
}

console.log('[worker] registering onmessage handler')

function decodeCvError(e) {
  if (typeof e === 'number' && cv?.exceptionFromPtr) {
    try {
      const exc = cv.exceptionFromPtr(e)
      return new Error(`OpenCV: ${exc.msg || exc.what?.() || 'unknown'}`)
    } catch {
      return new Error(`OpenCV exception ptr: ${e}`)
    }
  }
  if (e instanceof Error) return e
  return new Error(typeof e === 'string' ? e : JSON.stringify(e))
}

self.onmessage = async (e) => {
  const { id, action, imageData, corners, filter } = e.data
  console.log('[worker] onmessage:', action, 'id:', id)
  try {
    await ensureCv()
    if (action === 'preload') {
      self.postMessage({ id, ok: true })
      return
    }
    if (action === 'detect') {
      const result = detectQuad(imageData)
      self.postMessage({ id, ok: true, corners: result })
      return
    }
    if (action === 'process') {
      console.log('[worker] process: image', imageData?.width, 'x', imageData?.height, 'filter:', filter, 'corners:', corners)
      const out = processCapture(imageData, corners, filter)
      console.log('[worker] process produced output:', out.width, 'x', out.height)
      self.postMessage({ id, ok: true, imageData: out }, [out.data.buffer])
      return
    }
    throw new Error(`Unknown action: ${action}`)
  } catch (err) {
    const decoded = decodeCvError(err)
    console.error('[worker] error in onmessage (action=' + action + '):', decoded, 'raw:', err)
    self.postMessage({ id, ok: false, error: decoded.message })
  }
}

console.log('[worker] onmessage handler registered')

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function detectQuad(imageData) {
  const src = cv.matFromImageData(imageData)
  const gray = new cv.Mat()
  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY)
  const blur = new cv.Mat()
  cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0)
  const edges = new cv.Mat()
  cv.Canny(blur, edges, 75, 200)

  const contours = new cv.MatVector()
  const hier = new cv.Mat()
  cv.findContours(edges, contours, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)

  const minArea = 0.15 * src.cols * src.rows
  let bestArea = 0
  let bestCorners = null
  for (let i = 0; i < contours.size(); i++) {
    const c = contours.get(i)
    const peri = cv.arcLength(c, true)
    const approx = new cv.Mat()
    cv.approxPolyDP(c, approx, 0.02 * peri, true)
    if (approx.rows === 4) {
      const area = Math.abs(cv.contourArea(approx))
      if (area > bestArea && area > minArea) {
        bestArea = area
        bestCorners = approxToPoints(approx)
      }
    }
    approx.delete()
    c.delete()
  }

  src.delete()
  gray.delete()
  blur.delete()
  edges.delete()
  contours.delete()
  hier.delete()

  if (!bestCorners) return null
  return orderCorners(bestCorners)
}

function approxToPoints(approx) {
  const pts = []
  for (let i = 0; i < 4; i++) {
    pts.push({ x: approx.data32S[i * 2], y: approx.data32S[i * 2 + 1] })
  }
  return pts
}

function orderCorners(pts) {
  let tl = pts[0], tr = pts[0], br = pts[0], bl = pts[0]
  let minSum = Infinity, maxSum = -Infinity, minDiff = Infinity, maxDiff = -Infinity
  for (const p of pts) {
    const sum = p.x + p.y
    const diff = p.y - p.x
    if (sum < minSum) { minSum = sum; tl = p }
    if (sum > maxSum) { maxSum = sum; br = p }
    if (diff < minDiff) { minDiff = diff; tr = p }
    if (diff > maxDiff) { maxDiff = diff; bl = p }
  }
  return { tl, tr, br, bl }
}

function processCapture(imageData, corners, filter) {
  console.log('[worker] processCapture: matFromImageData…')
  const src = cv.matFromImageData(imageData)
  console.log('[worker] processCapture: src is', src.cols, 'x', src.rows, 'channels:', src.channels())
  let working = src
  let warped = null
  if (corners && filter !== 'original') {
    console.log('[worker] processCapture: warping with corners', corners)
    warped = warpToFlat(src, corners)
    working = warped
    console.log('[worker] processCapture: warped is', warped.cols, 'x', warped.rows)
  } else {
    console.log('[worker] processCapture: skipping warp (corners=', !!corners, 'filter=', filter, ')')
  }

  console.log('[worker] processCapture: applying filter', filter)
  let out
  if (filter === 'scan') {
    out = applyScan(working)
  } else if (filter === 'bw') {
    out = applyBw(working)
  } else {
    out = matToImageData(working)
  }
  console.log('[worker] processCapture: filter applied, out:', out.width, 'x', out.height)

  src.delete()
  if (warped) warped.delete()
  return out
}

function warpToFlat(src, corners) {
  const widthTop = distance(corners.tl, corners.tr)
  const widthBottom = distance(corners.bl, corners.br)
  const heightLeft = distance(corners.tl, corners.bl)
  const heightRight = distance(corners.tr, corners.br)
  const w = Math.max(1, Math.round(Math.max(widthTop, widthBottom)))
  const h = Math.max(1, Math.round(Math.max(heightLeft, heightRight)))
  const dsize = new cv.Size(w, h)
  const srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
    corners.tl.x, corners.tl.y,
    corners.tr.x, corners.tr.y,
    corners.bl.x, corners.bl.y,
    corners.br.x, corners.br.y,
  ])
  const dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
    0, 0,
    w, 0,
    0, h,
    w, h,
  ])
  const M = cv.getPerspectiveTransform(srcTri, dstTri)
  const warped = new cv.Mat()
  cv.warpPerspective(src, warped, M, dsize, cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar())
  srcTri.delete()
  dstTri.delete()
  M.delete()
  return warped
}

// "Scan" filter: divide the image by an estimate of its local background.
// Whitens uneven lighting and shadows while preserving letter grays — no
// binary holes in thick strokes (which adaptiveThreshold would punch out).
function applyScan(mat) {
  const gray = new cv.Mat()
  cv.cvtColor(mat, gray, cv.COLOR_RGBA2GRAY)

  // Background estimate: downscale 4×, blur, upscale. Equivalent to a much
  // larger Gaussian on the original but ~16× cheaper.
  const small = new cv.Mat()
  cv.resize(gray, small, new cv.Size(0, 0), 0.25, 0.25, cv.INTER_AREA)
  let k = Math.round(Math.min(small.cols, small.rows) * 0.1)
  if (k < 15) k = 15
  if (k % 2 === 0) k += 1
  const blurred = new cv.Mat()
  cv.GaussianBlur(small, blurred, new cv.Size(k, k), 0)
  const bg = new cv.Mat()
  cv.resize(blurred, bg, new cv.Size(gray.cols, gray.rows), 0, 0, cv.INTER_LINEAR)

  const grayF = new cv.Mat()
  const bgF = new cv.Mat()
  gray.convertTo(grayF, cv.CV_32F)
  bg.convertTo(bgF, cv.CV_32F)
  const ratio = new cv.Mat()
  cv.divide(grayF, bgF, ratio, 255)
  const result = new cv.Mat()
  ratio.convertTo(result, cv.CV_8U)

  // Mild contrast curve so text reads slightly darker without crushing.
  const boosted = new cv.Mat()
  result.convertTo(boosted, cv.CV_8U, 1.15, -20)

  const out = matToImageData(boosted)
  gray.delete()
  small.delete()
  blurred.delete()
  bg.delete()
  grayF.delete()
  bgF.delete()
  ratio.delete()
  result.delete()
  boosted.delete()
  return out
}

function applyBw(mat) {
  const gray = new cv.Mat()
  cv.cvtColor(mat, gray, cv.COLOR_RGBA2GRAY)
  const out = matToImageData(gray)
  gray.delete()
  return out
}

function matToImageData(mat) {
  let rgba = mat
  let temp = null
  if (mat.channels() === 1) {
    temp = new cv.Mat()
    cv.cvtColor(mat, temp, cv.COLOR_GRAY2RGBA)
    rgba = temp
  } else if (mat.channels() === 3) {
    temp = new cv.Mat()
    cv.cvtColor(mat, temp, cv.COLOR_RGB2RGBA)
    rgba = temp
  }
  const out = new ImageData(
    new Uint8ClampedArray(rgba.data),
    rgba.cols,
    rgba.rows,
  )
  if (temp) temp.delete()
  return out
}
