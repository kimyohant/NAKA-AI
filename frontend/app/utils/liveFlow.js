// AI Live flow helpers (pure, shared by pages/live.vue and tests) — docs/ai-live/PLAN.md

/** Edge TTS Thai voices LiveTalking can use (label = i18n key) */
export const LIVE_VOICES = [
  { id: 'th-TH-PremwadeeNeural', label: 'live.voices.premwadee' },
  { id: 'th-TH-AcharaNeural', label: 'live.voices.achara' },
  { id: 'th-TH-NiwatNeural', label: 'live.voices.niwat' },
]

/** Next line of the host script, or null when the queue ends (loop off). */
export function nextQueueIndex(current, length, loop) {
  if (!length) return null
  const next = current + 1
  if (next < length) return next
  return loop ? 0 : null
}

/**
 * Wait until the avatar has finished the line it was just given.
 * TTS needs a moment before is_speaking turns true, so wait for it to start (up to startMs),
 * then poll until it is quiet again (up to maxMs). keepGoing() → false stops waiting at once.
 */
export async function waitUntilQuiet(isSpeaking, keepGoing, opts = {}) {
  const { pollMs = 700, startMs = 4000, maxMs = 60000, sleep = ms => new Promise(r => setTimeout(r, ms)) } = opts
  let waited = 0
  let started = false
  while (keepGoing() && waited < maxMs) {
    const now = await isSpeaking()
    if (now) started = true
    else if (started || waited >= startMs) return true
    await sleep(pollMs)
    waited += pollMs
  }
  return false
}
