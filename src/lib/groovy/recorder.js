// Optional audio capture for a take.
//
// The timing data is the point of a take; the audio is there for when the
// numbers say you dragged bar 7 and you want to hear what you actually played.
// It rides on the input stream that is already open, so arming it costs nothing
// until you press record.

import { currentStream } from './input'

export class TakeRecorder {
  constructor() {
    this._rec = null
    this._chunks = []
    this.mimeType = ''
  }

  get recording() {
    return !!this._rec && this._rec.state === 'recording'
  }

  static get supported() {
    return typeof window !== 'undefined' && !!window.MediaRecorder
  }

  start() {
    if (this.recording) return false
    const stream = currentStream()
    if (!stream || !TakeRecorder.supported) return false
    const preferred = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
    this.mimeType = preferred.find((t) => window.MediaRecorder.isTypeSupported?.(t)) || ''
    this._chunks = []
    this._rec = new MediaRecorder(stream, this.mimeType ? { mimeType: this.mimeType } : undefined)
    this._rec.ondataavailable = (e) => {
      if (e.data?.size) this._chunks.push(e.data)
    }
    this._rec.start()
    return true
  }

  // Resolves with the recorded Blob, or null if nothing was captured.
  stop() {
    return new Promise((resolve) => {
      const rec = this._rec
      if (!rec || rec.state !== 'recording') {
        resolve(null)
        return
      }
      rec.onstop = () => {
        const blob = this._chunks.length
          ? new Blob(this._chunks, { type: this.mimeType || 'audio/webm' })
          : null
        this._chunks = []
        this._rec = null
        resolve(blob)
      }
      rec.stop()
    })
  }

  cancel() {
    if (this._rec && this._rec.state === 'recording') {
      this._rec.onstop = null
      try {
        this._rec.stop()
      } catch {
        /* already stopping */
      }
    }
    this._chunks = []
    this._rec = null
  }
}

export function takeExtension(mimeType) {
  if (!mimeType) return 'webm'
  if (mimeType.includes('mp4')) return 'm4a'
  if (mimeType.includes('ogg')) return 'ogg'
  return 'webm'
}
