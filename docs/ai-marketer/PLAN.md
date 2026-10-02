# AI Marketer — Gap Analysis & Implementation Plan

Reference: https://www.topview.ai/ai-marketer (+ https://www.topview.ai/mcp)
Target: เพิ่มโมดูล "AI Marketer" ใน NAKA Drama Studio โดย **reuse pipeline เดิม** (extract → storyboard → image/video gen → FFmpeg merge)

---

## 1. Topview AI Marketer flow (สรุป)

```
[1 Describe goal]          product URL / images / brand assets / market / audience / platform / goal
        ↓
[2 Market Research]        ดึงสัญญาณจาก TikTok Shop, Amazon, Shopee, YouTube
                           → Category Opportunity, Trending Products, Competitor Scan,
                             Listing & Reviews, Review Insights, Search Terms, ROAS Analysis
        ↓  (ผู้ใช้ review)
[3 Strategy] 4 เอกสาร      Audience Insight · Message Map · Campaign Plan · Content Brief
        ↓  (ผู้ใช้ review / สั่งแก้แบบ controlled revision)
[4 Production]             storyboard, product visuals, model images, bg removal,
                           UGC-style video, ad edits, music, TTS/voice, URL-to-video,
                           Recreate Viral Ads, หลาย creative variations, platform variants
                           บน infinite canvas
        ↓
[5 Review · Refine · Reuse]  project context / brand context ใช้ซ้ำได้ — ไม่ auto-publish
```

ตัวแบ่ง role ภายใน: **Market Researcher → Strategist → Producer** (+ "Experts Market", "Skills")

## 2. เทียบกับระบบเรา

| ขั้น | Topview | NAKA (ตอนนี้) | สถานะ |
|---|---|---|---|
| Input | Product URL, รูปสินค้า, brand assets, goal, platform | นิยาย/ข้อความ, style, aspect ratio | ❌ ต้องเพิ่ม |
| Market research | Commerce data (TikTok Shop/Amazon/Shopee) | ไม่มี | ❌ Phase 1 = LLM + ข้อมูลจากหน้าสินค้า + ข้อมูลที่ผู้ใช้วาง; Phase 2 = data connectors |
| Strategy docs | Audience Insight, Message Map, Campaign Plan, Content Brief | ไม่มี | ❌ ต้องเพิ่ม |
| Ad script | Hook/UGC script หลายแบบ | `script_rewriter` (บทละคร) | 🟡 ต้องมี agent เขียนสคริปต์โฆษณา (hook 0–3s, CTA) |
| Asset extraction | — | `extractor` (ตัวละคร/ฉาก/พร็อพ) | ✅ reuse (สินค้า = prop) |
| Storyboard | ✅ | `storyboard_breaker` | ✅ reuse |
| Image gen | product visuals, model image, bg removal | OpenAI/Gemini/Volcengine/Qwen | 🟡 ขาด bg removal, product-on-model |
| Video gen | Seedance, Kling, Veo… | Seedance, MiniMax, Wan | ✅ |
| UGC avatar / lip-sync | ✅ | ไม่มี | ❌ Phase 2 |
| Voice / TTS / Music | ✅ | ไม่มี | ❌ Phase 2 |
| Creative variations / A-B | ✅ หลายเวอร์ชัน | 1 episode = 1 เวอร์ชัน | ❌ Phase 1 (หลาย creative → หลาย episode) |
| Platform variants (9:16/1:1/16:9) | ✅ | aspect ratio ล็อกต่อ drama | 🟡 Phase 2 |
| Recreate viral ad | ✅ | ไม่มี | ❌ Phase 2 |
| Canvas | infinite canvas | workbench แบบ linear | ➖ ไม่ทำ (ใช้ workbench เดิม) |
| Review / approve | ✅ | บางส่วน | 🟡 เพิ่ม approve/revise ต่อเอกสาร |
| Merge / export | export | FFmpeg merge + export health | ✅ ได้เปรียบ |
| Cost control | credits | budget THB ต่อโปรเจกต์ | ✅ ได้เปรียบ |

**จุดขายของเรา:** self-hosted, เลือก provider/model เองได้, budget control, pipeline ผลิตวิดีโอครบถึง merge — ขาดแค่ "ส่วนหัว" (research + strategy + ad script) ซึ่งเป็น Phase 1

## 3. Phase 1 Scope (งานที่แบ่งให้ 2 agents)

