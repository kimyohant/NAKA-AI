// Studio art: static preview images under public/studio-art (generated with Qwen-Image 2.1, see
// public/studio-art/README.md). Pure path builders, shared by components and tests.
//   templates/<templateId>/<variant>.webp           480x840  (one per product category)
//   skills/<librarySkillId>/{still,clay}.webp        480x480  (film still + 3D clay icon)
//   covers/{template-category,skill-category,agent}/<id>.webp  960x548

export const STUDIO_ART_ROOT = '/studio-art'
export const TEMPLATE_ART_VARIANTS = ['beauty', 'food', 'fashion', 'gadget', 'home', 'health']
export const TEMPLATE_ART_IDS = [
  'ugc_review', 'unboxing', 'before_after', 'problem_solution', 'how_to_use', 'three_reasons',
  'comparison', 'try_on', 'creator_story', 'lifestyle_showcase', 'asmr_closeup', 'flash_deal',
]
export const COVER_KINDS = ['template-category', 'skill-category', 'agent']

const safeId = id => typeof id === 'string' && /^[a-z0-9_-]+(\/[a-z0-9_-]+)*$/i.test(id)

/** All variant images of a template, or [] for a template without art (card falls back to its icon). */
export function templateArt(templateId) {
  if (!TEMPLATE_ART_IDS.includes(templateId)) return []
  return TEMPLATE_ART_VARIANTS.map(v => `${STUDIO_ART_ROOT}/templates/${templateId}/${v}.webp`)
}

/** Film still and 3D clay icon for a library skill id such as "storyboard-breaker/eyeline-axis". */
export function skillArt(skillId) {
  if (!safeId(skillId)) return null
  const base = `${STUDIO_ART_ROOT}/skills/${skillId}`
  return { still: `${base}/still.webp`, clay: `${base}/clay.webp` }
}

/** Example image of a visual style preset (style_presets.value, e.g. "ghibli", "live-kdrama").
 *  Custom styles have no file; callers keep their gradient card when the image fails to load. */
export function styleExample(styleValue) {
  if (!safeId(styleValue) || styleValue.includes('/')) return ''
  return `${STUDIO_ART_ROOT}/styles/${styleValue}.webp`
}

/** Section banner: coverArt('agent', 'extractor'), coverArt('template-category', 'promo') … */
export function coverArt(kind, id) {
  if (!COVER_KINDS.includes(kind) || !safeId(id) || id.includes('/')) return ''
  return `${STUDIO_ART_ROOT}/covers/${kind}/${id}.webp`
}
