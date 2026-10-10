// The name of a style preset in the UI language (th / en). The stored preset name stays as it is (it is what
// an admin typed, or the seed's original name); this only chooses what to show:
// - built-in presets and the drama art styles: index.styleNames.<value> (app/locales)
// - the Style Gallery (value handraw-<number>): Thai from HANDRAW_STYLE_NAMES_TH, English = the gallery's
//   own name without its number (the number is shown on its own)
// - anything else (presets an admin added): the stored name
import { HANDRAW_STYLE_NAMES_TH } from './handrawStyleNamesTh.js'

const GALLERY_PREFIX = 'handraw-'

/** 'handraw-fa-001' → 'FA-001'; null for presets outside the gallery
 * @param {string | null | undefined} value */
export function galleryNumber(value) {
  const v = String(value || '')
  return v.startsWith(GALLERY_PREFIX) ? v.slice(GALLERY_PREFIX.length).toUpperCase() : null
}

/**
 * @param {{ value?: string | null, name?: string | null }} p
 * @param {{ t: (key: string) => string, te: (key: string) => boolean, locale: string }} i18n
 * @returns {string}
 */
export function styleDisplayName(p, { t, te, locale }) {
  const value = String(p.value || '')
  if (value && te(`index.styleNames.${value}`)) return t(`index.styleNames.${value}`)
  const number = galleryNumber(value)
  if (number) {
    if (locale === 'th' && HANDRAW_STYLE_NAMES_TH[number]) return HANDRAW_STYLE_NAMES_TH[number]
    // stored as 'FA-001 · Playful Deadpan Doodle'
    return String(p.name || '').replace(/^[A-Z]{2}-\d{3}\s*·\s*/, '') || number
  }
  return String(p.name || value)
}
