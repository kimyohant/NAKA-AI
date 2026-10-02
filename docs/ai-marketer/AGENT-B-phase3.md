# Agent B — Frontend: AI Marketer Phase 3

อ่านก่อน: `CLAUDE.md`, `docs/ai-marketer/PLAN.md` (ข้อ 4), **`docs/ai-marketer/PHASE3.md` (ข้อ 1–3 คือสัญญา — ยิง API ตามนั้นเท่านั้น)**
เจ้าของไฟล์: `frontend/**` เท่านั้น — **ห้ามแก้ `backend/**`** (Agent A ทำ API ขนานกัน)

## Setup

```
git fetch origin
git worktree add ../naka-p3-b -b feat/p3-frontend origin/master
cd ../naka-p3-b/frontend && npm ci
```
ทำงานใน `../naka-p3-b` เท่านั้น · dev: `npm run dev` (port 3013, proxy ไป 5679) — ถ้าต้องชี้ backend ของ Agent A ให้ตั้ง proxy ไป 5680 ชั่วคราวใน dev เท่านั้น

## Tasks

1. **API client** — `app/composables/useApi.ts` ใน `marketerAPI` เดิม: เพิ่ม types `AdReference`, `CampaignVisual` + `Creative.referenceId` + `CampaignDetail.references/visuals`
   และเมธอดครบทุก endpoint ใหม่ใน PHASE3 ข้อ 2 · `generateCreatives` รับ `referenceId?`

2. **Recreate Viral Ad** — ในขั้น Creatives ของ `app/views/marketer/campaign.vue` (แยก component ใหม่ เช่น `MarketerReferencePanel.vue` / `MarketerReferenceCard.vue` ไม่ยัดเพิ่มใน campaign.vue ที่ยาว 1,000+ บรรทัดอยู่แล้ว)
   - ฟอร์มเพิ่ม reference: ลิงก์ (optional), ชื่อ, **transcript (required — ช่องใหญ่ พร้อมคำอธิบายว่า "ถอดบทพูด/บรรยายสิ่งที่เห็นในแต่ละช่วงเวลา" และบอกชัดว่าระบบไม่ดึงวิดีโอจากลิงก์)**, notes
   - การ์ด reference: สถานะ draft/analyzed, ปุ่ม "วิเคราะห์โครงสร้าง" (spinner ระหว่าง sync call), แสดง analysis ด้วย renderer เดิม `app/utils/marketerMarkdown.js`, แก้/ลบได้ (แก้ transcript → เตือนว่าผลวิเคราะห์จะถูกล้าง)
   - ปุ่ม "สร้าง creative ตามโครงนี้" บนการ์ดที่ analyzed → เปิดฟอร์ม generate เดิมโดย preset `referenceId` (+ `mode: 'append'` เป็นค่าเริ่ม เพื่อไม่ทับ creative เดิม)
   - `MarketerCreativeCard.vue`: creative ที่มี `referenceId` แสดง badge "ตามโครง: <title ของ reference>"

3. **Product Visuals** — ขั้นใหม่ใน sidebar ถัดจาก Brief: `visuals` (optional — ไม่บล็อกขั้นอื่น, `done` เมื่อมี visual ที่ promoted อย่างน้อย 1)
   แก้ `app/utils/marketerFlow.js` (`MARKETER_STEPS`, `stepDone`) ให้รู้จักขั้นนี้ — ระวัง `busyStep` / `suggestedStep` / `retryTarget` เดิม: visuals ไม่ใช่ campaign status และ `suggestedStep` ห้ามพาผู้ใช้ไปค้างที่ visuals
   - เลือกรูปต้นทางจาก `productImages` (thumbnail grid) → เลือก kind (Packshot พื้นขาว / นายแบบ-นางแบบใช้สินค้า / Lifestyle) → count 1–4 → instruction (placeholder ต่อ kind) → generate
   - แกลเลอรี visuals: processing (skeleton), completed (ภาพ + ปุ่ม "ใช้เป็นรูปสินค้า" → promote / badge "ใช้แล้ว"), failed (errorMsg + ปุ่มลองใหม่ = generate ซ้ำด้วยค่าเดิม), ลบได้, ดู prompt ได้
   - poll `GET /campaigns/:id` ทุก 3s ระหว่างมี visual `processing` — ต้องอยู่ร่วมกับ poll 2s เดิมของ status `*ing` ได้โดยไม่ยิงซ้อน (ใช้ timer เดียว เลือก interval ที่สั้นกว่า)
   - หมายเหตุใต้ฟอร์ม: packshot คือการสร้างภาพใหม่จากรูปจริง ไม่ใช่การตัดพื้นหลังแบบพิกเซล · ค่าใช้จ่ายนับเข้างบโปรเจกต์หลัง produce แล้วเท่านั้น

4. **i18n** — `app/locales/th.json` + `en.json` ครบทั้งสองไฟล์: คีย์ใหม่ใต้ `marketer.references.*`, `marketer.visuals.*`, `marketer.steps.visuals` + `errors.codes.E_REFERENCE_NOT_ANALYZED`, `errors.codes.E_VISUAL_NOT_READY`
   ไม่มี hardcode ข้อความในเทมเพลต (test เดิมจับ)

5. **Style** — CSS variables/คลาสปุ่มเดิม, light/dark theme, mobile (sidebar → rail เดิม), ไม่มี UI framework, ไม่เพิ่ม dependency

6. **Tests** — ต่อ `tests/ai-marketer-structure.test.mjs` (หรือไฟล์ใหม่ `marketer-phase3-*.test.mjs`): เมธอด API ใหม่ครบ, คีย์ i18n ครบทั้ง th/en, ขั้น visuals อยู่ใน flow, ไม่มี mock หลงเหลือ

## Done when
- `npm run generate` ผ่าน · test เดิม + ใหม่ผ่าน (`node --test tests/*.mjs`)
- ถ้า API ของ Agent A ยังไม่พร้อม: mock ได้เฉพาะตอน dev — **ห้ามเหลือ mock ในโค้ดที่ commit**
- เขียน "Notes from Agent B" ใน PHASE3.md: ไฟล์ที่แก้, หน้าจอที่ทำ, สิ่งที่ต้องการจาก backend เพิ่ม (ถ้ามี)
- commit + `git push -u origin feat/p3-frontend` — **ห้าม merge เข้า master**
