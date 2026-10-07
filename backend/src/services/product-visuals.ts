/**
 * Product image prompt builder — ใช้ร่วมกันระหว่าง AI Marketer (campaign_visuals)
 * และ Product Studio (studio_images)
 * ย้ายมาจาก services/marketer.ts ตาม docs/product-studio/PLAN.md ข้อ 2 —
 * output ของ buildVisualPrompt/visualSizeFor ต้องเหมือนเดิมทุกตัวอักษร (มี snapshot test กัน)
 */

export const VISUAL_KINDS = ['packshot', 'on_model', 'lifestyle'] as const
export type VisualKind = typeof VISUAL_KINDS[number]

// Product Studio เพิ่ม kind banner (ภาพแบนเนอร์แนวนอน/ตาม platform)
export const STUDIO_IMAGE_KINDS = [...VISUAL_KINDS, 'banner'] as const
export type StudioImageKind = typeof STUDIO_IMAGE_KINDS[number]

/** prompt template ต่อ kind (อังกฤษ) — ทุกแบบย้ำ "keep the exact product design" */
export function buildVisualPrompt(kind: VisualKind | 'banner', instruction: string | null): string {
  const keep = 'Keep the exact product design, label, text layout, colors and proportions from the reference image — the product must stay recognizable as the same item.'
  const extra = instruction ? ` Additional direction from the user: ${instruction}.` : ''
  if (kind === 'packshot') {
    return `Professional e-commerce packshot photograph of the exact product shown in the reference image, on a pure white seamless background, even studio lighting, centered composition, sharp focus, subtle soft shadow. No props, no people, no added text or graphics. ${keep}${extra}`
  }
  if (kind === 'on_model') {
    return `Advertising photograph of a person naturally holding or using the exact product shown in the reference image, product clearly visible, well-lit and unaltered, believable hands and posture. ${keep}${extra}`
  }
  if (kind === 'banner') {
    return `Wide promotional banner photograph featuring the exact product shown in the reference image as the hero item, clean composition with negative space for copy, soft studio lighting. No added text or graphics. ${keep}${extra}`
  }
  return `Lifestyle advertising photograph of the exact product shown in the reference image in a realistic usage context, product sharp and clearly visible in the foreground. ${keep}${extra}`
}

/** ขนาดภาพ: packshot สี่เหลี่ยมจัตุรัสเสมอ; อื่นตาม aspectRatio (9:16 default) */
export function visualSizeFor(aspectRatio: string | null, kind: VisualKind): string {
  if (kind === 'packshot') return '1024x1024'
  if (aspectRatio === '16:9') return '1820x1024'
  if (aspectRatio === '1:1') return '1024x1024'
  return '1024x1820' // 9:16 default
}
