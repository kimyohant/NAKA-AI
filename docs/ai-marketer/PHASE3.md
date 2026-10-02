# AI Marketer — Phase 3: Recreate Viral Ad + Product Visuals

อ่านคู่กับ [`PLAN.md`](PLAN.md) (contract Phase 1–2 ยังใช้ทั้งหมด — Phase 3 เป็นของ **เพิ่ม** เท่านั้น ห้ามเปลี่ยน shape/endpoint เดิม)
Base: `master` @ `8de5861` (migration ล่าสุด = v8)

## 1. เป้าหมาย

| ฟีเจอร์ | ผู้ใช้ทำอะไร | ได้อะไร |
|---|---|---|
| **A. Recreate Viral Ad** | วางโฆษณาที่กำลังดัง (ลิงก์ + บทพูด/คำบรรยายฉาก ที่ผู้ใช้ถอดเอง) | AI แยกโครงสร้าง (hook → beats → CTA, จังหวะ, เหตุผลที่ได้ผล) แล้วเขียน creative ใหม่ให้สินค้าเรา **ตามโครงเดียวกัน** (ไม่ลอกถ้อยคำ) |
| **B. Product Visuals** | เลือกรูปสินค้าจริง 1 รูป → เลือกชนิดภาพ | ภาพสินค้าใหม่ 1–4 ภาพ: packshot พื้นขาว, นายแบบ/นางแบบถือ/ใช้สินค้า, ภาพ lifestyle — เลือกภาพที่ชอบ "ใช้เป็นรูปสินค้า" → ไหลเข้า prop reference ตอน produce อัตโนมัติ (กลไกเดิม) |

ข้อจำกัดที่ต้องรู้ (เขียนไว้ใน UI ด้วย):
- **ไม่มีการดึงวิดีโอจาก TikTok/IG/YouTube** — ลิงก์เก็บไว้อ้างอิงเท่านั้น เนื้อหาที่ AI วิเคราะห์มาจาก `transcript` ที่ผู้ใช้วาง
- **"ลบพื้นหลัง" = ให้โมเดลรูปสร้าง packshot พื้นขาวใหม่โดยใช้รูปจริงเป็น reference** ไม่ใช่การตัดภาพระดับพิกเซล (ไม่มี matting model ในระบบ) — UI ใช้คำว่า "Packshot พื้นขาว" ไม่ใช้ "ลบพื้นหลัง"
- ไม่มี TTS/เสียง (ระบบเสียงถูกถอดออกโดยตั้งใจ — มี test `remove-audio-tts-structure` กันอยู่ ห้ามแตะ)

## 2. API Contract (เพิ่มจาก PLAN.md ข้อ 4)

Response helper เดิม `{ code, data, message }` / error `{ code, message, errorCode? }` · JSON camelCase · base `/api/v1/campaigns`

### Data shapes ใหม่

```ts
type AdReferenceStatus = 'draft' | 'analyzed'
interface AdReference {
  id: number; campaignId: number
  title: string                    // ชื่อสั้นๆ ให้ผู้ใช้จำได้ (default: โดเมนของ sourceUrl หรือ "Reference #n")
  sourceUrl: string | null         // เก็บอ้างอิงเท่านั้น — backend ไม่ดึงเนื้อหาวิดีโอ
  transcript: string               // บทพูด/คำบรรยายฉากที่ผู้ใช้วาง (ต้องไม่ว่าง, ≤ 20,000 ตัวอักษร)
  notes: string | null             // ทำไมชอบชิ้นนี้ / ยอดวิว ฯลฯ
  analysis: string | null          // markdown จาก agent (ดูหัวข้อบังคับข้อ 3)
  status: AdReferenceStatus        // analyzed เมื่อ analysis ไม่ว่าง
  createdAt: string; updatedAt: string
}

type VisualKind = 'packshot' | 'on_model' | 'lifestyle'
type VisualStatus = 'processing' | 'completed' | 'failed'
interface CampaignVisual {
  id: number; campaignId: number
  kind: VisualKind
  sourceImage: string              // /static/... ต้องเป็นหนึ่งใน campaign.productImages ตอนสั่ง
  instruction: string | null       // คำสั่งเพิ่มของผู้ใช้ เช่น "ผู้หญิงไทยวัย 25 ในคาเฟ่"
  prompt: string                   // prompt จริงที่ส่งโมเดล (แสดงให้ดูได้)
  taskId: number                   // sys_task.id
  status: VisualStatus             // อ่านสดจาก sys_task (queued/processing → processing; unknown → failed)
  imageUrl: string | null          // /static/... เมื่อ completed
  errorMsg: string | null
  promoted: boolean                // imageUrl อยู่ใน campaign.productImages แล้วหรือยัง
  createdAt: string; updatedAt: string
}
```

