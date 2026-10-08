// Product Studio 流程状态（纯函数，workspace 与测试共用）
// 流程：สินค้า → เทมเพลต → ตั้งค่า → บท → สร้าง → ส่งออก

export const STUDIO_STEPS = ['product', 'template', 'settings', 'script', 'render', 'export']
export const STUDIO_IMAGE_KINDS = ['packshot', 'lifestyle', 'on_model', 'banner']
export const STUDIO_DURATION_MIN = 10
export const STUDIO_DURATION_MAX = 60
export const SCRIPT_POLL_INTERVAL_MS = 2000 // scripting
export const RENDER_POLL_INTERVAL_MS = 3000 // keyframes / videos

/**
 * ภาษาที่ไม่เว้นวรรคระหว่างคำ (นับตัวอักษรแทนคำ) → ตัวอักษร/วินาทีโดยประมาณ
 * ไทยนับสระ/วรรณยุกต์เป็น code unit แยก (~2 ตัวต่อพยางค์ × ~6 พยางค์/วินาที) จึงสูงกว่าจีนมาก
 */
export const CHARS_PER_SECOND = { th: 12, zh: 4.5, ja: 7, ko: 6 }
export const NO_SPACE_LANGUAGES = Object.keys(CHARS_PER_SECOND)

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

/** เวลาพูดโดยประมาณ: ภาษาเว้นวรรค ~2.5 คำ/วินาที · ไทย/จีน/ญี่ปุ่น/เกาหลี ตาม CHARS_PER_SECOND */
export function speechSeconds(text, language) {
  const t = String(text || '').trim()
  if (!t) return 0
  const cps = CHARS_PER_SECOND[String(language || '')]
  if (cps) return t.length / cps
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

// ===== Phase 2: auto-render + captions =====

/** pipeline auto-render กำลังวิ่งไหม (stage ทั้งสามนี้ server ยังทำงานอยู่) */
export const AUTO_RENDER_ACTIVE_STAGES = ['keyframes', 'videos', 'merging']

export function isAutoRenderActive(project) {
  const stage = project?.autoRender?.stage
  return AUTO_RENDER_ACTIVE_STAGES.includes(stage)
}

/** ความคืบหน้า 0–100 ของ stage ปัจจุบัน (done+failed เทียบ total) */
export function autoRenderProgress(project) {
  const ar = project?.autoRender
  if (!ar || !ar.total) return { percent: 0, done: 0, failed: 0, total: 0, stage: ar?.stage || 'idle' }
  const finished = (Number(ar.done) || 0) + (Number(ar.failed) || 0)
  const percent = Math.min(100, Math.round((finished / ar.total) * 100))
  return { percent, done: Number(ar.done) || 0, failed: Number(ar.failed) || 0, total: Number(ar.total) || 0, stage: ar.stage }
}

/** ข้อความซับของช็อต: dialogue ก่อน ไม่งั้น onScreenText ไม่งั้น null (ตามกติกา PHASE2 ข้อ 2) */
export function captionSourceOf(shot) {
  const dialogue = String(shot?.dialogue || '').trim()
  if (dialogue) return 'dialogue'
  const ost = String(shot?.onScreenText || '').trim()
  if (ost) return 'onScreenText'
  return null
}

/** ช็อตที่จะไม่มีซับ (ไม่มีทั้ง dialogue และ onScreenText) */
export function shotsWithoutCaptions(shots) {
  return (shots || []).filter(s => !captionSourceOf(s))
}
