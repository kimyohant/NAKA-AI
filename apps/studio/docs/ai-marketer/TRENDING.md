# Trending Videos (Thailand) — Ready to Replicate

เมนูย่อยในหน้า **นักการตลาด AI** (`/marketer`) ศึกษาจาก https://www.topview.ai/ai-marketer (2026-10-05) — section "Trending Videos, Ready to Replicate" + "Creative Gallery"

## 1. สิ่งที่ Topview ทำ (จากการเปิดหน้าจริงด้วย browser)

```
[Filter bar]  Region: Thailand (ค่าเริ่มต้น, มี All regions ย่อย) · All industries
              Sort metrics: Video views | Estimated revenue | Engagement | ROAS
              Time range: Last 7 days (ปฏิทิน: Yesterday/7/15/30 days) · Reset
        ↓
[การ์ดวิดีโอ]  grid 5 คอลัมน์ 9:16 — thumbnail จริงจาก TikTok + TH badge
              Revenue ($3K) + Views (2.61M) ซ้อนบนภาพ · แคปชัน + hashtag ไทยด้านล่าง
              ปุ่ม "Recreate" บนการ์ด
        ↓
[กด Recreate] → สร้าง AI chat task ใหม่ ("Clone the attach") — แนบไฟล์ mp4 ของคลิปต้นฉบับ
              + prompt สำเร็จรูป "Clone the attached viral ad and create a new video
              with the following content: <แคปชัน>" → agent วิเคราะห์และสร้างคลิปใหม่ต่อทันที
```

ข้อมูลเบื้องหลัง: feed จาก commerce data ของ Topview (TikTok Shop ฯลฯ) — เป็น real-time trending พร้อมตัวเลข revenue ประมาณการ

## 2. สิ่งที่ NAKA-AI ทำได้ (ข้อจำกัดชัดเจน)

| ประเด็น | ข้อจำกัดของเรา | ทางแก้ |
|---|---|---|
| ข้อมูล trending real-time | **ห้าม scrape/ดึงข้อมูลจาก TikTok/Reels/YouTube** (ผิด ToS — กฎเดิม docs/viral-clone/PLAN.md §4) และ self-hosted ต้องทำงาน offline ได้ | **คลังเทรนด์ไทยแบบ curated** — ชุดข้อมูลแพตเทิร์นคลิปไวรัลไทยที่คัดไว้ใน backend (`services/trending.ts`) |
| Thumbnail คลิปจริง | ไม่มีสิทธิ์ใช้ภาพจากแพลตฟอร์ม | Cover แบบ CSS (gradient ตาม industry) + **ข้อความ hook ตัวใหญ่** — อ่านความหมายได้เร็วกว่าภาพเบลอ |
| ตัวเลข views/revenue | ไม่มี API วัดจริง | เก็บเป็น**ข้อมูลอ้างอิง ณ วันคัดเข้าระบบ** (`curatedAt`) แสดง disclaimer ชัด — สอดคล้องกฎ evidence/assumption ของระบบ (PLAN.md §3) |
| Recreate ด้วยวิดีโอต้นฉบับ | ไม่มี ASR + **ห้ามดาวน์โหลดวิดีโอจากแพลตฟอร์ม** | Recreate = สร้าง **AdReference** ในแคมเปญที่เลือก โดย transcript = **pattern brief โครงสร้าง beat ต่อ beat พร้อม hook formula** (ไม่ใช่ถ้อยคำต้นฉบับ) → ใช้ flow analyze → generateCreatives(referenceId) เดิมทั้งสาย |

**จุดต่างเชิงหลักการ:** Topview โคลน "ตัวคลิป" (แนบ mp4 ต้นฉบับให้ agent ดู) — เราโคลน "โครง" (pattern brief) ซึ่งเป็นวิธีเดียวกับที่ Viral Clone Studio เลือกใช้ (transcript-first, ไม่ละเมิดทรัพย์สิน/ToS)

## 3. ขอบเขต Phase 1

