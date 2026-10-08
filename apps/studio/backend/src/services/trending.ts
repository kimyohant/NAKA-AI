/**
 * Trending Videos (Thailand) — คลังแพตเทิร์นคลิปไวรัลไทยแบบ curated
 * docs/ai-marketer/TRENDING.md — ปรับจาก section "Trending Videos, Ready to Replicate" ของ topview.ai
 * ข้อจำกัดตั้งใจ: ห้าม scrape/ดึงข้อมูลจากแพลตฟอร์ม (ผิด ToS — กฎเดิม docs/viral-clone/PLAN.md §4)
 * → ตัวเลขทุกตัวเป็น "ข้อมูลอ้างอิง ณ วันคัดเข้าระบบ" (TRENDING_CURATED_AT) ไม่ใช่ real-time
 * เพิ่ม/แก้เทรนด์: แก้ TREND_VIDEOS ตรงนี้ได้เลย (อ่านอย่างเดียว ไม่มี DB — Phase 2 ค่อยทำ UI จัดการ)
 */

import { AppError } from '../core/http/response.js'

export type TrendIndustry = 'beauty' | 'food' | 'fashion' | 'gadgets' | 'home' | 'health' | 'pets' | 'other'

export interface TrendBeat {
  role: 'hook' | 'demo' | 'proof' | 'offer' | 'cta'
  line: string
  durationSec: number
}

export interface TrendVideo {
  id: string
  title: string
  industry: TrendIndustry
  // ใช้ enum Platform เดิมของ marketer (schema.ts) — ที่ใช้จริงกับคลิปสั้นไทยมี 3 ค่านี้
  platform: 'tiktok' | 'reels' | 'youtube_shorts'
  hookType: string // key i18n: marketer.trending.hookTypes.<hookType>
  views: number
  estRevenueThb: number | null
  engagementRate: number | null // 0-1 = (like+comment+share)/views
  durationSec: number
  hashtags: string[] // ไม่มี # นำหน้า
  summary: string // "ทำไมมันเวิร์ก" — สรุปแพตเทิร์นภาษาไทย
  pattern: {
    hook: string
    beats: TrendBeat[]
    cta: string
  }
  sourceUrl: string | null
}

export const TRENDING_CURATED_AT = '2026-10-05'

