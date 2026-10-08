# Agent B — Frontend: Product Studio Phase 2

อ่านก่อน: `CLAUDE.md`, `docs/product-studio/PLAN.md` (+ Notes ของคุณเองรอบก่อน), **`docs/product-studio/PHASE2.md` (ข้อ 1–2 คือสัญญา — ยิง API ตามนั้นเท่านั้น)**
เจ้าของไฟล์: `frontend/**` เท่านั้น — **ห้ามแก้ `backend/**`** (Agent A ทำ API ขนานกัน)

> หมายเหตุจากผู้ประสานงาน: ตอนรวม Phase 1 มีการแก้ใน `workspace.vue`, `pages/studio.vue`, `StudioTemplateCard.vue`, `studioFlow.js` (prefix i18n `productStudio.*` ในคีย์ที่ประกอบด้วย template string, dirty-state snapshot, render-all chain, poll หลัง unmount, อัตราพูดภาษาไทย 12 ตัว/วินาที) — เริ่มจาก `origin/master` ล่าสุดเท่านั้น และอย่าย้อนสิ่งเหล่านี้

## Setup

```
git fetch origin
git worktree add ../naka-studio2-b -b feat/studio2-frontend origin/master
cd ../naka-studio2-b/frontend && npm ci
```

## Tasks

1. **API client** — `studioAPI` เพิ่ม `autoRender(id, { force? })`, `cancelAutoRender(id)`, `fromCampaign({ campaignId, creativeId?, templateId })`, `merge(id, { captions? })` + types ใหม่ใน PHASE2 ข้อ 2 (`autoRender`, `captions`, `captionStyle`, `aiLabelBurnIn`, `sourceCampaignId`, `StudioMerge.captioned/subtitleUrl`)

2. **Auto-render แทน chain ฝั่ง browser** — `app/views/studio/workspace.vue`
   - ปุ่ม "สร้างทั้งหมด" → `autoRender` (มีตัวเลือก "สร้างใหม่ทุกช็อต" = `force`) · **ลบ** logic `autoVideosArmed` / `continueRenderAll` และ banner "ต้องเปิดหน้าไว้" ออก
   - แถบความคืบหน้าจาก `project.autoRender` (stage + done/failed/total, เวลาเริ่ม), ปุ่มยกเลิก, เมื่อ `done` พาไปขั้นส่งออก, `failed` แสดง errorMsg ผ่าน `errors.codes.*`
   - poll 3s ระหว่าง `autoRender.stage` อยู่ใน `keyframes/videos/merging` (timer เดียวเดิม) · ปุ่ม render/merge รายช็อตปิดระหว่าง pipeline วิ่ง
   - หน้า `/studio` (รายการโปรเจกต์) แสดง badge ความคืบหน้าของโปรเจกต์ที่กำลัง auto-render และ poll เฉพาะตอนมีโปรเจกต์วิ่งอยู่

3. **Captions** — ขั้นตั้งค่า: เปิด/ปิดซับ, สไตล์ (`clean/bold/boxed` พร้อมตัวอย่างภาพจำลองด้วย CSS บนกรอบสัดส่วนตาม aspect), `aiLabelBurnIn` · ขั้นส่งออก: สวิตช์ซับก่อนกดต่อวิดีโอ, ปุ่มดาวน์โหลด `.srt` เมื่อมี `subtitleUrl`, badge "มีซับ" บนผลลัพธ์ · ขั้นบท: แสดงว่าช็อตไหนจะไม่มีซับ (ไม่มีทั้ง dialogue และ onScreenText)

4. **Marketer → Studio** — ใน `app/views/marketer/campaign.vue` (หรือ component ลูกที่มีอยู่):
   - ปุ่ม "ทำวิดีโอรีวิว (Product Studio)" ที่ระดับแคมเปญ และบนการ์ด creative (`MarketerCreativeCard.vue`) → dialog เลือกเทมเพลต (reuse `StudioTemplateGallery`) → `fromCampaign` → `navigateTo('/studio/:id')`
   - ใน workspace ถ้ามี `sourceCampaignId` แสดงลิงก์กลับไปแคมเปญ

5. **i18n** — th + en ครบ: `productStudio.autoRender.*`, `productStudio.captions.*`, `productStudio.fromCampaign.*`, `marketer.*` ที่เพิ่ม + `errors.codes.E_STUDIO_CAMPAIGN_NOT_FOUND`, `errors.codes.E_CAPTION_FONT_MISSING`

6. **Tests** — ต่อ `tests/studio-structure.test.mjs` หรือไฟล์ใหม่ `tests/studio2-*.test.mjs`: เมธอดใหม่ตามตาราง PHASE2, ไม่มี `autoVideosArmed` เหลือ, i18n parity (รวมคีย์ที่ประกอบจาก template string — **ไม่มี `'studio.` เด็ดขาดใน Studio UI**), logic ล้วน (เช่น สรุปข้อความความคืบหน้า, ช็อตที่ไม่มีซับ) อยู่ใน `app/utils/studioFlow.js` และ import มาทดสอบจริง

## Done when
- `npm run generate` ผ่าน · test เดิม + ใหม่ผ่าน
- ห้ามเหลือ mock ในโค้ดที่ commit
- เขียน "Notes from Agent B" ใน `docs/product-studio/PHASE2.md`
- commit + **`git push -u origin feat/studio2-frontend`** (เช็กด้วย `git ls-remote origin feat/studio2-frontend` ว่าขึ้นจริง) — **ห้าม merge เข้า master**
