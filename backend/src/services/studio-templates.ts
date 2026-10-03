/**
 * Product Studio — Creative Gallery templates + global options (docs/product-studio/PLAN.md ข้อ 3-4)
 * ชื่อ/คำอธิบายเทมเพลตแสดงผลใน i18n ฝั่ง frontend (productStudio.templates.<id>.*)
 * **beat role strings ต้องตรงกับที่ frontend แปลผ่าน productStudio.templates.<id>.beats.<role>** (ดู Notes from Agent B)
 * — เทมเพลตทั้งหมดออกแบบเอง ห้ามคัดลอกจากผู้ให้บริการภายนอก
 */

export type StudioLanguage = 'th' | 'en' | 'id' | 'vi' | 'ms' | 'fil' | 'zh' | 'ja' | 'ko' | 'es' | 'pt' | 'ar'
export type StudioMarket = 'TH' | 'SG' | 'MY' | 'ID' | 'VN' | 'PH' | 'US' | 'UK' | 'EU' | 'JP' | 'KR' | 'CN' | 'LATAM' | 'MENA' | 'GLOBAL'
export type StudioPlatform = 'tiktok' | 'tiktok_shop' | 'shopee' | 'lazada' | 'facebook' | 'instagram_reels' | 'youtube_shorts' | 'amazon'
export type StudioAspectRatio = '9:16' | '1:1' | '16:9'

export const STUDIO_LANGUAGES: StudioLanguage[] = ['th', 'en', 'id', 'vi', 'ms', 'fil', 'zh', 'ja', 'ko', 'es', 'pt', 'ar']

export const STUDIO_MARKETS: { id: StudioMarket; currency: string; defaultLanguage: StudioLanguage }[] = [
  { id: 'TH', currency: 'THB', defaultLanguage: 'th' },
  { id: 'SG', currency: 'SGD', defaultLanguage: 'en' },
  { id: 'MY', currency: 'MYR', defaultLanguage: 'ms' },
  { id: 'ID', currency: 'IDR', defaultLanguage: 'id' },
  { id: 'VN', currency: 'VND', defaultLanguage: 'vi' },
  { id: 'PH', currency: 'PHP', defaultLanguage: 'fil' },
  { id: 'US', currency: 'USD', defaultLanguage: 'en' },
  { id: 'UK', currency: 'GBP', defaultLanguage: 'en' },
  { id: 'EU', currency: 'EUR', defaultLanguage: 'en' },
  { id: 'JP', currency: 'JPY', defaultLanguage: 'ja' },
  { id: 'KR', currency: 'KRW', defaultLanguage: 'ko' },
  { id: 'CN', currency: 'CNY', defaultLanguage: 'zh' },
  { id: 'LATAM', currency: 'USD', defaultLanguage: 'es' },
  { id: 'MENA', currency: 'USD', defaultLanguage: 'ar' },
  { id: 'GLOBAL', currency: 'USD', defaultLanguage: 'en' },
]

export const STUDIO_PLATFORMS: { id: StudioPlatform; defaultAspect: StudioAspectRatio; maxDurationSec: number }[] = [
  { id: 'tiktok', defaultAspect: '9:16', maxDurationSec: 60 },
  { id: 'tiktok_shop', defaultAspect: '9:16', maxDurationSec: 60 },
  { id: 'shopee', defaultAspect: '9:16', maxDurationSec: 60 },
  { id: 'lazada', defaultAspect: '9:16', maxDurationSec: 60 },
  { id: 'facebook', defaultAspect: '1:1', maxDurationSec: 60 },
  { id: 'instagram_reels', defaultAspect: '9:16', maxDurationSec: 60 },
  { id: 'youtube_shorts', defaultAspect: '9:16', maxDurationSec: 60 },
  { id: 'amazon', defaultAspect: '16:9', maxDurationSec: 60 },
]

export type StudioTemplateCategory = 'review' | 'demo' | 'fashion_beauty' | 'showcase' | 'promo'
export type StudioAvatarMode = 'required' | 'optional' | 'hands' | 'none'

export interface StudioTemplateBeat {
  /** role string ตรงกับ i18n key ฝั่ง frontend — ห้ามเปลี่ยนเอง ต้อง sync กับ Agent B */
  role: string
  seconds: number
}

export interface StudioTemplate {
  id: string
  category: StudioTemplateCategory
  avatarMode: StudioAvatarMode
  hasDialogue: boolean
  defaultDurationSec: number
  platforms: StudioPlatform[]
  beats: StudioTemplateBeat[]
}

