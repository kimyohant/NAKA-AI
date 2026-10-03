# Agent A — Backend: Product Studio Phase 2

อ่านก่อน: `CLAUDE.md`, `docs/product-studio/PLAN.md` (+ Notes ของคุณเองรอบก่อน), **`docs/product-studio/PHASE2.md` (ข้อ 2–3 คือสัญญา)**
เจ้าของไฟล์: `backend/**` + `desktop/electron-builder.yml` + `desktop/scripts/**` — **ห้ามแก้ `frontend/**`** (Agent B ทำขนานกัน)

## Setup

```
git fetch origin
git worktree add ../naka-studio2-a -b feat/studio2-backend origin/master
cd ../naka-studio2-a/backend && npm ci
```
dev: `PORT=5680 SQLITE_PATH=<db ทดสอบ> npm run dev`

## Tasks

1. **Migration v11** ตาม PHASE2 ข้อ 3 + Drizzle + แก้ expected migrations `[1..11]` (`tests/campaigns-migration.test.ts`, `tests/sqlite-migration-backup.test.ts`) · `toProjectJson` / merge JSON คืนฟิลด์ใหม่ตามสัญญา (default ถูกต้องสำหรับแถวเก่า)

2. **Auto-render pipeline** — `src/services/studio-autorender.ts`
   - `POST auto-render` / `auto-render/cancel` ตาม PHASE2 ข้อ 2 · ใช้ `pipeline_tasks` kind `studio_render` (เพิ่มใน `PipelineTaskKind`) — busy guard เดียวกับ script
   - ใช้ฟังก์ชัน render/merge ที่มีอยู่ใน `services/studio.ts` (อย่าก๊อป logic ส่ง keyframe/video) — แยก "ส่งงาน" ออกจาก route ถ้าจำเป็น
   - รอผล: วนเช็ก sys_task ของช็อตใน stage ปัจจุบันทุก 5s จนไม่มี queued/processing แล้วอัปเดต `autoRender.done/failed` ระหว่างทาง · `cancel` ⇒ หยุดก่อนส่งงาน stage ถัดไป
   - boot: ต่อ pipeline ที่ค้าง (หลัง `recoverGenerationTasks`) หรือ `failed` + `E_TASK_INTERRUPTED` ถ้า resume ไม่ได้ — เขียนต่อจาก `failStaleStudioProjects` เดิม
   - ห้ามมี timer/loop ค้างหลังจบ — test ต้องพิสูจน์ (เช่น จำลอง sys_task completed/failed ด้วย DB ทดสอบ แล้วเช็กว่า stage เดินครบและ loop หยุด)

3. **Captions** — `src/services/captions.ts` + ต่อเข้า merge ของ Studio
   - สร้าง cues จากช็อต (ข้อความ/เวลาตามกติกา PHASE2 ข้อ 2 — เวลาจาก ffprobe ของคลิปจริง) → เขียน `.srt` + `.ass` (สไตล์ `clean/bold/boxed`, ป้าย AI ถ้า `aiLabelBurnIn`)
   - ตัดบรรทัดด้วย `Intl.Segmenter` ตามภาษาโปรเจกต์ · ทดสอบหน่วยกับ th / zh / ja / ko / en / ar / vi
   - ฝังด้วย ffmpeg `ass` (หรือ `subtitles`) + `fontsdir` หลัง concat · **`mergeEpisodeVideos` ของ drama ปกติต้องทำงานเหมือนเดิม** (เพิ่มพารามิเตอร์ optional หรือแยกขั้นฝังซับเป็นอีก step ก็ได้)
   - ฟอนต์ OFL ใน `backend/assets/fonts/` (ใส่ `OFL.txt` ของแต่ละฟอนต์) — เลือกไฟล์ให้ขนาดรวมสมเหตุผล (เขียนขนาดจริงใน Notes) · ภาษาที่ไม่มีฟอนต์ครอบคลุม ⇒ `E_CAPTION_FONT_MISSING`
   - path ฟอนต์: env `CAPTION_FONT_DIR` (เดสก์ท็อปฉีดให้) ไม่งั้น `backend/assets/fonts` · เดสก์ท็อป: เพิ่ม `extraResources` ใน `desktop/electron-builder.yml` + ฉีด env ใน main process ผ่าน `desktop/scripts`/config ที่มีอยู่ — ถ้าต้องแก้ `desktop/src/main.ts` ให้ทำได้เฉพาะบรรทัดฉีด env (แบบ `FFMPEG_BIN`)
   - test: สร้างคลิปสั้นด้วย ffmpeg `testsrc`/`color` ใน temp → merge พร้อมซับภาษาไทย → ffprobe ยืนยันได้ไฟล์และความยาวถูก (skip ได้ถ้าเครื่องไม่มี ffmpeg ใช้งานได้)

4. **Marketer → Studio** — `POST /studio/projects/from-campaign` ตาม PHASE2 ข้อ 2 (map platform ของ Marketer → Studio: `tiktok→tiktok`, `reels→instagram_reels`, `youtube_shorts→youtube_shorts`, `facebook→facebook`, `shopee→shopee`, `lazada→lazada`) · campaign ที่ soft delete / creative ไม่ใช่ของ campaign ⇒ `E_STUDIO_CAMPAIGN_NOT_FOUND`

5. **Tests** — `tests/studio2-*.test.*`: migration v11, routes/error codes ใหม่, pipeline เดิน stage ครบ + ช็อตล้มไม่หยุด + cancel + ไม่มี loop ค้าง, captions (ตัดบรรทัดหลายภาษา, เวลาสะสมจากความยาวจริง, srt format), from-campaign mapping, drama merge เดิมไม่เปลี่ยน · `remove-audio-tts-structure` ยังผ่าน

## Done when
- `npm run typecheck` ผ่าน · test เดิม + ใหม่ผ่าน 100% (รันแบบ `--test-concurrency=1` ได้ถ้า RAM น้อย)
- `PORT=5680` + DB ทดสอบ: curl ครบ endpoint ใหม่ (auto-render ถึง `E_NO_*_MODEL` ถ้าไม่มี key) + merge จริงพร้อมซับไทยจากคลิปทดสอบ ffmpeg → แนบ path ไฟล์ผลลัพธ์/ภาพนิ่ง 1 เฟรมใน Notes
- เขียน "Notes from Agent A" ใน `docs/product-studio/PHASE2.md`
- commit + **`git push -u origin feat/studio2-backend`** (เช็กด้วย `git ls-remote origin feat/studio2-backend` ว่าขึ้นจริง) — **ห้าม merge เข้า master**