const TREND_VIDEOS: TrendVideo[] = [
  // ===== Beauty =====
  {
    id: 'th-beauty-toner-pov',
    title: 'POV หน้าใสวัยรุ่น…โทนเนอร์ตัวเด็ดถูกพูดถึงทั้ง FYP #โทนเนอร์ #รีวิวบิวตี้',
    industry: 'beauty',
    platform: 'tiktok',
    hookType: 'pov_callout',
    views: 2_600_000,
    estRevenueThb: 105_000,
    engagementRate: 0.081,
    durationSec: 61,
    hashtags: ['โทนเนอร์', 'รีวิวบิวตี้', 'หน้าใส', 'tiktoklooks'],
    summary: 'เปิดด้วยการเรียกกลุ่มเป้าหมายตรง ๆ แบบ POV แล้วรีวิวใช้จริงหน้ากล้อง ใช้เพลงและคำพูดตามกระแสวัยรุ่น ผู้ชมรู้สึกเหมือนเพื่อนแนะนำ ไม่ใช่โฆษณา — คอมเมนต์ถามราคาเยอะจึงปิดการขายง่าย',
    pattern: {
      hook: '"ใครหน้ามันเป็นมันส์ทั้งวัน หยุดเลื่อนก่อน ✋"',
      beats: [
        { role: 'hook', line: 'POV ถ่ายหน้าใกล้ ๆ พูดเรียกปัญหาของกลุ่มเป้าหมายตรง ๆ', durationSec: 3 },
        { role: 'demo', line: 'โชว์ผลิตภัณฑ์ใกล้เลนส์ ชี้จุดขาย 2 อย่างแบบพูดเร็ว', durationSec: 10 },
        { role: 'demo', line: 'ใช้จริงหน้ากล้อง ซูมผลลัพธ์ทันทีหลังใช้ (หน้าเดิม เทียบก่อน-หลังแสงเดิม)', durationSec: 20 },
        { role: 'proof', line: 'อ่านคอมเมนต์/รีวิวจริงจากผู้ใช้ 1-2 ข้อความ', durationSec: 15 },
        { role: 'offer', line: 'บอกช่องทางสั่ง + ราคา + โปรโมชันช่วงนี้', durationSec: 10 },
      ],
      cta: '"กดตะกร้าเลย ของมีจำกัดนะ อย่ารอวันหน้า"',
    },
    sourceUrl: null,
  },
  {
    id: 'th-beauty-setting-spray',
    title: 'สเปรย์ล็อคเมคอัพ ทานทั้งวันทั้งไลฟ์ #สเปรย์ล็อคเมคอัพ #รีวิวบิวตี้',
    industry: 'beauty',
    platform: 'tiktok',
    hookType: 'demo_first',
    views: 2_090_000,
    estRevenueThb: 1_400_000,
    engagementRate: 0.064,
    durationSec: 34,
    hashtags: ['สเปรย์ล็อคเมคอัพ', 'รีวิวบิวตี้', 'เมคอัพ', 'tiktoklooks'],
    summary: 'โชว์ผลลัพธ์ก่อนอธิบาย — เฟรมแรกคือหน้าเมคอัพเนียนหลังผ่านความร้อน/ความชื้นแล้ว (ขายความอยู่ทนซึ่งเป็น pain point อันดับหนึ่งของไทย) คลิปสั้น 30-35 วิ จบด้วยวิธีใช้ 1 จังหวะ',
    pattern: {
      hook: '"เมคอัพอยู่ทนทั้งวันแดดเผา 35 องศา ทำยังไง"',
      beats: [
        { role: 'hook', line: 'เฟรมแรก: หน้าเมคอัพเสร็จสวย ๆ + ซูมผิว (โชว์ผลลัพธ์ก่อน)', durationSec: 3 },
        { role: 'demo', line: 'พ่นสเปรย์หน้ากล้อง ชิ้นเดียวจบ แสดงระยะพ่นและความละเอียดละออง', durationSec: 12 },
        { role: 'proof', line: 'เช็ดด้วยผ้า/สัมผัส หรือโชว์หลังผ่านกิจกรรมทั้งวัน แต้มยังอยู่ครบ', durationSec: 12 },
        { role: 'offer', line: 'ราคา + ขนาด + วิธีใช้ 1 ประโยค', durationSec: 7 },
      ],
      cta: '"สั่งจากตะกร้าเลย ใช้ได้ทุกสูตรผิว"',
    },
    sourceUrl: null,
  },
  {
    id: 'th-beauty-hair-tonic-drama',
    title: 'เปลี่ยน "ขุนช้าง" ให้เป็น "ขุนแผน" ซีนย้อนยุคก่อน-หลัง #ผมร่วง #แฮร์โทนิค',
    industry: 'beauty',
    platform: 'tiktok',
    hookType: 'before_after',
    views: 1_380_000,
    estRevenueThb: 890_000,
    engagementRate: 0.072,
    durationSec: 28,
    hashtags: ['ผมร่วง', 'ผมบาง', 'แฮร์โทนิค'],
    summary: 'ก่อน-หลังแบบมินิละคร: เปิดซีน "ปัญหา" ให้ตลก/เกินจริงเล็กน้อย (ผมบาง = ขุนช้าง) แล้วตัดจางเป็นหลังใช้ 3 เดือน (ขุนแผน) — ใช้วรรณคดี/มุกไทยที่คนทั้งประเทศ get ทันที แชร์สูง',
    pattern: {
      hook: '"จากขุนช้าง…สู่ขุนแผน ด้วยขวดเดียว"',
      beats: [
        { role: 'hook', line: 'ซีนย้อนยุค หวีผมแล้วหลุดร่วง (เกินจริงแบบตลก) + ป้ายชื่อ "ขุนช้าง"', durationSec: 5 },
        { role: 'demo', line: 'หยิบแฮร์โทนิค โชว์ส่วนผสมจุดขาย + วิธีใช้ 3 วินาที', durationSec: 8 },
        { role: 'proof', line: 'ตัดภาพก่อน-หลัง 8 สัปดาห์ มุมและแสงเดิม + ป้ายชื่อ "ขุนแผน"', durationSec: 10 },
        { role: 'offer', line: 'โปรช่วงนี้ซื้อ 1 แถม 1 หรือราคากลุ่ม', durationSec: 5 },
      ],
      cta: '"กดตะกร้า แล้วค่อยมาขอบใจในคอมเมนต์"',
    },
    sourceUrl: null,
  },

  // ===== Food =====
  {
    id: 'th-food-asmr-fruit',
    title: 'กินโชว์ ASMR โคตรกรอบ เจอกันในไลฟ์สดตอนนี้ #กินโชว์ #ASMR',
    industry: 'food',
    platform: 'tiktok',
    hookType: 'asmr',
    views: 700_000,
    estRevenueThb: 580_000,
    engagementRate: 0.093,
    durationSec: 42,
    hashtags: ['กินโชว์', 'ASMR', 'ผลไม้ดอง', 'ไลฟ์สด'],
    summary: 'เสียงคือพระเอก — เปิดด้วยเสียงกัดกรอบ ๆ ทันทีไม่ต้องพูด คลิปมีไว้ดึงคนเข้าไลฟ์ (ประกาศเวลาไลฟ์ท้ายคลิป) ยอดขายเกิดในไลฟ์ คลิปเป็นแค่ประตู ยอดเอนเกจเมนต์สูงผิดปกติเพราะคนถามหาเวลาไลฟ์',
    pattern: {
      hook: 'เสียงกัดกรอบดัง ๆ + ซูมชิ้นใหญ่สุด (ไม่ต้องมีบทพูด)',
      beats: [
        { role: 'hook', line: 'กินชิ้นแรกเสียงดังสุด 3 วิแรก ซูมใกล้', durationSec: 4 },
        { role: 'demo', line: 'ชิ้นต่อไปเทราซอส/น้ำตาลพริกเพิ่ม โชว์ความน่ากิน', durationSec: 15 },
        { role: 'proof', line: 'ป้ายข้อความบนหน้าจอ: รีวิวลูกค้า "ส่งไว ห่อดี" + ยอดขายวันนี้', durationSec: 10 },
        { role: 'offer', line: 'ประกาศเวลาไลฟ์ + ราคาพาเลต/กล่อง', durationSec: 13 },
      ],
      cta: '"เจอกันในไลฟ์สดตอนนี้ — กดกระดิ่งรอของลด"',
    },
    sourceUrl: null,
  },
  {
    id: 'th-food-cereal-shock',
    title: '#อร่อยเอาเรื่อง คอนเฟลกคาราเมล ทานคู่กับนมเย็น ๆ #ฟ้าปลากระป๋อง',
    industry: 'food',
    platform: 'tiktok',
    hookType: 'demo_first',
    views: 1_710_000,
    estRevenueThb: 1_300_000,
    engagementRate: 0.058,
    durationSec: 25,
    hashtags: ['อร่อยเอาเรื่อง', 'คอนเฟลก', 'อาหารเช้า'],
    summary: 'โฆษณาแบรนด์ใหญ่ที่หน้าตาเหมือน UGC: ถ่ายมือถือ แสงบ้าน ไม่มีสตูดิโอ — โชว์การกินจริงกับมุกเสียงตามกระแส แบรนด์ใช้รูปแบบเดียวกับครีเอเตอร์ธรรมดาเพื่อหลบ blindness ของโฆษณาแบบเดิม',
    pattern: {
      hook: 'เสียง "แกล้มมม—" พร้อมเทคอนเฟลกลงชามโชว์จัด 3 วิ',
      beats: [
        { role: 'hook', line: 'เทซีเรียลลงชามถ่ายจากมุมบน เสียงกรอบดัง', durationSec: 4 },
        { role: 'demo', line: 'เติมนมเย็น ซูมมุมข้าง โชว์เนื้อคาราเมล กินหน้ากล้อง', durationSec: 12 },
        { role: 'proof', line: 'แคปชันบนจอ: วิตามิน/ประโยชน์ 1-2 ข้อ + ป้ายราคาโปรฯ', durationSec: 6 },
        { role: 'cta', line: 'ป้ายชื่อแบรนด์ + เสียงมุกตามกระแสปิดท้าย', durationSec: 3 },
      ],
      cta: '"#อร่อยเอาเรื่อง หาในร้านสะดวกซื้อได้เลย"',
    },
    sourceUrl: null,
  },
  {
    id: 'th-food-kitkat-drink',
    title: 'วันหยุดนี้มาทำเมนูยักษ์จากขนมดังกันครับ #สูตรเด็ด #ทำเองที่บ้าน',
    industry: 'food',
    platform: 'tiktok',
    hookType: 'tutorial',
    views: 1_680_000,
    estRevenueThb: null,
    engagementRate: 0.061,
    durationSec: 55,
    hashtags: ['ทำเองที่บ้าน', 'เมนูไวรัล', 'คิทแคท', 'กับสุธี'],
    summary: 'คลิปสอนทำเมนูจากขนมดัง (branded content): ครีเอเตอร์มีเอกลักษณ์ + สูตรทำตามได้จริงที่บ้าน แบรนด์ได้ reach ใหม่แบบไม่เหมือนโฆษณา ไม่มีปุ่มขาย — ขายคือการจดจำแบรนด์ (คลิปแนวนี้ใช้ทำ brand awareness ก่อนขาย)',
    pattern: {
      hook: '"ถ้าคุณมีขนมแถมนม วันนี้เราจะทำแก้วยักษ์"',
      beats: [
        { role: 'hook', line: 'โชว์วัตถุดิบ 3 อย่างวางโต๊ะ + ประโยคท้าทาย', durationSec: 5 },
        { role: 'demo', line: 'ทำทีละขั้น ตัดเร็วทุก 2-3 วิ มีข้อความสูตรบนจอ', durationSec: 30 },
        { role: 'proof', line: 'ชิมหน้ากล้อง + รีแอ็กชันจริง', durationSec: 10 },
        { role: 'cta', line: 'ท้าทายผู้ชมทำตาม + แฮชแท็กแบรนด์', durationSec: 10 },
      ],
      cta: '"ใครทำตามแล้วมาคอมเมนต์ผลหน่อย #แฮชแท็กแบรนด์"',
    },
    sourceUrl: null,
  },

  // ===== Gadgets =====
  {
    id: 'th-gadget-phone-tripod',
    title: 'ใช้ดีบอกต่อ ขาตั้งมือถือตัวนี้ เผื่อใครถามซื้อได้ที่ไหน #ของใช้ดีบอกต่อ',
    industry: 'gadgets',
    platform: 'tiktok',
    hookType: 'pov_callout',
    views: 810_000,
    estRevenueThb: 260_000,
    engagementRate: 0.075,
    durationSec: 38,
    hashtags: ['ของใช้ดีบอกต่อ', 'ขาตั้งมือถือ', 'เผื่อใครถาม'],
    summary: 'สูตร "ใช้ดีบอกต่อ" — ตัวคลิปเป็นเหมือนคำตอบส่วนตัวที่แชร์ให้เพื่อน ไม่เหมือนขาย ผู้ชมรู้สึกได้ประโยชน์ คอมเมนต์ถาม "ซื้อที่ไหน" เยอะ = engagement แปลงเป็นยอดโดยตรง ขายของราคาถูกแถม ๆ ต้องใช้สูตรนี้',
    pattern: {
      hook: '"มีคนถามทุกคลิปว่าขาตั้งอะไร — นี่ครับตัวนั้น"',
      beats: [
        { role: 'hook', line: 'ตอบคำถามที่คนถามบ่อย (สร้างความรู้สึกว่าอ่านคอมเมนต์จริง)', durationSec: 4 },
        { role: 'demo', line: 'โชว์จุดใช้งานจริง 3 ตำแหน่ง (โต๊ะ/รถ/เตียง) ตัดเร็ว', durationSec: 18 },
        { role: 'proof', line: 'จุดเด่นที่ต่างจากของถูกทั่วไป 1-2 ข้อ (ล็อคแน่น/หมุนได้)', durationSec: 8 },
        { role: 'offer', line: 'ราคา + ที่อยู่ตะกร้า', durationSec: 8 },
      ],
      cta: '"ใครอยากได้แบบเดียวกัน ตะกร้าอยู่มุมขวา"',
    },
    sourceUrl: null,
  },
  {
    id: 'th-gadget-mechanic-tools',
    title: 'อุปกรณ์ช่างที่ช่างเลือกใช้ #อุปกรณ์ช่าง #เทรนด์วันนี้tiktok',
    industry: 'gadgets',
    platform: 'tiktok',
    hookType: 'demo_first',
    views: 1_360_000,
    estRevenueThb: 68_000,
    engagementRate: 0.069,
    durationSec: 45,
    hashtags: ['อุปกรณ์ช่าง', 'ของมันต้องมี', 'ช่างมืออาชีพ'],
    summary: 'กลุ่มเฉพาะทาง (niche) แต่ซื้อแรงมาก: โชว์การใช้เครื่องมือชิ้นต่อชิ้นแบบ ASMR ช่าง ผู้ชมคืออาชีพเดียวกัน ดูจบคลิปแล้วอยากมีติดมือ เนื้อหาแนวนี้ยอดขายต่อคลิปน้อยกว่าแต่ซื้อซ้ำและแชร์ในกลุ่มช่างทั้งประเทศ',
    pattern: {
      hook: 'ซูมมือถือเครื่องมือ ตัวเดียว วางบนโต๊ะช่าง + เสียงกระทบจริง',
      beats: [
        { role: 'hook', line: 'เปิดด้วยเครื่องมือชิ้นเด่นใช้งานจริง 2 จังหวะ', durationSec: 5 },
        { role: 'demo', line: 'ไล่โชว์ทีละชิ้น ใช้จริงกับงานจริง มีข้อความชื่อ/ราคากำกับ', durationSec: 25 },
        { role: 'proof', line: 'ป้ายคอมเมนต์ลูกค้าเก่า "ใช้มา 2 ปี ไม่พัง"', durationSec: 8 },
        { role: 'offer', line: 'ชุดเต็มราคา + ขายแยกได้', durationSec: 7 },
      ],
      cta: '"อยากได้แบบไหน พิมพ์ชื่อชิ้นในคอมเมนต์ได้เลย"',
    },
    sourceUrl: null,
  },

  // ===== Home =====
  {
    id: 'th-home-car-wash-set',
    title: 'ชุดเซ็ทล้างรถ 12 ชิ้น ไม่ถึงร้อย คุ้มมาก ๆ #แปรงล้างรถ #ล้างรถ',
    industry: 'home',
    platform: 'tiktok',
    hookType: 'price_shock',
    views: 800_000,
    estRevenueThb: 74_000,
    engagementRate: 0.07,
    durationSec: 40,
    hashtags: ['ล้างรถ', 'ของใช้ในรถ', 'ของราคาถูก'],
    summary: 'เผาราคาตรง ๆ ในประโยคแรก ("ไม่ถึงร้อย") + โชว์ของครบทุกชิ้นแบบ flat lay — ผู้ชมคำนวณความคุ้มใน 3 วิ แม่ค้าคุยกับคอมเมนต์จริงจนกระแสไหลต่อเนื่อง ขายของชุดต้องใช้สูตรนี้',
    pattern: {
      hook: '"12 ชิ้น ไม่ถึงร้อยบาท จริง ๆ นะ"',
      beats: [
        { role: 'hook', line: 'พูดราคาใน 3 วิแรก + โชว์ชุดครบ flat lay', durationSec: 5 },
        { role: 'demo', line: 'หยิบชิ้นต่อชิ้นบอกหน้าที่ ตัดเร็ว (1 วิ/ชิ้น)', durationSec: 18 },
        { role: 'proof', line: 'ใช้จริงล้างรถสักส่วน โชว์ฟอง/ความสะอาด', durationSec: 10 },
        { role: 'offer', line: 'ย้ำราคา + ค่าส่ง/โปรแถม', durationSec: 7 },
      ],
      cta: '"ราคาไม่ถึงร้อย กดตะกร้าก่อนหมดค่ะ"',
    },
    sourceUrl: null,
  },
  {
    id: 'th-home-toilet-cleaner',
    title: 'ทุกการกดน้ำ ก็เหมือนได้ทำความสะอาดไปในตัว #ก้อนทําความสะอาดโถส้วม',
    industry: 'home',
    platform: 'tiktok',
    hookType: 'demo_first',
    views: 890_000,
    estRevenueThb: 510_000,
    engagementRate: 0.066,
    durationSec: 30,
    hashtags: ['โถส้วม', 'ทำความสะอาด', 'ของใช้ในบ้าน'],
    summary: 'ขาย "กลไกสะดวก" ด้วยคลิปสั้น 30 วิ: ประโยคเดียวจบคุณค่า (กดน้ำ = ทำความสะอาด) โชว์วิธีติดตั้ง 5 วิ และผลฟองฟูทุกครั้งที่กด สูตรคลาสสิกสำหรับของใช้ในบ้านที่อธิบายยาก — ทำให้เห็นแทนพูด',
    pattern: {
      hook: '"กดน้ำครั้งไหน ก็สะอาดครั้งนั้น"',
      beats: [
        { role: 'hook', line: 'ประโยคขายเดียว + โชว์ฟองฟูตอนกดน้ำ', durationSec: 4 },
        { role: 'demo', line: 'ติดตั้งกล่อง 5 วิ (ถอดแคป แปะ จบ)', durationSec: 8 },
        { role: 'proof', line: 'เทียบคราบก่อน-หลังใช้ 7 วัน', durationSec: 10 },
        { role: 'offer', line: 'จำนวนครั้งที่ใช้ได้/กล่อง + ราคา', durationSec: 8 },
      ],
      cta: '"เปลี่ยนทุก 1 เดือน สั่งตะกร้าเลย"',
    },
    sourceUrl: null,
  },

  // ===== Health =====
  {
    id: 'th-health-birdnest-drink',
    title: 'อายุเพิ่มได้ แต่ความสดใส…อย่าให้ลด #แบรนด์รังนกวิตามิน',
    industry: 'health',
    platform: 'tiktok',
    hookType: 'storytime',
    views: 2_070_000,
    estRevenueThb: null,
    engagementRate: 0.052,
    durationSec: 58,
    hashtags: ['แบรนด์รังนก', 'เครื่องดื่มเสริม', 'ดูแลตัวเอง'],
    summary: 'คลิปแบรนด์แนวอบอุ่น: เปิดด้วยประโยค emotion ("อายุเพิ่มได้ แต่ความสดใสอย่าให้ลด") แล้วเล่าเซอร์วิสของผลิตภัณฑ์ผ่านบรรยากาศใกล้ตัว (เพื่อน ครอบครัว) — ยี่ห้อใหญ่ใช้คลิปประเภทนี้ปั้น brand ความสดใส แล้วค่อยปิดการขายด้วยรสชาติ/โปรฯ',
    pattern: {
      hook: '"อายุเพิ่มได้ แต่ความสดใส…อย่าให้ลด"',
      beats: [
        { role: 'hook', line: 'ประโยค emotion + ภาพชีวิตประจำวันใกล้ตัว', durationSec: 4 },
        { role: 'demo', line: 'โชว์รสชาติทั้ง 3 แบบ (มะพร้าว/น้ำผึ้ง/ใบเตย) เน้นภาพเย็น ๆ', durationSec: 20 },
        { role: 'proof', line: 'ข้อความส่วนผสม + สิ่งที่ได้ (วิตามินอี/ซี) เป็นป้ายบนจอ', durationSec: 18 },
        { role: 'cta', line: 'ปิดด้วยบรรยากาศดี ๆ + ชื่อแบรนด์', durationSec: 16 },
      ],
      cta: '"เติมความสดใสได้ทุกวัน หาได้ที่ร้านใกล้บ้านและตะกร้า"',
    },
    sourceUrl: null,
  },
  {
    id: 'th-health-supplement-live',
    title: 'ไลฟ์ขายอาหารเสริม ตอบทุกคอมเมนต์ ราคาไลฟ์เท่านั้น #ไลฟ์สด #อาหารเสริม',
    industry: 'health',
    platform: 'tiktok',
    hookType: 'live_hook',
    views: 640_000,
    estRevenueThb: 2_100_000,
    engagementRate: 0.11,
    durationSec: 60,
    hashtags: ['ไลฟ์สด', 'อาหารเสริม', 'สุขภาพ'],
    summary: 'ตัวอย่างแม่บทของ "ไลฟ์คอมเมิร์ซไทย": คลิปล่อ ( teaser ) สั้น ๆ ชี้ไปที่ไลฟ์ที่เดียว ราคาพิเศษมีเฉพาะในไลฟ์ ผู้ชมต้องรอเพื่อได้ราคา → watch time และยอดขายสูงมาก แต่ต้องมีตัวไลฟ์จริง (Phase 2 ของเราไม่รวม TTS/ไลฟ์ — ใช้สูตรนี้กับคลิปชวนไปไลฟ์)',
    pattern: {
      hook: '"คืนนี้ 3 ทุ่ม ราคาไลฟ์มีแค่ 20 ชุด"',
      beats: [
        { role: 'hook', line: 'ประกาศเวลาไลฟ์ + ของที่จะปล่อย (เลขจำกัด)', durationSec: 5 },
        { role: 'demo', line: 'โชว์สินค้าแบบเร็ว ๆ 3 ชิ้น + ราคาปกติ vs ราคาไลฟ์', durationSec: 20 },
        { role: 'proof', line: 'คลิปหน้าจอยอดคอมเมนต์/คำขอบคุณลูกค้าไลฟ์ก่อนหน้า', durationSec: 20 },
        { role: 'cta', line: 'ตั้งเวลาไลฟ์ + เปิดกระดิ่ง', durationSec: 15 },
      ],
      cta: '"กดตั้งเวลาไลฟ์เลย พลาดรอบนี้ราคาไม่กลับมา"',
    },
    sourceUrl: null,
  },

  // ===== Fashion =====
  {
    id: 'th-fashion-sport-shorts',
    title: 'กางเกงกีฬาขาสั้นผ้าดี ใส่สบายเหมือนไม่ได้ใส่ #กางเกงกีฬา',
    industry: 'fashion',
    platform: 'tiktok',
    hookType: 'pov_callout',
    views: 720_000,
    estRevenueThb: 190_000,
    engagementRate: 0.071,
    durationSec: 36,
    hashtags: ['กางเกงกีฬา', 'ขาสั้น', 'ใส่สบาย'],
    summary: 'ขายความสบายด้วยการ "โชว์สัมผัส": บีบผ้า เหวี่ยง เอียงกล้องโชว์เนื้อผ้า ใส่แล้วเดิน/นั่ง/วิ่งจริง ราคาถูกใจวัยทำงาน ใช้เพลงตามกระแส ป้ายราคาเด้งท้ายคลิป — สูตรมาตรฐานของ fashion ราคาเข้าถึงได้',
    pattern: {
      hook: '"ผ้าดีขนาดนี้ ใส่นอนยังหลับสบาย"',
      beats: [
        { role: 'hook', line: 'ซูมเนื้อผ้า + บีบ/เหวี่ยงโชว์ความยืด', durationSec: 4 },
        { role: 'demo', line: 'ใส่จริง เดิน/นั่งยอง ๆ/วิ่ง 2 จังหวะ', durationSec: 16 },
        { role: 'proof', line: 'สีให้เลือก 5 สี + เอวยางดี กระเป๋าลึก', durationSec: 8 },
        { role: 'offer', line: 'ราคา + แถมค่าส่งช่วงนี้', durationSec: 8 },
      ],
      cta: '"กดตะกร้าเลย สีดี ๆ ขายเร็วมาก"',
    },
    sourceUrl: null,
  },
  {
    id: 'th-fashion-live-clearance',
    title: 'ไลฟ์จัดไว ๆ เสื้อตัวละเดียว อดแล้วอดเลย #ไลฟ์ขายผ้า #เสื้อผ้าราคาถูก',
    industry: 'fashion',
    platform: 'tiktok',
    hookType: 'live_hook',
    views: 560_000,
    estRevenueThb: 1_700_000,
    engagementRate: 0.12,
    durationSec: 33,
    hashtags: ['ไลฟ์ขายผ้า', 'เสื้อผ้าราคาถูก', 'อดแล้วอดเลย'],
    summary: 'คลิป teaser ก่อนไลฟ์แบบ "ตัวละเดียว": โชว์กองเสื้อ + ประกาศเวลาไลฟ์ สร้าง FOMO (ของชิ้นเดียว ไม่มีเติม) แฟนเพจแนวนี้ยอดไลฟ์สูงเพราะคนรู้ว่าช้าแปปเดียวของหาย — ใช้คู่กับกำหนดการไลฟ์ประจำสัปดาห์',
    pattern: {
      hook: '"คืนนี้ 4 ทุ่ม เสื้อตัวละเดียว ไม่มีเติม"',
      beats: [
        { role: 'hook', line: 'โชว์กองของ + ประกาศเวลาไลฟ์ ตรง ๆ', durationSec: 5 },
        { role: 'demo', line: 'ไล่โชว์ไฮไลต์ 5 ตัวที่ต้องแย่ง ตัดเร็ว', durationSec: 16 },
        { role: 'proof', line: 'คอมเมนต์จากไลฟ์ก่อน "ได้ 3 ตัว แทบไม่ทันกด"', durationSec: 6 },
        { role: 'cta', line: 'เจอกันคืนนี้ ตั้งเวลาได้แล้ว', durationSec: 6 },
      ],
      cta: '"ตั้งเวลาไลฟ์เลย อดแล้วอดเลยนะ"',
    },
    sourceUrl: null,
  },

  // ===== Pets =====
  {
    id: 'th-pet-gummy-frog',
    title: 'กิวเต้ ล็อตแรกมาแล้ว ลูกสั่งแล้วเลย #กบยางกิวเต้ #ของเล่นสัตว์เลี้ยง',
    industry: 'pets',
    platform: 'tiktok',
    hookType: 'trend_jack',
    views: 880_000,
    estRevenueThb: 310_000,
    engagementRate: 0.087,
    durationSec: 32,
    hashtags: ['กบยางกิวเต้', 'ของเล่นแมว', 'สัตว์เลี้ยง'],
    summary: 'จับกระแสของเล่นไวรัล (กบยาง) มาทำเวอร์ชันสัตว์เลี้ยง: ประกาศ "ล็อตแรกมาแล้ว" + รีแอ็กชันสัตว์จริงแบบตลก กระแสของเล่นไวรัลมีอายุสั้น ต้องปล่อยไว ขายแบบล็อต/พรีออเดอร์',
    pattern: {
      hook: '"ล็อตแรกมาถึงแล้ว! แมวทั้งบ้านพากันยึด"',
      beats: [
        { role: 'hook', line: 'แกะพัสดุกบยาง + รีแอ็กชันสัตว์เลี้ยงทันที', durationSec: 5 },
        { role: 'demo', line: 'สัตว์เล่นจริง มุมตลก ตัด 2-3 ซีน', durationSec: 15 },
        { role: 'proof', line: 'วัสดุปลอดภัย/ทนเจ๊าะ + ขนาดเหมาะกับแมว-หมา', durationSec: 7 },
        { role: 'offer', line: 'ล็อตนี้มีจำกัด + ราคาพรีออเดอร์', durationSec: 5 },
      ],
      cta: '"ล็อตแรกจำนวนจำกัด กดตะกร้าก่อนหมด"',
    },
    sourceUrl: null,
  },
  {
    id: 'th-pet-ling-toy',
    title: 'เกาะเป็นปลิงเลย ลูกค้าสั่งกลับมาซื้อซ้ำทั้งกระทู้ #ของเล่นปลิง #แมว',
    industry: 'pets',
    platform: 'tiktok',
    hookType: 'comedy',
    views: 1_190_000,
    estRevenueThb: null,
    engagementRate: 0.079,
    durationSec: 27,
    hashtags: ['ปลิง', 'ของเล่นแมว', 'แมวเรียกยาย'],
    summary: 'มุก "แมวเรียกยาย" จากของเล่นเสียง/รูปทรงแปลก — คลิปตลกสัตว์เลี้ยงแชร์สูงมากในไทย ยอดขายตามหลังแชร์ คลิปแนวนี้ต้องจับความตลกจริง ไม่ใช่แต่ง — ถ่ายของจริง สัตว์จริง รีแอ็กชันจริง',
    pattern: {
      hook: 'ซีนแมวหูผงาดวิ่งมาหาของเล่นทันที 3 วิแรก',
      beats: [
        { role: 'hook', line: 'รีแอ็กชันสัตว์ที่ตลกที่สุดไว้ 3 วิแรกเสมอ', durationSec: 4 },
        { role: 'demo', line: 'เล่นจริงหลายมุม + เสียงของเล่น', durationSec: 12 },
        { role: 'proof', line: 'ลูกค้าส่งคลิปกลับมา (มีสิทธิ์แล้ว) รวม 2-3 คลิป', durationSec: 6 },
        { role: 'offer', line: 'ราคา + ส่งไว', durationSec: 5 },
      ],
      cta: '"บ้านคุณก็ต้องมีสักตัว กดตะกร้าได้เลย"',
    },
    sourceUrl: null,
  },

  // ===== Other =====
  {
    id: 'th-other-newsjack-flood',
    title: 'จับกระแสสถานการณ์จริงในพื้นที่ ขายของแบบเป็นห่วงเป็นใย #น้ำท่วม',
    industry: 'other',
    platform: 'tiktok',
    hookType: 'trend_jack',
    views: 1_190_000,
    estRevenueThb: null,
    engagementRate: 0.084,
    durationSec: 44,
    hashtags: ['น้ำท่วม', 'สถานการณ์จริง', 'ช่วยกัน'],
    summary: 'การจับกระแสข่าว/สถานการณ์จริงในพื้นที่ (น้ำท่วม ฯลฯ) — ร้านค้าเล่าสถานการณ์จริงจากมุมตัวเอง คนติดตามเพราะอยากรู้ข้อมูล แล้วจดจำร้านเป็น "คนจริง พูดจริง" การขายต้องเบามาก หรือไม่ขายเลยในคลิปนั้น (ขายที่ความน่าเชื่อถือ — ห้ามหวือหวาเกิน)',
    pattern: {
      hook: '"สถานการณ์ตอนนี้ในซอยเรา สู้ ๆ กันนะ"',
      beats: [
        { role: 'hook', line: 'ภาพจริงในพื้นที่ + คำพูดเป็นห่วงเป็นใย', durationSec: 6 },
        { role: 'demo', line: 'เล่าสิ่งที่เจอ/ช่วยเหลือยังไง เน้นข้อมูลมีประโยชน์', durationSec: 22 },
        { role: 'proof', line: 'เชิญชวน/ประสานงานชุมชน (ไม่ใช่ขาย)', durationSec: 10 },
        { role: 'cta', line: 'ปิดด้วยกำลังใจ + ติดตามข่าวต่อที่แอค', durationSec: 6 },
      ],
      cta: '"สู้ ๆ ทุกคน ติดตามสถานการณ์ได้ที่แอคนี้"',
    },
    sourceUrl: null,
  },
  {
    id: 'th-other-football-story',
    title: 'ให้ภาพมันเล่า ฟุตบอลเดินสายเงินล้าน #ฟุตบอล #เดินสายเงินล้าน',
    industry: 'other',
    platform: 'tiktok',
    hookType: 'storytime',
    views: 690_000,
    estRevenueThb: 4_000,
    engagementRate: 0.062,
    durationSec: 51,
    hashtags: ['ฟุตบอล', 'เดินสาย', 'เล่าเรื่อง'],
    summary: 'คลิปเล่าเรื่อง "ให้ภาพมันเล่า" จากพื้นที่จริง — ไม่ขายอะไรเลยแต่ยอดดูสูงเพราะเล่าเก่งและภาพสวย รูปแบบนี้ใช้ปั้นแอคเคานต์ (grow the channel) ให้คลิปขายในอนาคตไปถึงคนมากขึ้น อย่าเพิ่งขายในคลิปประเภทนี้',
    pattern: {
      hook: 'ภาพสวยที่สุดของคลิป + เสียงบรรยาย "ให้ภาพมันเล่า…"',
      beats: [
        { role: 'hook', line: 'ภาพจังหวะสวยสุด 3 วิ + ประโยคชวนดู', durationSec: 4 },
        { role: 'demo', line: 'เล่าเรื่องจากพื้นที่จริง เสียงบรรยายต่อเนื่อง ภาพตัดตามเนื้อเรื่อง', durationSec: 30 },
        { role: 'proof', line: 'รายละเอียดที่คนไม่รู้ 1 เรื่อง (สาระเสริม)', durationSec: 12 },
        { role: 'cta', line: 'ชวนติดตาม (ไม่ขาย)', durationSec: 5 },
      ],
      cta: '"ติดตามไว้ สัปดาห์หน้าไปต่อที่สนามนี้"',
    },
    sourceUrl: null,
  },
]