export const STUDIO_TEMPLATES: StudioTemplate[] = [
  {
    id: 'ugc_review', category: 'review', avatarMode: 'required', hasDialogue: true, defaultDurationSec: 24,
    platforms: ['tiktok', 'tiktok_shop', 'shopee', 'instagram_reels'],
    beats: [
      { role: 'hook', seconds: 3 },
      { role: 'problem', seconds: 5 },
      { role: 'use_product', seconds: 8 },
      { role: 'result', seconds: 5 },
      { role: 'cta', seconds: 3 },
    ],
  },
  {
    id: 'unboxing', category: 'review', avatarMode: 'hands', hasDialogue: true, defaultDurationSec: 23,
    platforms: ['tiktok', 'shopee', 'lazada', 'youtube_shorts'],
    beats: [
      { role: 'hook', seconds: 3 },
      { role: 'unbox', seconds: 6 },
      { role: 'reveal', seconds: 5 },
      { role: 'details', seconds: 6 },
      { role: 'cta', seconds: 3 },
    ],
  },
  {
    id: 'before_after', category: 'demo', avatarMode: 'optional', hasDialogue: true, defaultDurationSec: 21,
    platforms: ['tiktok', 'instagram_reels', 'facebook'],
    beats: [
      { role: 'hook', seconds: 4 },
      { role: 'during', seconds: 8 },
      { role: 'after', seconds: 6 },
      { role: 'cta', seconds: 3 },
    ],
  },
  {
    id: 'problem_solution', category: 'demo', avatarMode: 'optional', hasDialogue: true, defaultDurationSec: 20,
    platforms: ['tiktok', 'shopee', 'lazada', 'facebook'],
    beats: [
      { role: 'problem', seconds: 5 },
      { role: 'intro', seconds: 4 },
      { role: 'solve', seconds: 8 },
      { role: 'cta', seconds: 3 },
    ],
  },
  {
    id: 'how_to_use', category: 'demo', avatarMode: 'hands', hasDialogue: true, defaultDurationSec: 21,
    platforms: ['tiktok', 'youtube_shorts', 'shopee'],
    beats: [
      { role: 'hook', seconds: 3 },
      { role: 'step1', seconds: 5 },
      { role: 'step2', seconds: 5 },
      { role: 'step3', seconds: 5 },
      { role: 'cta', seconds: 3 },
    ],
  },
  {
    id: 'three_reasons', category: 'review', avatarMode: 'required', hasDialogue: true, defaultDurationSec: 21,
    platforms: ['tiktok', 'tiktok_shop', 'instagram_reels'],
    beats: [
      { role: 'hook', seconds: 3 },
      { role: 'reason1', seconds: 5 },
      { role: 'reason2', seconds: 5 },
      { role: 'reason3', seconds: 5 },
      { role: 'cta', seconds: 3 },
    ],
  },
  {
    // comparison: โชว์จุดต่างเชิงหมวด ไม่เอ่ยชื่อ — ห้ามใส่ชื่อแบรนด์คู่แข่งในบท
    id: 'comparison', category: 'demo', avatarMode: 'optional', hasDialogue: true, defaultDurationSec: 20,
    platforms: ['tiktok', 'youtube_shorts', 'facebook'],
    beats: [
      { role: 'hook', seconds: 3 },
      { role: 'generic', seconds: 6 },
      { role: 'ours', seconds: 8 },
      { role: 'cta', seconds: 3 },
    ],
  },
  {
    id: 'try_on', category: 'fashion_beauty', avatarMode: 'required', hasDialogue: true, defaultDurationSec: 20,
    platforms: ['tiktok', 'instagram_reels', 'shopee'],
    beats: [
      { role: 'hook', seconds: 3 },
      { role: 'try', seconds: 8 },
      { role: 'show', seconds: 6 },
      { role: 'cta', seconds: 3 },
    ],
  },
  {
    // creator_story: เล่าในมุม "รีวิวจาก creator" — ห้ามอ้างว่าเป็นลูกค้าจริง/รีวิวจริง
    id: 'creator_story', category: 'review', avatarMode: 'required', hasDialogue: true, defaultDurationSec: 20,
    platforms: ['tiktok', 'facebook', 'youtube_shorts'],
    beats: [
      { role: 'story', seconds: 6 },
      { role: 'turning_point', seconds: 6 },
      { role: 'result', seconds: 5 },
      { role: 'cta', seconds: 3 },
    ],
  },
  {
    id: 'lifestyle_showcase', category: 'showcase', avatarMode: 'none', hasDialogue: true, defaultDurationSec: 19,
    platforms: ['instagram_reels', 'youtube_shorts', 'facebook'],
    beats: [
      { role: 'scene1', seconds: 5 },
      { role: 'scene2', seconds: 5 },
      { role: 'scene3', seconds: 5 },
      { role: 'packshot', seconds: 4 },
    ],
  },
  {
    // asmr_closeup: ไม่มีบทพูด — เน้นเสียงประกอบการใช้งานจากโมเดลวิดีโอ
    id: 'asmr_closeup', category: 'showcase', avatarMode: 'hands', hasDialogue: false, defaultDurationSec: 19,
    platforms: ['tiktok', 'youtube_shorts'],
    beats: [
      { role: 'macro', seconds: 4 },
      { role: 'texture', seconds: 5 },
      { role: 'sound', seconds: 6 },
      { role: 'packshot', seconds: 4 },
    ],
  },
  {
    id: 'flash_deal', category: 'promo', avatarMode: 'required', hasDialogue: true, defaultDurationSec: 17,
    platforms: ['tiktok_shop', 'shopee', 'lazada'],
    beats: [
      { role: 'hook', seconds: 3 },
      { role: 'show', seconds: 6 },
      { role: 'offer', seconds: 5 },
      { role: 'cta', seconds: 3 },
    ],
  },
]