```
Campaign (ใหม่)                                         Pipeline เดิม (reuse)
 brief ─► research ─► strategy(4 docs) ─► creatives ─► [produce] ─► drama + episode
                                                                      ─► extract → storyboard → image → video → merge
```

- 1 campaign ผูกกับ 1 drama (สร้างอัตโนมัติตอน produce ครั้งแรก, ใช้ `style` + `aspect_ratio` ของ campaign)
- 1 creative ที่ approve → 1 episode (`script_content` = สคริปต์โฆษณาในรูปแบบ formatted script เดิม: `## S1 | 内景/外景 · 地点 | 时间段` ฯลฯ — ให้ extractor/storyboard_breaker ทำงานต่อได้ทันที)
- Research ใน Phase 1 **ไม่มี** marketplace data จริง → agent ต้องแยก `evidence` (จากหน้าสินค้า/ข้อมูลผู้ใช้) กับ `assumption` (ความรู้ของโมเดล) ให้ชัดในเอกสาร
- ภาษา UI: th + en (ไฟล์ `frontend/app/locales/th.json`, `en.json`); ภาษาเนื้อหา AI ใช้ content language เดิมของระบบ

Out of scope Phase 1: TTS/music, UGC avatar/lip-sync, viral ad recreation, data connectors, multi-aspect variants, canvas

## 4. API Contract (สัญญากลาง — ห้ามเปลี่ยนโดยไม่แจ้งอีกฝั่ง)

Response ใช้ helper เดิม: `{ code, data, message }` / error `{ code, message, errorCode? }`

### Data shapes (camelCase ใน JSON)

```ts
type CampaignStatus = 'draft' | 'researching' | 'research_ready' | 'strategizing' | 'strategy_ready'
                    | 'writing' | 'creatives_ready' | 'failed'
type DocKind = 'product_brief' | 'market_research' | 'audience_insight' | 'message_map' | 'campaign_plan' | 'content_brief'
type Platform = 'tiktok' | 'reels' | 'youtube_shorts' | 'facebook' | 'shopee' | 'lazada'
type CreativeFormat = 'ugc' | 'product_demo' | 'problem_solution' | 'before_after' | 'testimonial' | 'unboxing'

interface Campaign {
  id: number; title: string
  productUrl: string | null; productName: string; productDescription: string | null
  productImages: string[]          // /static/... paths
  brandNotes: string | null        // tone, ห้ามพูด, USP ฯลฯ
  market: string                   // 'TH' default
  platforms: Platform[]; audience: string | null; goal: string | null
  style: string; aspectRatio: '9:16' | '16:9' | '1:1'
  status: CampaignStatus; errorMsg: string | null
  dramaId: number | null
  createdAt: string; updatedAt: string
}
interface CampaignDoc {
  id: number; campaignId: number; kind: DocKind
  content: string                  // markdown
  status: 'draft' | 'approved'; version: number
  createdAt: string; updatedAt: string
}
interface Creative {
  id: number; campaignId: number
  angle: string; hook: string; format: CreativeFormat; platform: Platform
  durationSec: number; cta: string | null
  script: string                   // formatted script (ป้อนเข้า episode.scriptContent ได้ตรงๆ)
  status: 'draft' | 'approved' | 'in_production'
  episodeId: number | null; episodeNumber: number | null
  createdAt: string; updatedAt: string
}
```