- หน้า `/marketer` เพิ่ม section "คลิปไวรัลไทย พร้อมโคลน" ใต้ header (ก่อน grid แคมเปญ)
- Filter: industry (beauty/food/fashion/gadgets/home/health/pets/other) · sort (views/estRevenue/engagement) · search (title/hashtag) — ที่ฝั่ง backend (`GET /api/v1/trending-videos`)
- การ์ด: cover CSS + hook text · TH + platform badge · views / est. revenue (THB) / engagement · แคปชันสไตล์ TikTok · สรุป "ทำไมมันเวิร์ก" · ปุ่ม "โคลนคลิปนี้"
- แสดง 8 การ์ดแรก + ปุ่ม "แสดงทั้งหมด"
- Dialog โคลน: เลือกแคมเปญเดิม หรือสร้างใหม่ (productName บังคับ, market ล็อก TH, platform ตามเทรนด์) → สร้าง AdReference อัตโนมัติ (title/notes/pattern transcript) → พาไปหน้าแคมเปญให้กด analyze ต่อ (flow เดิมทั้งหมด)
- i18n th/en ครบ (namespace `marketer.trending.*`)

**Out of scope Phase 2** (บันทึกไว้): เพิ่ม/แก้เทรนด์เองผ่าน UI (ตอนนี้แก้ที่ seed ใน `services/trending.ts`) · ดึงเทรนด์ผ่าน agent (market_researcher สร้างรายงานเทรนด์ใหม่) · เชื่อม creative ที่โคลนกลับมาวัดผล

## 4. Contract

### `GET /api/v1/trending-videos?industry=&sort=&q=`

Response `{ code: 200, data: { entries, industries, curatedAt } }` — JSON camelCase

```ts
interface TrendVideo {
  id: string                    // เช่น 'th-beauty-toner-pov' — unique
  title: string                 // แคปชันสไตล์ TikTok (ภาษาไทย)
  industry: TrendIndustry       // 'beauty'|'food'|'fashion'|'gadgets'|'home'|'health'|'pets'|'other'
  platform: Platform            // ใช้ enum เดิมของ marketer ('tiktok'|'reels'|'youtube_shorts'|…)
  hookType: string              // key i18n: marketer.trending.hookTypes.<hookType>
  views: number                 // ข้อมูลอ้างอิง ณ curatedAt (ไม่ใช่ real-time)
  estRevenueThb: number | null  // null = ไม่ทราบ/ไม่ใช่คลิปขายของ
  engagementRate: number | null // 0–1 (likes+comments+shares / views)
  durationSec: number
  hashtags: string[]            // ไม่มี # นำหน้า
  summary: string               // "ทำไมมันเวิร์ก" ภาษาไทย
  pattern: {
    hook: string                // ประโยค hook (0-3s) พร้อมสูตร
    beats: { role: 'hook'|'demo'|'proof'|'offer'|'cta'; line: string; durationSec: number }[]
    cta: string
  }
  sourceUrl: string | null      // ลิงก์ต้นฉบับถ้ามี (เก็บอ้างอิงอย่างเดียว ไม่ดึงเนื้อหา)
}
```

- `industry` กรองตรงตัว, `sort` ∈ `views|revenue|engagement` (default `views`), `q` ค้น title+hashtags (ไม่แคสเซนสิทีฟ)
- `industries` = รายการ industry ที่มีจริงในคลัง (ไว้ render filter), `curatedAt` = วันคัดเข้าระบบ ISO
- อ่านอย่างเดียว ไม่มี DB — เพิ่ม/แก้เทรนด์ที่ seed ใน `services/trending.ts`

### Flow "โคลนคลิปนี้" (frontend ประกอบเอง — ไม่เพิ่ม endpoint)

```
1. marketerAPI.list()               → dropdown เลือกแคมเปญ (หรือสร้างใหม่ผ่าน marketerAPI.create)
2. marketerAPI.addReference(id, {
     title:  entry.title,           // (backend เก็บได้ ≤ ความยาวปกติ)
     transcript: patternBrief(entry),  // โครงสร้าง beat แบบตัวอักษร — รูปแบบดูข้อ 5
     notes: `${entry.summary}\nHook: ${hookType} · #hashtag…`,
     sourceUrl: entry.sourceUrl,
   })
3. navigateTo(`/marketer/${id}`)    → ผู้ใช้กด "วิเคราะห์" (analyzeReference เดิม)
   → "สร้าง Creative" (generateCreatives + referenceId เดิม) → produce → pipeline เดิม
```

## 5. รูปแบบ pattern brief (transcript ที่สร้างให้ AdReference)

```
[โครงคลิปจากคลังเทรนด์ไทย NAKA-AI — pattern สำหรับนำไปสร้างใหม่ ไม่ใช่ถ้อยคำต้นฉบับ]
สินค้าประเภท: <industry> · แพลตฟอร์ม: <platform> · ความยาวอ้างอิง: <durationSec>s