ส่วนขยายของ shape เดิม (additive):
- `GET /:id` คืนเพิ่ม `references: AdReference[]` (ใหม่→เก่า) และ `visuals: CampaignVisual[]` (ใหม่→เก่า)
- `Creative` เพิ่ม `referenceId: number | null` — creative ที่สร้างจากโหมด recreate

### Endpoints ใหม่

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/:id/references` | `{ transcript, sourceUrl?, title?, notes? }` | `AdReference` (`draft`) |
| PUT | `/:id/references/:rid` | `Partial<{ title, sourceUrl, transcript, notes, analysis }>` | `AdReference` — แก้ `transcript` ⇒ ล้าง `analysis` กลับเป็น `draft` |
| DELETE | `/:id/references/:rid` | — | hard delete · creative ที่อ้างถึงคง `referenceId` เดิมไว้ได้ (ไม่ cascade) |
| POST | `/:id/references/:rid/analyze` | — | `AdReference` (`analyzed`) — **sync** แบบเดียวกับ `docs/:docId/revise` |
| POST | `/:id/creatives/generate` | เดิม + `referenceId?: number` | `202` เหมือนเดิม — มี `referenceId` ⇒ ad_scriptwriter เขียนทุก creative ตามโครงของ reference นั้น และบันทึก `referenceId` ลง creative |
| POST | `/:id/visuals/generate` | `{ kind, sourceImage, count?: 1–4 (default 2), instruction? }` | `CampaignVisual[]` (สถานะ `processing`) — สร้าง sys_task image `count` งาน |
| DELETE | `/:id/visuals/:vid` | — | ลบ row (ไม่ลบไฟล์, ไม่ลบออกจาก productImages) |
| POST | `/:id/visuals/:vid/promote` | — | `Campaign` — ต่อท้าย `imageUrl` เข้า `productImages` (ไม่ซ้ำ) |

Guards / error codes ใหม่ (frontend แปลใน `errors.codes.*`):
- `E_REFERENCE_NOT_ANALYZED` — generate ด้วย `referenceId` ที่ยังไม่ `analyzed` (หรือไม่ใช่ของ campaign นี้)
- `E_VISUAL_NOT_READY` — promote visual ที่ยังไม่ `completed`
- ใช้รหัสเดิม: `E_INVALID_FIELD` (kind/count/sourceImage ไม่อยู่ใน productImages/transcript ว่างหรือยาวเกิน), `E_NO_TEXT_MODEL` (analyze), `E_NO_IMAGE_MODEL` (visuals), `E_CAMPAIGN_BUSY` (analyze ระหว่าง campaign `*ing`), `E_CREATIVES_NEED_STRATEGY` (guard เดิมของ generate ยังอยู่)

พฤติกรรม async:
- `analyze` sync — frontend แสดง spinner บนการ์ด reference
- visuals **ไม่** เปลี่ยน `campaign.status` และ **ไม่** ติด `E_CAMPAIGN_BUSY` (เป็นงานรูป แยกจากงาน agent) — frontend poll `GET /:id` ทุก 3s ตราบที่มี visual `processing`
- งบ: ถ้า campaign มี `dramaId` แล้ว ส่ง `dramaId` ให้ `generateImage` เพื่อให้ budget guard เดิมทำงาน; ถ้ายังไม่มี drama ไม่มี budget guard (ระบุใน UI ว่าค่าใช้จ่ายนับเมื่อ produce แล้วเท่านั้น)

## 3. รูปแบบ `analysis` (บังคับหัวข้อ — frontend render ด้วย renderer markdown เดิม)

```
## Hook (0–3s)          ประเภท hook + ถ้อยคำ/ภาพที่ใช้
## Structure            ตาราง beat: เวลา | หน้าที่ (hook/problem/demo/proof/offer/CTA) | สิ่งที่เกิดขึ้น
## Pacing & Format      ความยาว, จำนวนช็อต/ฉากโดยประมาณ, UGC/สตูดิโอ, มีคนพูดกล้องไหม
## Persuasion Levers    เหตุผลที่ได้ผล (social proof, scarcity, before/after ...)
## CTA                  รูปแบบ CTA
## Reuse Template       โครงที่เอาไปใช้กับสินค้าอื่นได้ เขียนเป็นช่องว่างให้เติม — ห้ามคัดลอกถ้อยคำต้นฉบับยาวเกิน 1 ประโยค
```

## 4. DB — migration v9 (Agent A)

- ตาราง `campaign_ad_references` (id, campaign_id, title, source_url, transcript, notes, analysis, created_at, updated_at)
- ตาราง `campaign_visuals` (id, campaign_id, kind, source_image, instruction, prompt, task_id, created_at, updated_at) — status/imageUrl/errorMsg **อ่านจาก sys_task** ไม่เก็บซ้ำ
- `campaign_creatives.reference_id INTEGER NULL`

## 5. การแบ่งงาน

| | Agent A — Backend | Agent B — Frontend |
|---|---|---|
| เจ้าของไฟล์ | `backend/**` + `docs/ai-marketer/PHASE3.md` ส่วน "Notes from Agent A" | `frontend/**` + ส่วน "Notes from Agent B" |
| ห้ามแตะ | `frontend/**` | `backend/**` |
| Branch | `feat/p3-backend` | `feat/p3-frontend` |
| Brief | [`AGENT-A-phase3.md`](AGENT-A-phase3.md) | [`AGENT-B-phase3.md`](AGENT-B-phase3.md) |

กติการ่วม (เปลี่ยนจาก Phase 1 — อ่านให้ครบ):
- **แยก worktree ของตัวเองเสมอ** — ห้ามสลับ branch ในโฟลเดอร์ที่ agent อื่นใช้อยู่:
  `git fetch origin && git worktree add ../naka-p3-<a|b> -b feat/p3-<backend|frontend> origin/master`
- commit เป็นระยะได้ และ **push branch ของตัวเอง** เมื่อเสร็จ — ห้าม push/merge เข้า `master` (ผู้ประสานงานจะ integrate เอง)
- Contract ข้อ 2–3 คือสัญญา — ถ้าจำเป็นต้องเปลี่ยน ให้เขียนลงส่วน Notes ของตัวเองใน PHASE3.md พร้อมเหตุผล (additive เท่านั้น) อย่าแก้ข้อ 2–3 โดยตรง
- ห้าม kill server ที่ `127.0.0.1:5679` · backend dev ใช้ `PORT=5680` · ห้ามรัน workflow ที่ใช้ key จริงกับ `data/naka.sqlite3` (ใช้ `SQLITE_PATH` ชี้ DB ทดสอบ)
- เขียนให้เหมือนโค้ดรอบข้าง (comment จีน/อังกฤษ/ไทยแบบไฟล์นั้นๆ, ไม่มี UI framework, ไม่เพิ่ม dependency)
- error ทุกตัวต้องมี `errorCode` และ async failure ใช้รูปแบบ `"E_CODE: message"` เดิม

---

## Notes from Agent A (backend)

### สิ่งที่ทำ (branch `feat/p3-backend`)

**ไฟล์ที่แก้/เพิ่ม:**
- `backend/src/db/sqlite-schema.ts` — migration v9: ตาราง `campaign_ad_references` + `campaign_visuals` + คอลัมน์ `campaign_creatives.reference_id`
- `backend/src/db/schema.ts` — Drizzle: `campaignAdReferences`, `campaignVisuals`, `campaignCreatives.referenceId`
- `backend/src/services/marketer.ts` — references CRUD/analyze, visuals generate/delete/promote, `startCreatives` รับ `referenceId`
- `backend/src/routes/campaigns.ts` — endpoints ใหม่ 8 เส้นตาม PHASE3 ข้อ 2
- `backend/src/agents/tools/marketer-tools.ts` — tool `save_reference_analysis` + `save_creatives` บันทึก `reference_id` จาก request context
- `backend/src/agents/context.ts` — `CampaignRequestContextValues.referenceId`
- `backend/src/agents/index.ts` + `skills.ts` — agent `ad_analyst` (DEFAULT_PROMPTS + AGENT_TOOLS + AGENT_SKILL_MAP)
- `backend/workspace/prompts/ad_analyst{,.en}.md`, `workspace/skills/ad-analyst/SKILL{,.en}.md` — หัวข้อบังคับ 6 อัน + กฎห้ามลอกเกิน 1 ประโยค + ห้ามเดาเมื่อ transcript ไม่พอ
- `backend/workspace/prompts/ad_scriptwriter{,.en}.md` + `workspace/skills/ad-scriptwriter/SKILL{,.en}.md` — เพิ่มหัวข้อ Recreate mode
- `backend/tests/campaigns-migration.test.ts`, `tests/sqlite-migration-backup.test.ts` — expected migrations [1..9] + assert ตาราง/คอลัมน์ v9
- `backend/tests/campaigns-phase3-structure.test.mjs` (ใหม่) — 4 tests ครอบ routes/error codes/ad_analyst/visuals

**Endpoints ที่ทดสอบด้วย curl จริง (PORT=5680 + scratch DB):**
- references: create (title default = โดเมน ✓, transcript ว่าง → E_INVALID_FIELD ✓, >20,000 ตัวอักษร → E_INVALID_FIELD ✓, sourceUrl ftp → E_INVALID_FIELD ✓), PUT (แก้ transcript ⇒ analysis ล้างกลับ draft ✓), DELETE ✓ (analyze ของ id ที่ลบแล้ว → 404 ✓)
- analyze: E_NO_TEXT_MODEL ✓, ระหว่าง campaign *ing → E_CAMPAIGN_BUSY ✓, sync error path คืน 400 พร้อม message และไม่มี analysis ค้าง ✓
- visuals: E_NO_IMAGE_MODEL ✓, kind ผิด → E_INVALID_FIELD ✓, sourceImage ไม่อยู่ใน productImages → E_INVALID_FIELD ✓, generate กับ dummy image config สร้าง sys_task 2 งาน (status processing → failed อ่านสดจาก sys_task ✓, imageUrl/errorMsg/promoted ถูกต้อง ✓), promote ก่อน completed → E_VISUAL_NOT_READY ✓, DELETE row ✓
- creatives/generate: referenceId ยังไม่ analyzed → E_REFERENCE_NOT_ANALYZED ✓, analyzed แล้ว → 202 (message มีบล็อก 【Reference ad structure】 + referenceId ถูกส่งเข้า RC ให้ save_creatives บันทึก)

**ข้อแตกต่างจาก contract: ไม่มี** (ส่วนเพิ่มเติมเชิงอธิบาย: `visual.imageUrl` ใช้ `sys_task.localPath` ปรับ leading-slash ให้ตรงรูปแบบ `/static/...` ของ productImages เพราะ `resultUrl` เป็น URL ผู้ให้บริการที่อาจหมดอายุ; `promoted` เทียบแบบ insensitive ต่อ leading slash)

**ยังไม่ได้ทดสอบกับของจริง:** agent analyze จริง + การ gen รูปจริง (ต้องมี text/image key — ทดสอบถึง error path ด้วย dummy config เช่นเดิม)

## Notes from Agent B (frontend)

_(Agent B เขียนที่นี่)_
