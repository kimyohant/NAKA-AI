/**
 * Viral Clone Studio (สตูดิโอโคลนไวรัล) — logic ล้วน ห้าม import Vue/API ที่นี่
 * สัญญา: docs/viral-clone/PLAN.md §3 (beat ยึดกับคำพูด, matrix cap, error code)
 */

export const CLONE_BEAT_ROLES = ['hook', 'demo', 'proof', 'offer', 'cta']
export const CLONE_VISUALS = ['product', 'avatar', 'broll', 'text']
export const CLONE_LANGUAGES = ['th', 'en']
export const CLONE_MATRIX_CAP = 12
export const CLONE_POLL_INTERVAL_MS = 3000

export function isCloneProjectBusy(status) {
  return status === 'analyzing'
}

export function isCloneVariantBusy(status) {
  return status === 'queued' || status === 'rendering'
}

// error ของงานเก็บเป็น "E_CODE: message" (เหมือน Studio) — ดึงรหัสเพื่อแปลผ่าน errors.codes.*
export function cloneErrorCodeOf(text) {
  if (typeof text !== 'string') return null
  const m = text.match(/E_[A-Z0-9_]+/)
  return m ? m[0] : null
}

// จำนวน variants จาก matrix (Cartesian) — มุมไหนไม่เลือกเลย = ใช้ค่า default ของโปรเจกต์ (นับ 1)
export function matrixVariantCount(matrix) {
  if (!matrix || typeof matrix !== 'object') return 0
  const size = (arr) => (Array.isArray(arr) && arr.length ? arr.length : 1)
  return size(matrix.hookIndexes) * size(matrix.productIds) * size(matrix.avatarIds) * size(matrix.languages)
}

export function matrixOverCap(matrix, cap = CLONE_MATRIX_CAP) {
  return matrixVariantCount(matrix) > cap
}

export function beatsTotalSeconds(blueprint) {
  if (!blueprint || !Array.isArray(blueprint.beats)) return 0
  return blueprint.beats.reduce((sum, b) => sum + (Number.isFinite(b?.durationSec) ? b.durationSec : 0), 0)
}

// hooks สำรองที่ใช้จริงได้ (string ไม่ว่าง)
export function usableHooks(blueprint) {
  if (!blueprint || !Array.isArray(blueprint.hooks)) return []
  return blueprint.hooks.filter((h) => typeof h === 'string' && h.trim().length > 0)
}

// validate ฝั่ง client ก่อน PUT (backend validate อีกชั้น)
export function isValidBlueprint(bp) {
  if (!bp || !Array.isArray(bp.beats) || !bp.beats.length) return false
  if (bp.hooks != null && !Array.isArray(bp.hooks)) return false
  return bp.beats.every((b) =>
    b && typeof b.id === 'string' && b.id.length > 0
    && CLONE_BEAT_ROLES.includes(b.role)
    && typeof b.line === 'string' && b.line.trim().length > 0
    && CLONE_VISUALS.includes(b.visual)
    && Number.isFinite(b.durationSec) && b.durationSec > 0)
}

export function cloneBeatDefaults(id) {
  return { id, role: 'demo', line: '', visual: 'product', visualHint: null, durationSec: 3 }
}

// เทมเพลตเริ่มต้นบนหน้าแรก (รูปแบบเดียวกับตัวอย่างของ Hypit: UGC · พอดแคสต์ · สัมภาษณ์ข้างถนน · จัดอันดับ)
// ข้อความอยู่ใน i18n viralClone.templates.<key>.*; beats ใช้วาดไทม์ไลน์ย่อเท่านั้น
export const CLONE_TEMPLATES = [
  { key: 'ugcReview', beats: [['hook', 3], ['demo', 5], ['proof', 4], ['offer', 3], ['cta', 2]] },
  { key: 'podcast', beats: [['hook', 4], ['proof', 6], ['demo', 5], ['cta', 3]] },
  { key: 'streetInterview', beats: [['hook', 3], ['demo', 4], ['proof', 4], ['offer', 4], ['cta', 3]] },
  { key: 'ranking', beats: [['hook', 3], ['demo', 3], ['demo', 3], ['proof', 4], ['cta', 2]] },
]