[Hook 0-3s] <pattern.hook>
[3-10s | demo] <beats[i].line>
[10-25s | proof] <beats[i].line>
...
[CTA <จบ>s] <pattern.cta>
```

ad_analyst (flow เดิม) จะวิเคราะห์โครงนี้เป็น analysis → ad_scriptwriter เขียน creative ตามโครงโดยใช้สินค้าของแคมเปญ

## 6. การแบ่งงาน / ไฟล์ที่แตะ

| ฝั่ง | ไฟล์ |
|---|---|
| Backend | `src/services/trending.ts` (ใหม่ — คลัง + filter/sort) · `src/routes/trending.ts` (ใหม่) · `src/index.ts` (mount `/trending-videos`) · `tests/trending-structure.test.mjs` (ใหม่) |
| Frontend | `composables/useApi.ts` (TrendVideo + trendingAPI) · `components/MarketerTrendingSection.vue` (ใหม่) · `components/MarketerTrendingCard.vue` (ใหม่) · `pages/marketer.vue` (แทรก section) · `locales/th.json` + `en.json` (`marketer.trending.*`) |

กติกาเดิมครบ: ไม่มี UI framework (pure CSS ตาม design tokens ของแอป) · comment จีน/อังกฤษ/ไทยแบบที่โค้ดรอบข้างใช้ · i18n th/en parity · ไม่ commit/push

## Notes (implement 2026-10-05)

- **สถานะ**: เสร็จ Phase 1 ครบ — backend tests 8/8 + typecheck ผ่าน · frontend tests 107/107 (รวม `marketer-trending-structure.test.mjs` ใหม่ 5 cases) ผ่าน · `npm run generate` ผ่าน · smoke test จริงบน PORT=5680 (SQLite แยก): `GET /trending-videos` 200 ครบ 18 รายการ / filter+sort ถูกต้อง / sort ผิดค่า → 400 `E_INVALID_FIELD`
- **ไฟล์จริง**: backend `services/trending.ts` · `routes/trending.ts` · mount `/trending-videos` ใน `index.ts` · tests `trending.test.ts` + `trending-structure.test.mjs` — frontend `useApi.ts` (TrendVideo + trendingAPI) · `MarketerTrendingSection.vue` · `MarketerTrendingCard.vue` · แทรก section ใน `pages/marketer.vue` ระหว่าง header กับ grid แคมเปญ · i18n `marketer.trending.*` 52 keys × 2 locales (parity ผ่าน test)
- **patternBrief ฝั่ง frontend** (ไม่ใช่ backend): section component ประกอบ transcript จาก `entry.pattern` ตอนกด submit — ภาษาไทยตามคลังโดยตั้งใจ (เป็น "เนื้อหา" ไม่ใช่ UI string จึงไม่ผ่าน i18n; ทดสอบ scan หา marker "ไม่ใช่ถ้อยคำต้นฉบับ" ไว้)
- **ปุ่ม mode "แคมเปญเดิม" ปิดอัตโนมัติ** เมื่อยังไม่มีแคมเปญ (disabled + สลับเป็นโหมดสร้างใหม่) — create ใหม่ล็อก `market: 'TH'` + `platforms: [entry.platform]` ตามขอบเขตไทยเท่านั้น
- **รู้ทีหลัง**: namespace `viralClone.*` ใน docs/viral-clone/PLAN.md (Agent B notes) ยังไม่ถูก merge ใน working tree นี้ จึงกำหนด `marketer.trending.roles.*` ของตัวเอง ไม่อิง cross-namespace
- **คลัง 18 รายการ / 8 หมวด**: ทุกรายการเป็นแพตเทิร์นที่เขียนขึ้นใหม่ (ไม่คัดลอกแคปชันใคร) อิงรูปแบบคลิปคอมเมิร์ซไทยที่พบบน section ของ Topview ตอนศึกษา — ตัวเลข views/estRevenue/engagement เป็นข้อมูลอ้างอิง ณ `TRENDING_CURATED_AT = 2026-10-05` พร้อม disclaimer บนหน้า UI แล้ว
- การ์ด **ไม่ใช้ thumbnail** จากแพลตฟอร์มทุกกรณี — cover เป็น CSS gradient ตามหมวด + ข้อความ hook ใหญ่ (ทดสอบ scan หา `tiktok.com` ฯลฯ และ `fetch(` ใน components ไว้ทั้งคู่)
