// Unsloth (local) provider — pure helpers shared by settings + Studio + tests
// ค่าอ้างอิงจาก docs/unsloth/PLAN.md ข้อ 1 (วัดจาก server จริง 2026-10-04)

export const UNSLOTH_PROVIDER = 'unsloth'

/** ค่าเริ่มต้นของ video settings ตาม PLAN ข้อ 3 (ทั้งหมด optional ฝั่ง backend) */
export const UNSLOTH_VIDEO_DEFAULTS = {
  gguf_filename: 'minimax_h3_fl2va_pruned-Q8_0.gguf',
  steps: 20,
  quality: 'standard',
  max_concurrent: 1,
  queue_timeout_minutes: 240,
}

/**
 * base URL ของ provider local ควรเป็น loopback/private network เท่านั้น
 * (PLAN ข้อ 4 — production ชี้ http://127.0.0.1:8888 ปิดพอร์ตจากภายนอก)
 * คืน true เมื่อเป็น localhost/loopback/private IPv4/.local ฯลฯ · parse ไม่ได้ = false (ให้เตือน)
 */
export function isLocalOrPrivateBaseUrl(url) {
  let u
  try {
    u = new URL(String(url || '').trim())
  } catch {
    return false
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host === '::1' || host.endsWith('.localhost')) return true
  if (host.endsWith('.local') || host.endsWith('.lan') || host.endsWith('.internal') || host.endsWith('.home')) return true
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])]
    if (a === 127 || a === 10) return true
    if (a === 192 && b === 168) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 169 && b === 254) return true
    return false
  }
  return false
}

/** เวลาสร้างโดยประมาณทั้งโปรเจกต์ (วินาที) = จำนวนช็อต × เวลาต่อคลิป ของ provider ที่ active */
export function estimateRenderSeconds(shotCount, perClipSeconds) {
  const n = Math.max(0, Math.round(Number(shotCount) || 0))
  const per = Number(perClipSeconds) || 0
  if (!n || !per) return 0
  return Math.round(n * per)
}

/** นาที (ปัดขึ้น) สำหรับแสดงใน UI · คืน 0 เมื่อไม่รู้ค่า per-clip */
export function estimateRenderMinutes(shotCount, perClipSeconds) {
  const s = estimateRenderSeconds(shotCount, perClipSeconds)
  return s ? Math.ceil(s / 60) : 0
}

/** ช็อตที่สั้นกว่าขั้นต่ำของโมเดลวิดีโอ (เช่น H3 ≥ 5.17s) — backend จะรวม beat ให้เอง */
export function shotsBelowMinDuration(shots, minDurationSec) {
  const min = Number(minDurationSec) || 0
  if (!min) return []
  return (shots || []).filter(s => Number(s.durationSec) > 0 && Number(s.durationSec) < min)
}
