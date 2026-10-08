# Agent B — Frontend: Unsloth provider (H3 video + local text)

อ่านก่อน: `CLAUDE.md`, **`docs/unsloth/PLAN.md` (ข้อ 3 = สัญญา API, ข้อ 4 = ความปลอดภัย)**
เจ้าของไฟล์: `frontend/**` — **ห้ามแก้ `backend/**`**

## Setup

```
git fetch origin
git worktree add ../naka-unsloth-b -b feat/unsloth-frontend origin/master
cd ../naka-unsloth-b/frontend && npm ci
```

## Tasks

1. **Settings** (`app/pages/settings.vue`, `app/composables/useProviderIcon.ts`)
   - provider `unsloth` ใน video และ text (ไอคอน/ชื่อ "Unsloth (Local)") · ฟอร์ม: base URL, API key, model, และ settings ของวิดีโอ (`gguf_filename`, `steps`, `quality` fast/standard, `max_concurrent`, `queue_timeout_minutes`)
   - ค่าเริ่มต้นตาม PLAN ข้อ 3 · ราคาแสดง "฿0 (local)"
   - ปุ่มทดสอบใช้ `POST /ai-configs/test` เดิม — แสดง latency, โมเดล loaded ไหม, **tool calling ผ่าน/ไม่ผ่าน** (text) พร้อมคำอธิบายว่าถ้าไม่ผ่าน agent จะบันทึกผลไม่ได้
   - คำเตือนเมื่อ base URL ไม่ใช่ loopback/private (เช่น public IP) ตาม PLAN ข้อ 4
   - คำอธิบายสั้น: H3 local ฟรีแต่ช้า (~12 นาที/คลิป 5 วินาที), ทำได้ทีละคลิป, เหมาะกับสั่งทิ้งไว้

2. **Product Studio**
   - ขั้นตั้งค่า/สร้าง: ใช้ `GET /studio/options` → `videoProvider` แสดงประมาณเวลาทั้งโปรเจกต์ (จำนวนช็อต × เวลาต่อคลิป) และข้อจำกัดความยาวช็อตขั้นต่ำ
   - การ์ดช็อต/แถบ auto-render: สถานะ "รอคิว (คิวที่ n)" จาก `videoQueuePosition`
   - ข้อความ `E_VIDEO_QUEUE_TIMEOUT`, `E_LOCAL_PROVIDER_UNREACHABLE`, `E_LOCAL_MODEL_NOT_DOWNLOADED`

3. **Episode workbench** (`app/views/drama/episode.vue`) — แสดงสถานะ "รอคิว" ของงานวิดีโอ local แบบเดียวกัน (ไม่เปลี่ยนพฤติกรรม provider อื่น)

4. **Async revise / analyze** — Marketer: "สั่งแก้เอกสาร" และ "วิเคราะห์โครงสร้าง" ส่ง `{ async: true }` → แสดงสถานะ `revising` / `analyzing` และ poll (timer เดียวเดิมของหน้า) · ปุ่มอื่นไม่ถูกบล็อก

5. **i18n** th + en ครบ (provider, settings, คิว, error codes ใหม่ 3 ตัว) · Studio ใต้ `productStudio.*`

6. **Tests** — `tests/unsloth-*.test.mjs`: provider อยู่ในรายการ, ฟิลด์ settings ครบ, ไม่มี key/IP จริง, i18n parity, logic ล้วน (เช่น คำนวณเวลาประมาณ, ตรวจ URL ว่าเป็น loopback/private) อยู่ใน `app/utils/` และ import มาทดสอบจริง

## Done when
- `npm run generate` ผ่าน · test เดิม + ใหม่ผ่าน · ไม่เหลือ mock
- Notes from Agent B ใน `docs/unsloth/PLAN.md`
- commit + `git push -u origin feat/unsloth-frontend` + เช็ก `git ls-remote origin feat/unsloth-frontend` — **ห้าม merge เข้า master**
