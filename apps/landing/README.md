# naka-ai

## Current public landing (2026-09-28)

`public/index.html` is the Thai merchant landing page at `/`. It leads with a product photo becoming a sales clip, then introduces short dramas, AI Live, and automated customer replies. The muted WebM soap clip and matching image are labeled demonstration media. Replace them with approved production examples when the media integration is connected.

`public/home-refine.css` is the focused reading and interaction pass for the current landing: a quieter hero, clearer Thai type, simpler channel labels, a direct pricing call action and larger touch targets. It keeps the existing blue/Naga identity and site structure. Changes were informed by the general information hierarchy of the user-supplied Apple Thailand reference; no Apple assets, copy or code are used.

The current version adds persistent navigation, service jump links and large capability chapters. The `/create/` page reads `?workflow=sales|drama|live|bot` to show the right brief questions; selecting a job does not imply the static page performs media rendering or platform integration. It still prepares a brief for the human team and leaves the product image on the visitor's device.

`/create/` is the stable public entry URL for the future creation flow. Today its static page previews a selected product photo locally, helps the merchant copy a product brief, and displays the human contact NAKA-AI Tech at `0892788587`. It does not upload the photo or invoke the production rendering system. Pricing and credit rates have not been set; the public page directs visitors to call for a quote.

The older `/chatbot/` landing redirects to `/create/?workflow=bot` so old links no longer show outdated contact and trial claims. `/studio/` remains available as a noindex draft-text tool, with a direct link to `/create/` for starting production work. The retired channel is removed from its public choices; legacy backend routes are unchanged.

The older implementation notes below describe legacy routes and APIs retained in this checkout. They are not the current public product specification.

ทีม AI Agent ช่วยขายของออนไลน์ เวอร์ชันแรก (MVP) มี **Sales Agent บน LINE OA** ที่ใช้ Claude ตอบแชท ค้นหาสินค้า และสร้างออเดอร์ให้อัตโนมัติ

ทั้งระบบเป็น Cloudflare Worker ตัวเดียว:

| เส้นทาง | คืออะไร |
|---|---|
| `/` | หน้าเว็บ naka-ai.com (`public/index.html`) |
| `/admin/` | หลังร้าน: ทดลองแชท, สินค้า, ออเดอร์, แชทลูกค้า, ตั้งค่าร้าน |
| `/webhook/line` | Webhook ที่ LINE ส่งข้อความลูกค้าเข้ามา |
| `/api/admin/*` | API ของหลังร้าน (ต้องใช้ `ADMIN_TOKEN`) |

```
src/index.ts   router + LINE webhook + admin API
src/agent.ts   Sales Agent (Claude + tools: search_products, create_order, check_my_orders, handoff_to_human)
src/db.ts      D1 queries (สินค้า ออเดอร์ บทสนทนา)
src/line.ts    LINE Messaging API (verify signature, reply/push, loading)
schema.sql     ตาราง D1 + ข้อมูลตัวอย่าง
```

## Deploy ขึ้น naka-ai.com

1. **ล็อกอิน Cloudflare** (จะเปิดเบราว์เซอร์)
   ```
   npx wrangler login
   ```
2. **สร้างฐานข้อมูล D1** แล้วนำ `database_id` ที่ได้ไปใส่ใน `wrangler.jsonc`
   ```
   npx wrangler d1 create naka-ai-db
   npx wrangler d1 execute naka-ai-db --remote --file=schema.sql
   ```
3. **ใส่ secrets**
   ```
   npx wrangler secret put ANTHROPIC_API_KEY          # จาก console.anthropic.com
   npx wrangler secret put LINE_CHANNEL_SECRET        # LINE Developers > Basic settings
   npx wrangler secret put LINE_CHANNEL_ACCESS_TOKEN  # LINE Developers > Messaging API (long-lived)
   npx wrangler secret put ADMIN_TOKEN                # รหัสเข้าหลังร้าน ตั้งเองให้ยาว ๆ
   ```
4. **Deploy**
   ```
   npm run deploy
   ```
   ใช้งานได้ที่ `https://naka-ai.com`, `https://www.naka-ai.com` และ `https://naka-ai.naka-ai.workers.dev`
   (โดเมนจดที่ Onamae.com และตั้ง nameserver ชี้มาที่ Cloudflare แล้ว)
5. **ตั้งค่า LINE OA** ใน LINE Developers > Messaging API
   - Webhook URL: `https://naka-ai.com/webhook/line` → กด Verify
   - เปิด **Use webhook**
   - ใน LINE Official Account Manager ให้ปิด Auto-reply และ Greeting message เพื่อไม่ให้ตอบซ้ำกับบอท
6. เข้า `https://naka-ai.com/admin/` ด้วย `ADMIN_TOKEN` แล้วใส่สินค้าจริง ข้อมูลค่าส่ง และเลขพร้อมเพย์ในแท็บ "ตั้งค่าร้าน"

## รันบนเครื่อง

```
cp .dev.vars.example .dev.vars   # แล้วใส่ค่าจริง
npm run db:local
npm run dev                      # http://localhost:8787 และ /admin/
```

## หมายเหตุ

- โมเดลที่ใช้คือ `claude-opus-5` (effort `low` เพื่อให้ตอบแชทได้เร็ว) พร้อม server-side fallback ถ้ามีการปฏิเสธคำขอ
- เมื่อลูกค้าส่งรูป (มักเป็นสลิป) หรือขอคุยกับคน บอทจะหยุดตอบแชทนั้นและขึ้นสถานะ "รอแอดมิน" ในหลังร้าน
- งานของ Agent รันใน `waitUntil` หลังตอบ LINE ว่าได้รับแล้ว ถ้าร้านใหญ่ขึ้นควรย้ายไปใช้ Cloudflare Queues
- ตอนนี้เป็นระบบร้านเดียว (single-tenant) ต้องทำ multi-tenant ก่อนขายเป็นแพ็กเกจให้หลายร้าน

