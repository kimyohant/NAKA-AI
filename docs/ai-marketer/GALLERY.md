# Creative Gallery & Ad Analytics (คลังผลงาน + กรอกผลตอบรับจริง)

Phase ต่อยอดจาก [TRENDING.md](TRENDING.md) — ปิดครึ่งหลังของวงจรการตลาดที่ขาด:

```
เดิม:   เห็นเทรนด์ → โคลน → research → strategy → creative → ผลิตวิดีโอ   (จบที่นี่)
เพิ่ม:                                                     → คลังผลงาน → กรอกผลจริง → กลับเป็น Evidence ของ research รอบถัดไป
```

ศึกษาจาก topview.ai: "Creative Gallery" + "Ad Analytics (Search Terms / ROAS Analysis)" — ของเราทำแบบ **manual analytics**: ผู้ใช้กรอกตัวเลขจริงจาก TikTok Analytics ต้นทางเอง (ระบบไม่อ้างว่าดึงข้อมูลได้ — สอดคล้องกฎ Evidence/Assumption และกฎห้าม scrape แพลตฟอร์ม)

## 1. ขอบเขต

- หน้าใหม่ `/marketer/gallery` — รวม creative ที่ `approved` / `in_production` ทุกแคมเปญในหน้าเดียว
- การ์ดแต่ละใบ: สินค้า/แคมเปญ · angle · hook · format + platform · สถานะ · ลิงก์ไปตอนที่ผลิตไว้ · ตัวเลขผลตอบรับ (ถ้าเคยกรอก)
- Dialog "บันทึกผลตอบรับ": views / likes / comments / shares / salesThb / ลิงก์โพสต์ / วันที่โพสต์ / โน้ต — 1 รายการต่อ 1 creative (upsert)
- สรุปภาพรวม: จำนวนผลงาน, ผลิตแล้ว, มีผลตอบรับ, ยอดวิวรวม, ยอดขายรวม (THB)
- **วงจรเรียนรู้**: research รอบถัดไปดึงผลตอบรับของแคมเปญนั้นเป็น Evidence แนบใน message ของ `market_researcher` อัตโนมัติ
- i18n th/en (`marketer.gallery.*`) · เข้าถึงจากปุ่ม "คลังผลงาน" บนหน้า /marketer (ไม่เพิ่มรายการ sidebar)

**Out of scope (ภายหลัง):** วิดีโอพรีวิวในคลัง (ต้องเชื่อม output ของ merge ต่อ) · กราฟตามช่วงเวลา · เปรียบเทียบระหว่างแคมเปญ · auto-pull จากแพลตฟอร์ม (ห้าม)

## 2. Data model (migration **v16** — renumber จาก v13 เพราะ master ใช้ 13 ไปกับ style gallery)

```sql
CREATE TABLE IF NOT EXISTS creative_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  creative_id INTEGER NOT NULL UNIQUE,   -- 1:1 กับ campaign_creatives (ไม่ทำ FK แข็งตามธรรมเนียมเดิม)
  views INTEGER,
  likes INTEGER,
  comments INTEGER,
  shares INTEGER,
  sales_thb REAL,
  posted_url TEXT,
  posted_at TEXT,
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)
```

- ลบ creative แบบ hard (DELETE /campaigns/:id/creatives/:cid) → ลบ result ค้างด้วย (ทำใน `deleteCreative` ของ marketer.ts จุดเดียว)
- ตัวเลขต้องเป็นเลขไม่ติดลบ; salesThb ปัด 2 ตำแหน่ง (เกณฑ์เดียวกับ budget_thb); postedUrl http/https; note ≤ 2,000 ตัวอักษร; กรอกบางช่องว่างได้ (เก็บเฉพาะช่องที่กรอก)

## 3. Contract — `/api/v1/gallery` (อ่าน/เขียนผ่าน route ใหม่ ไม่ชน pattern `/:id` ของ campaigns)

| Method | Path | พฤติกรรม |
|---|---|---|
| GET | `/gallery` | `{ entries, summary }` — entries = creative ที่ `approved`/`in_production` ทุกแคมเปญ (ไม่นับ campaign ที่ soft-delete), เรียง campaign → creative ใหม่→เก่า; `result` เป็น object หรือ null; `engagementRate` คำนวณฝั่ง backend = (likes+comments+shares)/views เมื่อ views > 0 |
| PUT | `/gallery/creatives/:cid/result` | upsert ตาม creative_id → 201/200 · creative ไม่มีจริง → 404 · body ผิด → 400 `E_INVALID_FIELD` |
| DELETE | `/gallery/creatives/:cid/result` | ลบผลตอบรับ (ไม่แตะ creative) |

```ts
interface GalleryEntry {
  creativeId: number; campaignId: number; campaignTitle: string
  productName: string; productImage: string | null
  angle: string; hook: string; format: CreativeFormat; platform: Platform
  durationSec: number
  status: 'approved' | 'in_production'
  episodeId: number | null; episodeNumber: number | null
  result: {
    views: number | null; likes: number | null; comments: number | null; shares: number | null
    salesThb: number | null; postedUrl: string | null; postedAt: string | null
    note: string | null; engagementRate: number | null; updatedAt: string
  } | null
  createdAt: string; updatedAt: string
}
interface GallerySummary { total: number; produced: number; withResults: number; totalViews: number; totalLikes: number; totalSalesThb: number }
```

