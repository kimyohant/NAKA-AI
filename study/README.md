# study/

## hypit/

สำเนาซอร์สโค้ดทั้งระบบของ [hypit-ai/hypit](https://github.com/hypit-ai/hypit) ที่ commit `7f730ab` (2026-10-04) — ไม่ได้แก้ไขโค้ดต้นฉบับ

**License:** `hypit/LICENSE` (Apache 2.0 พร้อมเงื่อนไขเพิ่มเติม © 2026 Hypit.AI) — ห้ามลบหรือแก้ไข LICENSE และชื่อ/โลโก้/ข้อมูลลิขสิทธิ์ของ Hypit

**ขอบเขตการใช้งาน (สำคัญ):** NAKA-AI ใช้ Hypit **ภายในองค์กรเท่านั้น** ซึ่ง license อนุญาต (รวมงานที่ทำให้ลูกค้า)
แต่ห้าม (ถ้าไม่มี commercial license จาก Hypit.AI):
- ขาย/แจกจ่าย NAKA-AI ที่มี Hypit หรือ derivative ของ Hypit ให้บุคคลภายนอกเพื่อประโยชน์ทางการค้า
- เปิด NAKA-AI เป็นบริการ hosted/SaaS ที่มีหลายผู้เช่า (multi-tenant)

ถ้าแผนการใช้งานเปลี่ยน ต้องถอด Hypit ออกหรือขอ commercial license ก่อน

## การใช้ใน Viral Clone Studio

เมนู "สตูดิโอโคลนไวรัล" → แท็บตัวแปร → **เอนจินเรนเดอร์ขั้นสุดท้าย = Hypit**
backend (`backend/src/services/hypit-render.ts`) สร้างโปรเจกต์ Hypit (SVML/SVS/SVRun) จากคลิปของแต่ละ beat + ซับ
แล้วเรียก `node study/hypit/bin/hypit.mjs build` เป็น process แยก (ไม่ import โค้ด Hypit) — ถ้า Hypit ไม่พร้อมหรือ render ล้ม จะถอยกลับไปใช้ ffmpeg ของ NAKA

ติดตั้ง (ต้องมี Node ≥ 22.15, pnpm 10, ffmpeg และ Chromium):

```bash
cd study/hypit
pnpm install --frozen-lockfile
# browser สำหรับ render: ชี้ไป Chromium / chrome-headless-shell ที่มีอยู่
export HYPIT_CHROME_PATH=/path/to/chrome-headless-shell
```

Hypit ไม่ได้ติดไปกับ build ของ desktop (dmg/exe) และ Docker image (`.dockerignore`) — เอนจินนี้ใช้ได้เฉพาะเมื่อรัน backend จาก repo บนเครื่องที่ติดตั้ง Hypit แล้ว
