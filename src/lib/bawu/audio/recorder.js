// Take recorder: MediaRecorder over the shared mic stream. Takes live in memory
// only — the caller offers a download; nothing persists.

import { acquireMic, releaseMic } from './mic'

export class TakeRecorder {
  constructor() {
    this._rec = null
    this._chunks = []
    this.mimeType = ''
  }

  get recording() {
    return !!this._rec && this._rec.state === 'recording'
  }

  async start() {
    if (this.recording) return
    const stream = await acquireMic()
    const preferred = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
    this.mimeType = preferred.find((t) => window.MediaRecorder?.isTypeSupported?.(t)) || ''
    this._chunks = []
    this._rec = new MediaRecorder(stream, this.mimeType ? { mimeType: this.mimeType } : undefined)
    this._rec.ondataavailable = (e) => { if (e.data?.size) this._chunks.push(e.data) }
    this._rec.start()
  }

  // Resolves with the recorded Blob (or null if nothing was captured).
  stop() {
    return new Promise((resolve) => {
      const rec = this._rec
      if (!rec || rec.state !== 'recording') { resolve(null); return }
      rec.onstop = () => {
        const blob = this._chunks.length
          ? new Blob(this._chunks, { type: this.mimeType || 'audio/webm' })
          : null
        this._chunks = []
        this._rec = null
        releaseMic()
        resolve(blob)
      }
      rec.stop()
    })
  }
}

export function takeExtension(mimeType) {
  if (!mimeType) return 'webm'
  if (mimeType.includes('mp4')) return 'm4a'
  if (mimeType.includes('ogg')) return 'ogg'
  return 'webm'
}
