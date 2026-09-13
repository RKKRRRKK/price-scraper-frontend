// The microphone is opened once and shared by the pitch tracker and the take
// recorder, so the browser only prompts once per session and the two can run at
// the same time. Reference-counted: the stream shuts down when the last user
// lets go.

let micStream = null
let micUsers = 0

export async function acquireMic() {
  if (!micStream) {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    })
  }
  micUsers++
  return micStream
}

export function releaseMic() {
  micUsers = Math.max(0, micUsers - 1)
  if (micUsers === 0 && micStream) {
    micStream.getTracks().forEach((t) => t.stop())
    micStream = null
  }
}