### Endpoints — `/api/v1/campaigns`

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/` | — | `Campaign[]` |
| POST | `/` | `Partial<Campaign>` (ต้องมี `productName` หรือ `productUrl`) | `Campaign` |
| GET | `/:id` | — | `Campaign & { docs: CampaignDoc[]; creatives: Creative[] }` |
| PUT | `/:id` | `Partial<Campaign>` | `Campaign` |
| DELETE | `/:id` | — | soft delete |
| POST | `/ingest-url` | `{ url }` | `{ productName, productDescription, price, brand, images: string[] }` (ดาวน์โหลดรูปลง storage แล้วคืน `/static/...`) |
| POST | `/:id/research` | `{ notes? }` (ข้อมูลคู่แข่ง/รีวิวที่ผู้ใช้วาง) | `202 { status: 'researching' }` — async; สร้าง/อัปเดต doc `product_brief` + `market_research` → status `research_ready` |
| POST | `/:id/strategy` | — | `202` async → 4 docs (`audience_insight`, `message_map`, `campaign_plan`, `content_brief`) → `strategy_ready` |
| PUT | `/:id/docs/:docId` | `{ content?, status? }` | `CampaignDoc` (แก้ content = version+1) |
| POST | `/:id/docs/:docId/revise` | `{ instruction }` | `CampaignDoc` (sync, ให้ agent แก้ตามคำสั่ง) |
| POST | `/:id/creatives/generate` | `{ count (1–10), formats?: CreativeFormat[], platforms?: Platform[] }` | `202` async → status `writing` → `creatives_ready` |
| PUT | `/:id/creatives/:cid` | `Partial<Creative>` | `Creative` |
| DELETE | `/:id/creatives/:cid` | — | hard delete (เฉพาะที่ยังไม่ produce) |
| POST | `/:id/creatives/:cid/produce` | — | `{ dramaId, episodeNumber }` — สร้าง drama (ถ้ายังไม่มี) + episode ใหม่จาก `script` แล้ว frontend `navigateTo('/drama/:dramaId/episode/:episodeNumber')` |

Async: frontend poll `GET /campaigns/:id` ทุก 2s ขณะ status ลงท้าย `-ing`; error → `status: 'failed'` + `errorMsg`
Error codes ใหม่ (frontend แปลใน `errors.codes.*`): `E_CAMPAIGN_BUSY`, `E_INGEST_FAILED`, `E_STRATEGY_NEEDS_RESEARCH`, `E_CREATIVES_NEED_STRATEGY` (+ `E_NO_TEXT_MODEL` เดิม)

## 5. การแบ่งงาน

| | Agent A — Backend | Agent B — Frontend |
|---|---|---|
| เป็นเจ้าของไฟล์ | `backend/**` | `frontend/**` |
| ห้ามแตะ | `frontend/**` | `backend/**` |
| Brief | [`AGENT-A-backend.md`](AGENT-A-backend.md) | [`AGENT-B-frontend.md`](AGENT-B-frontend.md) |

ทั้งสองฝั่งทำงานขนานกันได้ทันทีเพราะยึด contract ในข้อ 4 — ถ้าต้องเปลี่ยน contract ให้แก้ไฟล์นี้และแจ้งอีกฝั่ง

กติการ่วม:
- อย่า commit / push (ผู้ใช้จะ review เอง) — ทำงานบน working tree เดิม
- Production server รันอยู่ที่ `127.0.0.1:5679` อย่า kill — dev ใช้ port อื่น (backend `PORT=5680`)
- ตาม CLAUDE.md: เขียนให้เหมือนโค้ดรอบข้าง (comment ภาษาจีน/อังกฤษแบบเดิม, ไม่มี UI framework)

---

## Notes from Agent A (backend)

Contract ข้อ 4 ถูก implement ครบตามตัวสัญญา — หมายเหตุเพิ่มเติม (additive, ไม่เปลี่ยนของเดิม):

- **Validation errors** ใช้รหัสเพิ่มเติมนอกเหนือจาก 4 รหัสในสัญญา: `E_INVALID_FIELD` (body ไม่ถูกต้อง เช่น aspectRatio/platforms/formats/count), `E_CREATIVE_IN_PRODUCTION` (ลบ creative ที่ produce แล้ว), `E_AGENT_UNAVAILABLE` — frontend ไม่มี translate ก็ fallback เป็น message ได้
- **ลำดับ guard**: `strategy`/`creatives` ตรวจ state (busy → doc ครบไหม) ก่อนแล้วค่อยตรวจ text model → งานที่ยังไม่มี doc เห็น `E_STRATEGY_NEEDS_RESEARCH` / `E_CREATIVES_NEED_STRATEGY` แม้ยังไม่ได้ตั้งค่า model
- **Busy เป็นระดับ campaign**: งานหนึ่ง ๆ (research/strategy/creatives) วิ่งพร้อมกันได้แค่ 1 งานต่อ 1 campaign — งานอื่นที่ยิงระหว่างวิ่งจะโดน `E_CAMPAIGN_BUSY` เหมือนกัน (state จริงอยู่ใน `pipeline_tasks`, campaign.status คือสิ่งที่ frontend poll)
- **`creatives/generate`**: `count` เว้นว่างได้ (default 3) · regenerate จะ **แทนที่เฉพาะ creative ที่ยัง `draft`** (approved/in_production ถูกเก็บไว้)
- **produce idempotent**: เรียกซ้ำกับ creative เดิมคืน `{ dramaId, episodeNumber }` เดิม · episode ใหม่ไม่ล็อก image/video config (ต่างจาก POST /episodes) — ผู้ใช้ไปตั้งต่อที่หน้า episode ได้
- **ingest-url**: images คืนเป็น `/static/products/<uuid>.<ext>` (มี leading slash ตามสัญญา) · ถ้าดึงภาพไม่ได้จะคืน `images: []` และ endpoint ยังสำเร็จ · SSRF ป้องกันครบ (http/https เท่านั้น, บล็อก private/loopback/link-local รวมถึงตอน DNS resolve จริงตอน connect, timeout, จำกัดขนาด response)
- **`GET /campaigns/:id`** หลัง soft delete จะ 404 · campaign ที่ค้าง status `*ing` ตอน restart server จะถูกเคลียร์เป็น `failed` ตอน boot
- **รูปสินค้าจริง → prop reference** (เพิ่มภายหลัง): ตอน `produce` ถ้า campaign มี `productImages` ระบบจะสร้าง prop ชื่อ = `productName` (type `product`) พร้อมแปะรูปสินค้าจริงลง `props.reference_images` และ link เข้า episode ที่สร้าง — การ gen รูป prop (`POST /props/:id/generate-image`) จะส่งรูปพวกนี้เป็น reference ให้ adapter ทำให้ภาพ/วิดีโอใช้สินค้าตัวจริง · extractor (save_dedup_props) จะ merge กับ prop นี้ตามชื่อโดยไม่ลบ reference_images ดังนั้น ad scriptwriter ถูกกำกับให้เขียนชื่อสินค้าตรงกับ Product field พอดี · produce ซ้ำ/หลาย creative ใน drama เดียวไม่สร้าง prop ซ้ำ
- **เพิ่มภายหลัง (round 3):**
  - `POST /:id/research` เก็บ `notes` ลง `campaign.researchNotes` (คงค่าเดิมไว้ถ้าไม่ส่งมา) — อ่านย้อนได้จาก campaign JSON และ research ครั้งถัดไปใช้ notes เดิมอัตโนมัติ ถ้าไม่ส่ง `notes` ใหม่
  - `POST /:id/creatives/generate` รับ `mode` เพิ่ม: `'replace'` (default, ทำงานเดิม — ทับ draft เก่า) หรือ `'append'` (คง creative เดิมทั้งหมด แล้วเพิ่ม N ตัวใหม่ที่ angle ไม่ซ้ำ)
  - `GET /:id/docs/:docId/revisions` ใหม่ (additive): ประวัติเนื้อหาเอกสารก่อนถูกทับ — ทั้งจาก agent revise (`source: 'agent'`) และแก้มือผ่าน PUT (`source: 'manual'`) เรียง version มาก→น้อย; กู้คืน = PUT เนื้อหาเก่ากลับเข้าไป (version ไต่ขึ้นตามปกติ)
  - Migration v7: เพิ่มคอลัมน์ `campaigns.research_notes` + ตาราง `campaign_doc_revisions` (apply อัตโนมัติตอน boot)
  - เก็บกวาด structure test เก่า 14 ตัวที่ค้างจาก refactor ก่อนหน้า (ข้อความ error จีน, MySQL→SQLite, MiniMax video กลับมา, resolution 1080p, ไม่ auto-clear finalPrompt, ส่วนผสานแบบบางส่วน) — suite เขียว 100% แล้ว
- **เพิ่มภายหลัง (round 4):**
  - `POST /:id/docs/:docId/revisions/:revId/restore` (additive): กู้คืนเนื้อหาจาก revision — เนื้อหาปัจจุบันถูก snapshot ไว้ก่อนเสมอ (`source: 'manual'`) และ version ไต่ +1 ทุกครั้ง
  - Campaign รับ `budgetThb` (THB, 0-100,000,000, ปัด 2 ตำแหน่ง — เกณฑ์เดียวกับ dramas) และตอน produce สร้าง drama ใหม่จะส่ง `budget_thb` ให้โปรเจกต์ด้วย → งบเดิมจับใช้ได้ทันทีในหน้า budget
  - `GET /campaigns` รับ `?status=` และ `?drama_id=` filter ได้
  - Migration v8: คอลัมน์ `campaigns.budget_thb` (apply อัตโนมัติตอน boot)