## Blender + Godot landing world

The landing page uses the selected plush mascot artwork (`public/assets/naka-plush-sales.png`) on a shallow 2.5D relief mesh (`public/naka-reference-relief.js`) within a Three.js product stage and four selling-workflow cards. The same image is the no-WebGL fallback. The seated coil stays fixed while a subtle upper-body deformation suggests breathing over a 5.5-second cycle. The pause control freezes the current breath and reduced motion starts with a static pose. This is an illustrated-angle relief, not a reconstructed full-volume character with an authored back. The mesh study is retained in `creative/naka-mesh-study.js`. The earlier Godot 4.5 prototype remains at `public/world/`, with Blender sources in `creative/`.

1. Rebuild the scene and poster with Blender:
   ```powershell
   .\.tools\blender\blender-4.5.0-windows-x64\blender.exe --background --python creative\build_scene.py
   ```
2. Open `creative/godot/project.godot` in Godot 4.5, import the updated GLB, then export the `Web` preset. For the first setup, `node creative/fetch-web-template.cjs` downloads the official single-thread Web template only.
3. Patch the generated loader and compress the WebAssembly file for Cloudflare Assets:
   ```powershell
   npm run world:postprocess
   ```

The post-process step is idempotent. It keeps the deployable gzip file under Cloudflare's per-file asset limit and archives the raw WebAssembly output under the ignored `.tools/godot-build/` directory.

### Godot seller-flow animation

The current landing's combined seller-journey section uses a separate Godot 4.5 2D scene in `creative/godot-flow/`. It uses the selected plush Naka artwork and a product photo to show a product becoming clip, live, and reply work. The scene loads only when near the viewport; HTML remains visible while it loads or if WebGL fails. The three step buttons update the scene through `window.nakaFlowState`. Playback pauses offscreen, when the tab is hidden, when the visitor uses the pause control, or when reduced motion is requested.

To rebuild the web export after editing `creative/godot-flow/`:

```powershell
& '.\.tools\godot\Godot_v4.5-stable_win64_console.exe' --headless --editor --path creative/godot-flow --quit
& '.\.tools\godot\Godot_v4.5-stable_win64_console.exe' --headless --path creative/godot-flow --export-release Web "$((Resolve-Path public/flow).Path)\index.html"
node creative/postprocess-world.cjs flow
```

## Content Studio API

The studio now has four workflows: `/studio/?workflow=sales`, `drama`, `bot`, and `live`. Each has a separate local draft, example, channel selection, and output labels. Anonymous mode uses clearly labeled local templates. Authenticated AI requests use the existing provider and require the admin token.

The request accepts an optional `workflow` (`sales`, `drama`, `bot`, `live`; omitted defaults to sales) and adds `tiktok` and `shopee` to the channel enum. The response keeps its existing field names for compatibility: `captions` contains three short copy variants or replies, `script` contains the main script/dialogue, `plan` contains three production or handoff steps, and `imagePrompt` contains the visual brief or bot playbook appropriate to the workflow. These are text drafts; this release does not render video, deploy comment bots, synthesize avatars, or broadcast livestreams. Existing LINE OA functionality remains in the admin area.

`POST /api/admin/studio` ใช้ `Authorization: Bearer <ADMIN_TOKEN>` และ `Content-Type: application/json`
เพื่อสร้างชุดคอนเทนต์ผ่าน Claude โดยใช้ `ANTHROPIC_API_KEY` ฝั่งเซิร์ฟเวอร์เท่านั้น

```json
{
  "productName": "สบู่มะลิ",
  "details": "สบู่กลิ่นมะลิ น้ำหนัก 100 กรัม",
  "price": "129 บาท",
  "tone": "friendly",
  "channel": "facebook",
  "brandName": "ร้านมะลิ",
  "brandVoice": "อบอุ่น เป็นกันเอง"
}
```

ต้องมี `productName` (ไม่เกิน 160 ตัวอักษร), `details` (3,000), `tone` (`friendly`, `premium`, `playful`)
และ `channel` (`facebook`, `instagram`, `line`) ส่วน `price` (80), `brandName` (160), `brandVoice` (1,000) ไม่บังคับ
ขนาดคำขอรวมไม่เกิน 16 KB ผลลัพธ์คือ `{ mode: "ai", captions: [{ title, text }], script, plan, imagePrompt }`
โดยมีแคปชัน 3 แบบและแผน 3 ขั้นตอน `imagePrompt` เป็นข้อความสำหรับสร้างภาพ ยังไม่ได้สร้างภาพหรือเผยแพร่คอนเทนต์

ข้อผิดพลาดส่ง `{ error: "ข้อความ" }`: `400` ข้อมูลไม่ถูกต้อง, `401` ไม่ผ่านสิทธิ์, `405` วิธีเรียกไม่รองรับ,
`413` ข้อมูลยาวเกิน, `503` ยังไม่ได้ตั้งค่า AI, `502` ผู้ให้บริการขัดข้องหรือผลลัพธ์ไม่ครบ, `504` หมดเวลา (25 วินาที)
รันทดสอบโดยไม่เรียก AI จริงด้วย `node --test tests/studio.test.cjs` และตรวจชนิดข้อมูลด้วย `npm run typecheck`
