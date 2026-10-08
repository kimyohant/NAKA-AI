# AGENT A — Viral Clone Studio (backend)

อ่าน [`PLAN.md`](PLAN.md) ก่อน — สัญญาทุกอย่างอยู่ที่นั่น (ข้อ 3 Contract ผูกทั้งสองฝั่ง) · Base: `origin/master` @ `efb1060` · migration ล่าสุด v11 → งานนี้เพิ่ม **v12**

สิ่งที่มีอยู่แล้วให้ reuse (ห้ามทำซ้ำ): pattern async 202 + `pipeline_tasks` + `error_code` (จาก unsloth: revise/analyze) · คิว `maxConcurrent` + `queue_position` · `scaleBeats` + `minDurationSec` · capabilities ของ video config · FFmpeg merge + captions ของ Studio

## Tasks

1. **Migration v12** — ตาราง `clone_projects` + `clone_variants` ตาม PLAN ข้อ 3 (อย่าลืมอัปเดต test ที่ hardcode จำนวน migration — เคยมีกรณี sqlite-migration-backup.test.ts)
2. **CRUD + routes** — `routes/clone.ts` mount `/api/v1/clone` + `services/clone.ts`: ตาราง endpoints ตาม PLAN (create ตรวจ transcript ว่าง → 400, GET detail รวม variants, PATCH)
3. **Analyze (async)** — 202 + pipeline_tasks: prompt text provider active → Blueprint JSON ตาม schema (beats ยึดกับประโยค transcript, hooks สำรอง 2-3 ตัว, role/visual ถูก enum) → validate → repair 1 ครั้ง → ยังพัง → project `status='error'` + `E_CLONE_ANALYZE_FAILED`; ระหว่างวิเคราะห์ `status='analyzing'` (GET รายงานให้ frontend โชว์ spinner — เทียบ `doc.revising`)
4. **Blueprint save** — `PUT /blueprint` validate schema (ไม่ผ่าน → 400 พร้อม field ที่พัง) · อนุญาตแก้ทุก field ยกเว้น role/visual ต้องอยู่ใน enum
5. **Matrix → variants** — Cartesian ของ hookIndexes × productIds × avatarIds × languages (ค่าว่างมุมใดมุมหนึ่ง = ใช้ default ของโปรเจกต์ ไม่ใช่ 0 ทางเลือก) · cap 12 → 400 `E_CLONE_MATRIX_TOO_LARGE` · ตรวจ productId/avatarId มีจริง (ไม่มี → 400 ระบุ id)
6. **Render path** — `POST /clone/variants/:id/render` และ `/render-all` (202): variant → draft beats → keyframe → คลิป (beat สั้นกว่า `minDurationSec` ของ video config → รวม beat ติดกัน ความยาวรวมคงเดิม) → captions → merge → บันทึก `output_path`, `duration_sec` (ffprobe), `error_code` เมื่อล้ม · **ตัดสินใจ `pipeline_tasks.kind` (เดิม `studio_render` หรือใหม่ `clone_render`) แล้วทำ boot-resume + recover ครอบคลุม** — เขียนเหตุผลใน Notes · ภาษาตัวแปรต่างจากโปรเจกต์ → แปล line/hooks ด้วย text provider ก่อน render (เก็บผลแปลที่ไหน — ตัดสินเอง บันทึกใน Notes)
7. **Tests** — typecheck ผ่าน · `node --import tsx --test tests/*.test.ts tests/*.test.mjs` (จด baseline ก่อน: master มี failure พื้นฐาน ~14 ตัว — ห้ามเพิ่มจากนั้น): migration v12, blueprint schema validate + repair, matrix cap + Cartesian ถูกต้อง, render happy path (mock providers), error codes ครบ, boot-resume kind ที่เลือก

## กติกา

- เจ้าของไฟล์ `backend/**` เท่านั้น (+ append "Notes from Agent A" ท้าย PLAN.md — ห้ามแก้ข้อความส่วนอื่นของ PLAN)
- worktree แยก · push `feat/viralclone-backend` เท่านั้น · ยืนยันด้วย `git ls-remote` · ห้าม merge master · ห้าม --force
- ไม่มี key/IP จริงในโค้ด/docs/log · log ไม่พิมพ์ data URL · ไม่แตะ TTS
- ถ้าต้องเปลี่ยนสัญญา (field ชื่ออื่น, endpoint รูปแบบอื่น, error code เพิ่ม/ตัด) — ทำได้ แต่**บันทึกชัดใน Notes** เพื่อให้ Agent B sync
