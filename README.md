# NAKA-AI

Monorepo ของ NAKA-AI TECH รวมโค้ดจาก 2 repo เดิม (เก็บประวัติ commit ครบ)

| โฟลเดอร์ | มาจาก | คืออะไร |
|---|---|---|
| [`apps/landing`](apps/landing) | `kimyohant/naka-ai-landing` | เว็บ naka-ai.com — landing, สมาชิก/ล็อกอิน, เครดิต, ชำระเงิน, ใบเสร็จ, หลังร้าน (Node + PostgreSQL ใน Docker) |
| [`apps/studio`](apps/studio) | `kimyohant/naka-drama-studio` | NAKA Studio — เครื่องผลิตคอนเทนต์ AI: Drama, Marketer, Seller, Product Studio, Viral Clone, Live (Node + PostgreSQL ใน Docker) |
| [`docs/adr`](docs/adr) | — | บันทึกการตัดสินใจด้านสถาปัตยกรรม |

## เริ่มต้น

```bash
cd apps/landing && npm ci && npm run dev          # http://127.0.0.1:8788
cd apps/studio/backend && npm ci && npm run dev   # http://localhost:5679
```

รายละเอียดของแต่ละแอปอยู่ใน README / CLAUDE.md ของโฟลเดอร์นั้น

## Deploy

- `docker compose up -d --build` ที่ root: PostgreSQL + landing + studio (รหัสฐานข้อมูลใน `.env` ที่ root; secret ของแต่ละแอปใน `apps/landing/.env.production` และ `apps/studio/.env.production`)
- เฉพาะแอปเดียว: `docker compose up -d --build landing` หรือ `… studio` (สื่อ/workspace ของ studio ยังอยู่ใน volume `naka-drama-studio_naka-data` เดิม)
