# Naka-AI demo film (30 s, 9:16, muted)

Replaces the temporary `public/assets/soap-demo-preview.webm` on the landing page
(review rail card `#rail-review` and the Instagram Reels mock in `#social`).

## Brief

- **Business:** naka-ai.com turns 1–6 product photos plus the seller's real facts into a Thai
  vertical review clip with script, Thai voice-over and a caption that carries the affiliate link.
- **Buyer:** Thai online sellers and affiliate creators (TikTok, Facebook, Instagram, Shopee).
- **Problem:** they have a product photo but no time or skill to make a review clip.
- **Single action:** try it free at naka-ai.com (`/review/?demo=1`).
- **Provably true (from the live product):** 1–6 photos; fields product name, real selling points,
  price, channel, affiliate link; Naka writes the script and voices it in Thai; "คลิปรีวิว 20–35 วินาที ·
  ใช้ 1 เครดิต"; caption with link; free demo mode without signing up.
- **Never claim:** sales numbers, view counts, testimonials, ratings, skin benefits or scent
  performance ("หอมทั้งวัน" etc.). The soap is fictional AI product photography; the film says so.
- **Assets:** `public/assets/soap-campaign.png` (fictional product, blank label),
  `naka-plush-sales.png` (mascot), `public/logo.svg`. No AI video footage; all motion is code.
- **Placement constraints:** shown muted, looping, 232–260 px wide. Card overlays cover the bottom
  ~35 % (title, chip, gradient) and the right edge (social icons), so every reading target sits in the
  top 12–62 % of frame and type is ≥ 54 px on the 1080 × 1920 master (≈ 12 px on the card).
- **Brand:** navy `#091736`, brand blue `#2459d6`, cyan `#14b3d6` / `#9adafc`; IBM Plex Sans Thai
  (display) + Anuphan (UI), matching the site.

## Storyboard

| Time | Viewer sees | Business job | Exit / what survives |
|---|---|---|---|
| 0.0–2.0 | Navy frame, "มีแค่รูปสินค้า / ก็ได้คลิปรีวิว", soap photo as a tilted card | Hook: the promise | Photo flies into the upload slot (persistent actor) |
| 2.0–3.3 | Real review form, photo lands, 2 crop thumbs pop, "3 รูป" | Shows input = photos | Camera pans down the same form |
| 3.3–6.0 | Name types; three fact chips type in; price + channel fill | Facts come from the seller, not invented | Cursor goes to the button |
| 6.0–7.4 | "ให้นาคาเขียนบทและพากย์" pressed, button grows to fill the frame | Cause | Fact chips stay on top |
| 7.4–11.0 | Mascot, three scene cards (ฮุก / จุดเด่นจริง / ชวนกดลิงก์), chips fly into card 2, Thai voice waveform, render progress | Naka writes + voices | Card 1 thumbnail is selected |
| 11.0–12.0 | Card 1 thumbnail expands to full-bleed | Selection → expansion | Same image becomes the clip |
| 12.0–14.8 | Output clip hook "หาสบู่กลิ่นอ่อน ๆ / อยู่ใช่ไหม?" | Shows the result | Whip pan left |
| 14.8–17.6 | Macro, badge 1 "กลิ่นมะลิอ่อน ๆ" | Point 1 | Whip pan left |
| 17.6–20.4 | Second bar, "100 g" stamp lands, badge 2 | Point 2 | Whip pan left |
| 20.4–23.0 | Texture macro, badge 3 "ทำมือ ล็อตเล็ก" | Point 3 | Image recedes and blurs |
| 23.0–25.6 | Product card, shop bar ฿129, "กดลิงก์ในไบโอ ↗" | CTA inside the clip | Clip shrinks into a phone |
| 25.6–28.0 | Three phones (TikTok / Reels / Shopee), "คลิปเดียว โพสต์ได้ทุกช่องทาง", caption-with-link card | Distribution | Phones fly through camera |
| 28.0–29.6 | End card: logo, "รูปสินค้า → คลิปรีวิวพร้อมโพสต์", "ลองฟรีที่ naka-ai.com", disclosure | CTA | Cross-fade to frame 0 (seamless loop) |

Signature transformations: (1) the seller's fact chips are carried out of the form and become the
script of scene 2; (2) the scene-1 thumbnail expands into the finished clip; (3) the finished clip
collapses into a phone and multiplies across channels.

Persistent step pill (from the live page's mini-steps): 01 ใส่รูปและจุดเด่น → 02 นาคาเขียนบทและพากย์ →
03 ตรวจคลิปแล้วโพสต์.

## Build

`film.html` exposes `window.seek(t)`; every state is a pure function of `t` (no rAF, no clocks, no
randomness). `render.cjs` drives Chrome over CDP, captures each frame and pipes PNGs to ffmpeg.

```
node creative/demo-film/render.cjs               # master + web encodes + poster
node creative/demo-film/render.cjs --stills 0,5,9.5,13,19,24.5,27,29   # check frames
```
