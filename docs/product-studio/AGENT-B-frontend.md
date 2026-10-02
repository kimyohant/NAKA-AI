# Agent B — Frontend: Product Studio

อ่านก่อน: `CLAUDE.md`, **`docs/product-studio/PLAN.md` (ข้อ 1, 3, 4 คือสัญญา — ยิง API ตามนั้นเท่านั้น)**
เจ้าของไฟล์: `frontend/**` เท่านั้น — **ห้ามแก้ `backend/**`** (Agent A ทำ API ขนานกัน)

## Setup

```
git fetch origin
git worktree add ../naka-studio-b -b feat/studio-frontend origin/master
cd ../naka-studio-b/frontend && npm ci
```
ทำงานใน `../naka-studio-b` เท่านั้น · dev: `npm run dev` (port 3013, proxy → 5679; ชี้ 5680 ชั่วคราวใน dev เท่านั้นถ้าจะลองกับ backend ของ A)

## Tasks

1. **API client** — `app/composables/useApi.ts`: `studioAPI` ครบทุก endpoint ใน PLAN ข้อ 4 + types (`StudioProject`, `StudioShot`, `StudioMerge`, `StudioAvatar`, `StudioImage`, `Template`, options)

2. **เมนู + routes**
   - เมนูหลัก "Product Studio" / "สตูดิโอสินค้า" ใน `app/layouts/default.vue` (ถัดจาก AI Marketer, pattern `isMarketerRoute` เดิม)
   - ลงทะเบียนใน `nuxt.config.ts` `pages:extend` (pattern เดิม ไม่ใช้ `[id]` ในชื่อไฟล์): `/studio` (projects + avatars), `/studio/:id` (workspace) — ไฟล์ใน `app/views/studio/` + `app/pages/studio.vue` ตาม pattern ของ marketer

3. **หน้า `/studio`** — แท็บ Projects (การ์ด: thumbnail จาก keyframe แรก/วิดีโอ, เทมเพลต, ภาษา, แพลตฟอร์ม, สถานะ) + ปุ่ม New · แท็บ Avatars (การ์ด, สร้าง: ชื่อ/คำบรรยาย/locale + อัปโหลดรูปด้วย `uploadAPI` เดิม หรือปุ่ม "ให้ AI สร้างรูป", แก้/ลบ, poll ระหว่าง `imageStatus: processing`)

