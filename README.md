# NAKA-AI

Monorepo ของ NAKA-AI TECH รวมโค้ดจาก 2 repo เดิม (เก็บประวัติ commit ครบ)

| โฟลเดอร์ | มาจาก | คืออะไร |
|---|---|---|
| [`apps/landing`](apps/landing) | `kimyohant/naka-ai-landing` | เว็บ naka-ai.com — landing, สมาชิก/ล็อกอิน, เครดิต, ชำระเงิน, ใบเสร็จ, หลังร้าน (Cloudflare Worker) |
| [`apps/studio`](apps/studio) | `kimyohant/naka-drama-studio` | NAKA Studio — เครื่องผลิตคอนเทนต์ AI: Drama, Marketer, Seller, Product Studio, Viral Clone, Live (Docker) |
| [`docs/adr`](docs/adr) | — | บันทึกการตัดสินใจด้านสถาปัตยกรรม |

## เริ่มต้น

```bash
cd apps/landing && npm ci && npm run dev          # http://127.0.0.1:8788
cd apps/studio/backend && npm ci && npm run dev   # http://localhost:5679
```

รายละเอียดของแต่ละแอปอยู่ใน README / CLAUDE.md ของโฟลเดอร์นั้น

## Deploy

- **Landing:** GitHub Actions → *Landing Deploy* → Run workflow (หรือ `cd apps/landing && npm run deploy`)
- **Studio:** `cd apps/studio && docker compose up -d --build` (ชื่อ project ยังเป็น `naka-drama-studio` ข้อมูลใน volume เดิมไม่หาย)