## 4. วงจรเรียนรู้ — ผลตอบรับ → research

`POST /campaigns/:id/research` (marketer.ts `startResearch`) แนบบล็อกเพิ่มใน message ของ agent:

```
【ผลตอบรับจริงจากคลิปที่โพสต์แล้ว (Evidence — ผู้ใช้กรอกเองจากแพลตฟอร์มต้นทาง)】
- creative #12 (ugc / tiktok): 125,000 views · engagement 6.4% · ยอดขาย 8,900 THB · โพสต์ 2026-09-28
- creative #13 (before_after / tiktok): 30,100 views · engagement 3.1% · ยอดขาย 1,250 THB
```

- มีผลตอบรับอย่างน้อย 1 รายการเท่านั้นถึงแนบ (ไม่มี = message เดิมเป๊ะ ไม่กระทบ test/snapshot อื่น)
- ห้ามเขียนสรุปแทน — ปล่อยให้ agent ตีความเอง (คงแนว Evidence/Assumption เดิม)

## 5. การแบ่งงาน / ไฟล์ที่แตะ

| ฝั่ง | ไฟล์ |
|---|---|
| Backend | `db/sqlite-schema.ts` (v16) · `db/schema.ts` (creativeResults) · `services/gallery.ts` (ใหม่) · `routes/gallery.ts` (ใหม่) · `index.ts` (mount) · `services/marketer.ts` (startResearch แนบ evidence + deleteCreative เก็บกวาด result) · `tests/gallery.test.ts` + `tests/gallery-structure.test.mjs` |
| Frontend | `composables/useApi.ts` (galleryAPI) · `views/marketer/gallery.vue` (ใหม่) · `pages/marketer.vue` (ปุ่มเข้าคลัง) · `nuxt.config.ts` (route `/marketer/gallery` ก่อน `/marketer/:id`) · `locales/th.json` + `en.json` (`marketer.gallery.*`) · `tests/marketer-gallery-structure.test.mjs` |

กติกาเดิมครบ: pure CSS · camelCase · i18n th/en parity · ไม่ commit/push · production 5679 ห้าม kill (dev PORT=5680)

## Notes (implement 2026-10-05)

- **สถานะ**: เสร็จครบ — backend tests 9/9 (migration 13 apply จริง + upsert/validation/evidence block) + typecheck ผ่าน · frontend tests **113/113** (รวม `marketer-gallery-structure.test.mjs` ใหม่ 6 cases) ผ่าน · `npm run generate` ผ่าน
- **Smoke test E2E จริง** (PORT=5681, SQLite ชั่วคราว + seed script `tests/gallery-seed.ts`): GET /gallery ครบ (กรอง draft/soft-delete ถูกต้อง) · PUT result สร้าง/แก้/ปัด salesThb 2 ตำแหน่ง · validation ครบ (400 `E_INVALID_FIELD`, creative ไม่มีจริง → 404) · DELETE ผ่าน · UI: เปิด dialog จากหน้า, ค่าเดิมโหลด prefill, แก้ views → save → toast + แถว + summary อัปเดตทันทีและ persist ฝั่ง server
- **บั๊กที่จับได้ระหว่าง E2E (สำคัญ — มี regression test แล้ว)**: `marketer.gallery.dialog.urlPlaceholder` เดิมใส่ `https://www.tiktok.com/@shop/...` — **`@` ตามด้วยตัวอักษรคือ linked-message ของ vue-i18n → compiler โยน SyntaxError ตอน render → ทั้ง page ถล่ม** (main เหลือ `<!---->`); แก้ด้วย `{'@'}` ตามธรรมเนียมเดิม (episode.sb.videoPromptPlaceholder) และเพิ่ม test สแกน `@[\w\u0E00-\u0E7F]` ในทุก message ของ th/en (`@{name}` ใน key เดิมปลอดภัย — ตามด้วย `{}`)
- **dramaId มาจาก campaign** (ไม่ใช่ตาราง episodes) — produce ครั้งแรกผูก drama ไว้ที่ campaign อยู่แล้ว จึงใช้เข้า `/drama/:dramaId/episode/:n` ตรงจาก gallery
- ประสบการณ์ทดสอบ: IAB (in-app browser) มี occlusion flakiness — screenshot/click actionability ค้างเมื่อ pane ถูกบัง; ใช้ `page.evaluate` คลิกแบบ programmatic + รวม flow เป็น cell เดียวแก้ได้ ไม่เกี่ยวกับโค้ดแอป
- **research evidence ยังไม่ทดสอบกับ LLM จริง** (เครื่องไม่มี text config) — unit test ครอบรูปแบบบล็อกแล้ว; กด research จริงครั้งแรกให้สังเกตว่า agent อ้าง "ผลตอบรับจริง" ใน product_brief/market_research