4. **Workspace `/studio/:id`** — stepper แบบเดียวกับ marketer (sidebar + rail บนมือถือ, ใช้ style เดิม): `1 สินค้า · 2 เทมเพลต · 3 ตั้งค่า · 4 บท · 5 สร้าง · 6 ส่งออก` + แผงรอง "ภาพสินค้า"
   - **สินค้า**: URL → `ingest-url` prefill (ล้มเหลวกรอกเองได้), รูปสินค้า (อัปโหลด/ลบ/เรียง)
   - **Creative Gallery**: grid การ์ดเทมเพลต (ไอคอน/ภาพประกอบ CSS + ชื่อ/คำอธิบายจาก i18n + timeline beat แบบแท่งสัดส่วน + badge avatar/ไม่มีบทพูด) · ตัวกรองหมวด / แพลตฟอร์ม / ใช้ avatar · ไม่มีวิดีโอตัวอย่าง (ห้ามดึงสื่อจากเว็บอื่น)
   - **ตั้งค่า**: language / market / platform จาก `GET /options` (ห้าม hardcode) — เลือก platform แล้วตั้ง aspect + จำกัดความยาวตาม `defaultAspect/maxDurationSec`; ความยาว (slider 10–60), avatar picker (บังคับเมื่อ `avatarMode: required`), tone, notes, งบ, `aiDisclosure` · คำเตือนคุณภาพเสียงสำหรับภาษาที่ไม่ใช่ en/zh
   - **บท**: ปุ่มสร้างบท (+ instruction) → poll `GET /projects/:id` ทุก 2s ระหว่าง `scripting` · ตารางช็อต: role, ความยาว, บทพูด (แก้ได้ — นับคำ/ตัวอักษรเทียบเวลา เตือนถ้ายาวเกิน), visual, ข้อความบนจอ → `PUT shots/:shotId`
   - **สร้าง**: ปุ่ม "สร้าง keyframe ทั้งหมด" / "สร้างวิดีโอทั้งหมด" / "สร้างทั้งหมด" (frontend ทำ keyframes → รอครบ → videos ต่อเอง; บอกผู้ใช้ว่าต้องเปิดหน้าไว้) · การ์ดต่อช็อต: keyframe + วิดีโอ (poster/เล่นได้), สถานะ, error, สร้างใหม่รายช็อต (`shotIds`) · poll 3s ระหว่างมีงาน processing (timer เดียวรวมกับ poll บท)
   - **ส่งออก**: ปุ่มต่อวิดีโอ (`merge`) → เล่น/ดาวน์โหลด · checklist ก่อนโพสต์: ติดป้าย AI-generated ตามกฎแพลตฟอร์ม (เมื่อ `aiDisclosure`), ตรวจราคา/โปร, ไม่อ้างสรรพคุณเกินจริง · ลิงก์ "เปิดใน episode workbench" ไป `/drama/:dramaId/episode/1` สำหรับแก้ละเอียด
   - **ภาพสินค้า**: เลือกรูปต้นทาง → kind (packshot/lifestyle/on_model/banner) → platform (สำหรับ banner) → count 1–4 → instruction → แกลเลอรี + "ใช้เป็นรูปสินค้า" (promote) — reuse/ขยาย `MarketerVisualCard.vue` แทนการเขียนใหม่ถ้าทำได้
   - error ทุกตัวแปลผ่าน `errors.codes.*`; `E_NO_*_MODEL` → banner ลิงก์ Settings แบบเดิม; `E_AVATAR_REQUIRED` → พาไปเลือก avatar

5. **i18n** — `app/locales/th.json` + `en.json` ครบทั้งคู่: `layout.nav.studio`, `studio.*` (รวม `studio.templates.<id>.name/description/beats.*` ของ 12 เทมเพลต, `studio.languages.*`, `studio.markets.*`, `studio.platforms.*`) + `errors.codes` ใหม่ 6 ตัวใน PLAN ข้อ 4 · ไม่มี hardcode ข้อความในเทมเพลต

6. **Style** — CSS variables/คลาสปุ่มเดิม (theme หลักอยู่ที่ `app/assets/studio.css` — เป็น theme ทั้งแอป ไม่เกี่ยวกับเมนูนี้ ห้ามแก้) · คลาสของเมนูนี้ใช้ prefix `ps-` ใน scoped style, light/dark, mobile, ไม่มี UI framework, ไม่เพิ่ม dependency · แยก component (`StudioTemplateCard`, `StudioShotCard`, `StudioAvatarCard` ฯลฯ) อย่าให้ไฟล์ view เดียวยาวเกิน ~800 บรรทัด

7. **Tests** — `tests/studio-*.test.mjs`: เมธอด API ครบตามตาราง PLAN, routes ลงทะเบียน, i18n parity th/en (รวม 12 เทมเพลต + error codes), ไม่มี mock/hardcode, logic ล้วน (เช่น นับคำต่อวินาที, flow step) แยกไว้ใน `app/utils/studioFlow.js` แล้ว import มาทดสอบจริง

## Done when
- `npm run generate` ผ่าน · test เดิม + ใหม่ผ่าน (`node --test` ทุกไฟล์ใน `tests/`)
- ถ้า API ของ A ยังไม่พร้อม: mock ได้เฉพาะตอน dev — **ห้ามเหลือ mock ในโค้ดที่ commit**
- เขียน "Notes from Agent B" ใน `docs/product-studio/PLAN.md`: ไฟล์ที่แก้, หน้าจอที่ทำ, สิ่งที่ต้องการจาก backend เพิ่ม
- commit + `git push -u origin feat/studio-frontend` — **ห้าม merge เข้า master**
