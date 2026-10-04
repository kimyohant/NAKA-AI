# AGENT B — Viral Clone Studio (frontend)

อ่าน [`PLAN.md`](PLAN.md) ก่อน — สัญญาทุกอย่างอยู่ที่นั่น · Base: `origin/master` @ `efb1060` · เจ้าของไฟล์ `frontend/**` เท่านั้น (+ append "Notes from Agent B" ท้าย PLAN.md)

อ่าน **Notes from Agent A ล่าสุดใน PLAN ก่อนเขียนโค้ด** — ชื่อ field/endpoint/error code ต้องตามที่ backend ยืนยันจริง ไม่ใช่เดาจากสัญญา (ถ้ายังไม่มี Notes ของ A: ทำตาม PLAN ข้อ 3 ได้ แต่จดใน Notes ว่ายังไม่ได้ sync)

## Tasks

1. **Nav + i18n พื้นฐาน** — `app/layouts/default.vue`: เพิ่มลิงก์ `/viral-clone` ใน side-nav หลัก (ต่อท้าย `/studio`, ไอคอน lucide `Copy` ขนาด 17 เท่าพี่น้อง) + computed `isViralCloneRoute = route.path === '/viral-clone'` (pattern บรรทัด 95-97 เดิม) · i18n `layout.nav.viralClone` th = "สตูดิโอโคลนไวรัล" / en = "Viral Clone Studio"
2. **หน้าเดียว `app/pages/viral-clone.vue`** (flat page — pattern เดียวกับ `marketer.vue`, ไม่สร้าง nested route): สองสถานะในหน้า — (a) รายการโปรเจกต์: การ์ดชื่อ/สถานะ (draft/analyzing/ready/error)/จำนวน variant/วันที่ + ปุ่มสร้างเปิด dialog (name, transcript textarea, language, ข้อความแนะนำลิขสิทธิ์ตาม PLAN ข้อ 4 — **บังคับแสดง**) · (b) เลือกโปรเจกต์ → workspace ในหน้าเดียวกัน (ปุ่มกลับ)
3. **Workspace 3 ส่วน** (tabs): **Blueprint** — beat list แก้ได้ (line: textarea, visual: select enum, durationSec: number, hooks สำรองเพิ่ม/ลบ/แก้) + ปุ่ม "วิเคราะห์" (POST analyze → 202 → spinner จาก `status='analyzing'` + poll) + ปุ่มบันทึก (PUT blueprint) · **ตัวแปร** — matrix builder (hooks: checkbox, สินค้า: select จาก studioAPI เดิม, avatar: select, ภาษา: chips th/en) แสดงจำนวนที่จะได้แบบสด (ผ่าน util ข้อ 5) เกิน 12 → disabled + คำเตือน; ตาราง/การ์ด variants: สถานะ, "คิวที่ n" ถ้ามี `queue_position`, พรีวิว `<video>` เมื่อ completed, ความยาว, ดาวน์โหลด, error → `toastJobError`/`errorCodeOf` pattern เดิม + render/render-all ปุ่ม · **อ้างอิง** — transcript อ่านอย่างเดียว + พรีวิวไฟล์ reference ถ้ามี
4. **Poll** — timer เดียว (pattern studio workspace): 3s เมื่อมี analyzing/rendering/queued, หยุดเมื่อว่าง — **ห้ามสแต็ก timer**
5. **`app/utils/viralCloneFlow.js`** (logic ล้วน import รันใน test ได้): `matrixVariantCount(m)` (Cartesian, มุมว่าง = 1 ทาง default), `matrixOverCap(m, cap = 12)`, `beatsTotalSeconds(blueprint)` — **ตรวจชื่อไม่ซ้ำ auto-import กับ marketerFlow/studioFlow/unslothFlow** (กติกา collision เดิม)
6. **`app/composables/useApi.ts`** — `cloneAPI` + types `CloneProject/CloneVariant/CloneBlueprint` ตามสัญญา (field ตาม Notes ของ A จริง)
7. **i18n th/en** — `viralClone.*` ทุกข้อความใหม่ + `errors.codes.*` ตามที่ A ยืนยัน · ห้าม hardcoded text ทั้งสองภาษา
8. **`tests/viralclone-structure.test.mjs`** (pattern `unsloth-structure.test.mjs`): nav/มีหน้า + endpoint surface (ตาม PLAN ตาราง) + i18n parity ทุก key `viralClone.` + logic real-run ของ viralCloneFlow + สแกน `sk-…`/IPv4 public · รัน `node --test tests/*.test.mjs` ทั้งชุดผ่าน + `npm run generate` ผ่าน

## กติกา

- worktree แยก (`git worktree add ../naka-viralclone-b -b feat/viralclone-frontend origin/master`) · deps ใช้ symlink node_modules (กติกาเดิม — เช็ก package.json ต่างจาก base ก่อน)
- push `feat/viralclone-frontend` เท่านั้น · ยืนยัน `git ls-remote` · ห้าม merge master · ห้าม --force
- JS SFC (`<script setup>` ไม่มี lang="ts") **ห้าม cast แบบ TS** · ไม่ใช้ `studio.` prefix กับข้อความของเมนูนี้
- ความต่างจากสัญญาทุกจุด → บันทึก additive ใน "Notes from Agent B"
