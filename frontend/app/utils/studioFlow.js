// Product Studio 流程状态（纯函数，workspace 与测试共用）
// 流程：สินค้า → เทมเพลต → ตั้งค่า → บท → สร้าง → ส่งออก

export const STUDIO_STEPS = ['product', 'template', 'settings', 'script', 'render', 'export']
export const STUDIO_IMAGE_KINDS = ['packshot', 'lifestyle', 'on_model', 'banner']
export const STUDIO_DURATION_MIN = 10
export const STUDIO_DURATION_MAX = 60
export const SCRIPT_POLL_INTERVAL_MS = 2000 // scripting
export const RENDER_POLL_INTERVAL_MS = 3000 // keyframes / videos

/** ภาษาที่ไม่เว้นวรรคระหว่างคำ (นับตัวอักษรแทนคำ) */
export const NO_SPACE_LANGUAGES = ['th', 'zh', 'ja', 'ko']

export function isScripting(status) {
  return status === 'scripting'
}

export function isStepDone(step, detail) {
  if (!detail) return false
  const shots = detail.shots || []
  switch (step) {
    case 'product': return !!(detail.productName || detail.productUrl)
    case 'template': return !!detail.templateId
    case 'settings': return !!(detail.language && detail.market && detail.platform && detail.durationSec)
    case 'script': return shots.length > 0
    case 'render': return shots.some(s => s.videoStatus === 'completed')
    case 'export': return detail.latestMerge?.status === 'completed'
    default: return false
  }
}

/** 打开 workspace 时默认落在哪一步：第一个未完成步骤（export 只在 render 完成后有意义） */
export function nextIncompleteStep(detail) {
  if (!detail) return 'product'
  for (const step of STUDIO_STEPS) {
    if (step === 'export') continue
    if (!isStepDone(step, detail)) return step
  }
  return 'export'
}

/** ความยาว 10–60 วินาที และห้ามเกิน ceiling ของแพลตฟอร์ม */
export function clampStudioDuration(n, maxDurationSec = STUDIO_DURATION_MAX) {
  const ceiling = Math.min(STUDIO_DURATION_MAX, Number(maxDurationSec) > 0 ? Number(maxDurationSec) : STUDIO_DURATION_MAX)
  const v = Math.round(Number(n))
  if (!Number.isFinite(v)) return Math.max(STUDIO_DURATION_MIN, 20)
  return Math.min(ceiling, Math.max(STUDIO_DURATION_MIN, v))
}

/** เวลาพูดโดยประมาณ: ภาษาเว้นวรรค ~2.5 คำ/วินาที · ไทย/จีน/ญี่ปุ่น/เกาหลี ~4.5 ตัวอักษร/วินาที */
export function speechSeconds(text, language) {
  const t = String(text || '').trim()
  if (!t) return 0
  if (NO_SPACE_LANGUAGES.includes(String(language || ''))) return t.length / 4.5
  const words = t.split(/\s+/).filter(Boolean).length
  return words / 2.5
}

/** บทพูดยาวเกินเวลาช็อตไหม (เผื่อ 15% ให้จังหวะพูดจริง) */
export function dialogueTooLong(text, language, durationSec) {
  const limit = Number(durationSec) || 0
  if (limit <= 0) return false
  return speechSeconds(text, language) > limit * 1.15
}

/** แท่ง timeline beat สัดส่วนตามวินาที (width/start เป็น %) */
export function beatBars(template) {
  const beats = template?.beats || []
  const total = beats.reduce((s, b) => s + (Number(b.seconds) || 0), 0)
  if (!total) return []
  let acc = 0
  return beats.map((b) => {
    const seconds = Number(b.seconds) || 0
    const start = (acc / total) * 100
    acc += seconds
    return { role: b.role, seconds, width: (seconds / total) * 100, start }
  })
}

/** เลือก platform → ตั้ง aspect ตาม defaultAspect และหน่วงความยาวไม่เกิน maxDurationSec */
export function applyPlatformDefaults(detail, platformOption) {
  if (!detail || !platformOption) return detail
  return {
    ...detail,
    platform: platformOption.id,
    aspectRatio: platformOption.defaultAspect || detail.aspectRatio,
    durationSec: clampStudioDuration(detail.durationSec, platformOption.maxDurationSec),
  }
}

/** จาก errorMsg หารหัสเสถียร (เช่น E_STUDIO_NEEDS_SCRIPT) */
export function studioErrorCodeOf(text) {
  const m = String(text || '').match(/\bE_[A-Z0-9_]+\b/)
  return m ? m[0] : ''
}