export const TREND_INDUSTRIES: TrendIndustry[] = [
  'beauty', 'food', 'fashion', 'gadgets', 'home', 'health', 'pets', 'other',
]

const TREND_SORTS = ['views', 'revenue', 'engagement'] as const
export type TrendSort = (typeof TREND_SORTS)[number]

export interface TrendListResult {
  entries: TrendVideo[]
  industries: TrendIndustry[]
  curatedAt: string
}

/**
 * คัดกรอง/เรียงคลังเทรนด์ — industry/sort ผิดค่า → E_INVALID_FIELD (route แปลง 400)
 * q ค้น title + hashtag แบบไม่สนตัวพิมพ์ (ภาษาไทย toLowerCase ไม่กระทบ)
 */
export function listTrendVideos(opts: { industry?: string; sort?: string; q?: string } = {}): TrendListResult {
  let entries = [...TREND_VIDEOS]

  if (opts.industry !== undefined) {
    if (!(TREND_INDUSTRIES as string[]).includes(opts.industry)) {
      throw new AppError(`industry ไม่รู้จัก: ${opts.industry}`, 'E_INVALID_FIELD')
    }
    entries = entries.filter(e => e.industry === opts.industry)
  }

  if (opts.q !== undefined && opts.q.trim()) {
    const q = opts.q.trim().toLowerCase()
    entries = entries.filter(e =>
      e.title.toLowerCase().includes(q)
      || e.hashtags.some(h => h.toLowerCase().includes(q)))
  }

  const sort: TrendSort = (TREND_SORTS as readonly string[]).includes(opts.sort || '')
    ? (opts.sort as TrendSort)
    : 'views'
  if (opts.sort !== undefined && opts.sort !== '' && !(TREND_SORTS as readonly string[]).includes(opts.sort)) {
    throw new AppError(`sort ไม่รู้จัก: ${opts.sort}`, 'E_INVALID_FIELD')
  }
  // null (ไม่ทราบค่า) ไปท้ายเสมอ
  const nullLast = (v: number | null) => (v === null ? Number.NEGATIVE_INFINITY : v)
  if (sort === 'views') entries.sort((a, b) => b.views - a.views)
  if (sort === 'revenue') entries.sort((a, b) => nullLast(b.estRevenueThb) - nullLast(a.estRevenueThb))
  if (sort === 'engagement') entries.sort((a, b) => nullLast(b.engagementRate) - nullLast(a.engagementRate))

  const industries = TREND_INDUSTRIES.filter(i => TREND_VIDEOS.some(e => e.industry === i))
  return { entries, industries, curatedAt: TRENDING_CURATED_AT }
}