export function getStudioTemplate(id: string): StudioTemplate | null {
  return STUDIO_TEMPLATES.find(t => t.id === id) ?? null
}

/** ผลรวมวินาทีของ beats */
export function templateDurationSec(beats: StudioTemplateBeat[]): number {
  return beats.reduce((sum, beat) => sum + beat.seconds, 0)
}

/** ความยาวสูงสุดต่อช็อตที่โมเดลวิดีโอรองรับ (Seedance/Wan ≤ 15 วินาทีต่องาน) */
export const MAX_SHOT_SECONDS = 15
const MIN_SHOT_SECONDS = 2

/**
 * สเกล beats ตาม durationSec ที่ผู้ใช้เลือก (deterministic):
 * - แปรสัดรวมเป็นวินาทีเต็มแบบ largest-remainder · **ผลรวม = durationSec เสมอ**
 * - แต่ละช็อต ≥ 2s (ย้ายวินาทีจากช็อตที่ยาวสุด)
 * - พยายามไม่เกิน MAX_SHOT_SECONDS — ส่วนเกินกระจายให้ช็อตที่ยังมี headroom;
 *   ถ้า durationSec > จำนวนช็อต×15 จะยอมให้เกินได้ (รักษาผลรวม = durationSec มาก่อน —
 *   render ปัดเข้าค่าที่โมเดลรองรับอีกชั้น)
 */
export function scaleBeats(beats: StudioTemplateBeat[], durationSec: number): StudioTemplateBeat[] {
  const n = beats.length
  const target = Math.max(Math.round(durationSec), n * MIN_SHOT_SECONDS)
  const total = templateDurationSec(beats)
  const exact = beats.map(b => (b.seconds * target) / total)
  const seconds = exact.map(v => Math.floor(v))
  // largest remainder → ผลรวมครบ target
  let remaining = target - seconds.reduce((a, b) => a + b, 0)
  const byFrac = exact.map((v, i) => ({ i, frac: v - Math.floor(v) })).sort((a, b) => b.frac - a.frac)
  for (const { i } of byFrac) {
    if (remaining <= 0) break
    seconds[i] += 1
    remaining -= 1
  }
  // ขั้นต่ำ 2s: ย้ายจากช็อตที่ยาวสุด
  for (let i = 0; i < n; i++) {
    while (seconds[i] < MIN_SHOT_SECONDS) {
      const donor = seconds.indexOf(Math.max(...seconds))
      if (seconds[donor] <= MIN_SHOT_SECONDS) break // target ≥ n*2 จึงเกิดยาก
      seconds[donor] -= 1
      seconds[i] += 1
    }
  }
  // cap: ส่วนเกินจากช็อตที่ยาวเกิน MAX กระจายให้ช็อตที่ยังมี headroom (รักษาผลรวม)
  for (let i = 0; i < n; i++) {
    while (seconds[i] > MAX_SHOT_SECONDS) {
      const headroom = seconds.findIndex((s, j) => j !== i && s < MAX_SHOT_SECONDS)
      if (headroom === -1) break // durationSec > n*MAX → ยอมเกิน
      seconds[i] -= 1
      seconds[headroom] += 1
    }
  }
  return beats.map((b, i) => ({ role: b.role, seconds: seconds[i] }))
}
