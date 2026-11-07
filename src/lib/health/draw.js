import { ref, watch, onBeforeUnmount } from 'vue'

// Hand-built SVG helpers shared by the stress, body and workout panels.

// Width / height of an element in CSS px, kept current by a ResizeObserver, so an
// SVG can be drawn in real pixels (crisp text and hairlines, no stretched viewBox).
export function useSize(elRef) {
  const w = ref(0)
  const h = ref(0)
  let ro
  // The element may mount later (behind a v-if), so follow the ref rather than onMounted.
  watch(
    elRef,
    (el) => {
      ro?.disconnect()
      if (!el) return
      w.value = el.clientWidth
      h.value = el.clientHeight
      ro = new ResizeObserver(([e]) => {
        w.value = e.contentRect.width
        h.value = e.contentRect.height
      })
      ro.observe(el)
    },
    { immediate: true, flush: 'post' },
  )
  onBeforeUnmount(() => ro?.disconnect())
  return { w, h }
}

// "Nice" tick values covering [lo, hi] in about `count` steps (1, 2, 5 × 10ⁿ).
export function niceTicks(lo, hi, count = 4) {
  if (!(hi > lo)) return [lo]
  const raw = (hi - lo) / count
  const e = Math.floor(Math.log10(raw))
  const f = raw / 10 ** e
  const step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * 10 ** e
  const out = []
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(+v.toFixed(10))
  return out
}

const f2 = (n) => n.toFixed(2)

// Straight segments; a gap larger than `gap` (in x units) starts a new subpath.
export function linePath(pts, gap = Infinity) {
  let d = ''
  let prev = null
  for (const [x, y] of pts) {
    d += `${prev && x - prev > gap ? 'M' : prev == null ? 'M' : 'L'}${f2(x)},${f2(y)} `
    prev = x
  }
  return d.trim()
}

// Monotone cubic through the points (no overshoot between readings).
export function smoothPath(pts) {
  const n = pts.length
  if (n < 3) return linePath(pts)
  const dx = []
  const m = []
  for (let i = 0; i < n - 1; i++) {
    dx[i] = pts[i + 1][0] - pts[i][0] || 1e-6
    m[i] = (pts[i + 1][1] - pts[i][1]) / dx[i]
  }
  const t = [m[0]]
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2
  t[n - 1] = m[n - 2]
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) t[i] = t[i + 1] = 0
    else {
      const a = t[i] / m[i]
      const b = t[i + 1] / m[i]
      const s = a * a + b * b
      if (s > 9) {
        const k = 3 / Math.sqrt(s)
        t[i] = k * a * m[i]
        t[i + 1] = k * b * m[i]
      }
    }
  }
  let d = `M${f2(pts[0][0])},${f2(pts[0][1])}`
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3
    d += ` C${f2(pts[i][0] + h)},${f2(pts[i][1] + t[i] * h)} ${f2(pts[i + 1][0] - h)},${f2(pts[i + 1][1] - t[i + 1] * h)} ${f2(pts[i + 1][0])},${f2(pts[i + 1][1])}`
  }
  return d
}

// Index of the point whose x is closest to `x` (pts sorted by x).
export function nearest(xs, x) {
  let lo = 0
  let hi = xs.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (xs[mid] < x) lo = mid
    else hi = mid
  }
  return Math.abs(xs[lo] - x) <= Math.abs(xs[hi] - x) ? lo : hi
}

export const pace = (secPerKm) => {
  if (!secPerKm) return '–'
  const s = Math.round(secPerKm)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
