# naka-ai design brief

## 1. Product purpose
Lead naka-ai with the simplest seller outcome: upload a product photo and get a finished sales clip ready to publish. Introduce the other capabilities later: AI short dramas, avatar/live selling, automated customer replies, publishing to Shopee/Facebook/TikTok/Instagram, and shared shop memory.

## 2. Primary user
A Thai solo seller or small brand owner preparing product posts on a phone or laptop, without a dedicated creative team.

## 3. Principles
1. Start with the seller's task: one product becomes a useful set of content.
2. Naka is a helpful shop companion. Magic lives in the character and language; outputs remain concrete and editable.
3. Tell users what actually happened: local templates are demonstrations, authenticated provider responses are AI. Do not invent customer proof, integrations, prices or performance claims.
4. The seller's product is the focus in the workspace; the mascot introduces the brand on the landing page.
5. Thai first: short natural labels, generous line height, readable controls on phones.

## 4. Success for this surface
A new visitor understands the product and reaches `/create/`, where they can prepare a product brief and contact the human team. The route is reserved for the future connected creation flow.

## 5. Scope
- Landing, content studio, shop memory and the user's reported production system for media rendering, publishing and customer replies.
- The local checkout audited on 2026-09-28 contains draft-text generation and legacy integrations. The user reports a separate working production system, but its app URL/API and approved example media have not yet been supplied. `/create/` is a temporary stable entry route. The human contact is NAKA-AI Tech at 0892788587. Credit rates are not set; use phone inquiry.
- Do not mention the legacy messaging integration on user-facing surfaces. Avoid unsupported-state copy in the new marketing page.
- Deploy approved landing-page updates to the existing Cloudflare Worker after validation.

## 6. Accepted direction
2026-09-24: User approved the proposed concept and asked to begin. Use white/cobalt robotic naga identity from user reference, pearl white surfaces, blue actions, cyan confined to mascot detail. Existing green/gold landing is superseded by this explicit direction.

2026-10-09/10: One house with Naka Studio supersedes the blue actions and pearl surfaces: neutral grey ground, near-black ink, orange as the one action colour with dark text on it, Kanit + IBM Plex Sans Thai, the same in the studio (light and dark). The white/cobalt naga keeps its colours in the logo and the mascot, which the studio now also shows. Values: `tokens.md`.

## 7. Learned constraints

- **2026-09-28** — Replace the thin, static problems and three-steps blocks with one legible seller journey. Author its moving visual in Godot 4.5 using the currently selected plush Naka and product example, not the retired 3D mascot. Keep the three steps selectable, lazy-load the Godot web scene, pause it offscreen or on request, and show a usable static fallback for reduced motion and loading failures.

- **2026-09-28** — Place the four selectable services immediately after the hero as section two. Align top and mobile navigation with that order. Extend the browsing pattern to a second original naka-ai card set for seller benefits: four visual cards with accessible expand/collapse and mobile swipe controls. Keep service selection, native disclosure semantics, and the existing contact path distinct.

- **2026-09-28** — The four main services should be scannable and selectable like a product browser: four equally prominent visual cards on desktop, a swipeable rail with controls on phones, and service-specific details that change on selection. Adapt this browsing behavior to naka-ai's own visual identity and Thai seller outcomes; do not copy the reference site's imagery or page design. Keep motion short, purposeful, and reduced-motion aware.

- **2026-09-28** — After the first readability pass, the user asked to carry the reference site's broader browsing patterns into naka-ai. Adapt only patterns useful to a Thai AI selling service: a persistent compact navigation, chapter-sized capability stories with direct jump links, and a workflow-aware `/create/` brief for sales video, drama, AI Live, and customer replies. Preserve the single product-photo-first hero, Naga branding, and truthful temporary human-contact handoff. Do not reproduce Apple's page geometry, imagery, copy, icons, or source code.

- **2026-09-28** — The user wants the readability and ease of use seen on Apple Thailand, without copying Apple's visual assets, words, layout, code, or trade dress. Preserve Naka's Naga mascot, blue palette, Thai merchant voice, platform clarity, and existing `/create/` conversion path. Reduce competing hero labels, strengthen type and spacing, make the product video visible sooner on mobile, and enlarge form text and touch targets. Treat this as a reskin and focused UX refinement of the current section order, not an Apple replica.

- **2026-09-28** — The N-shaped icon should visibly be the naga's body and tail, not just a rounded letter with a head. Give the lower-left terminal a readable swept tail fin while preserving the established blue square, right-side head, and compact silhouette at favicon size. Keep SVG, favicon PNG, Apple touch icon, and share card synchronized.

- **2026-09-28** — The user supplied a copy revision for the previous four-workflow landing. Apply its outcome-focused language to the current photo-to-video landing rather than restoring the old layout or routing customers to `/studio/`. The local `/studio/` endpoint only produces editable text drafts; the current public entry is `/create/` for brief preparation and NAKA-AI Tech contact until the external production URL/API is connected. Social metadata must match the live landing, and the share image must use a wide social-card composition.

- **2026-09-28** — Rebuild the landing around one visible result first: “ใส่รูปสินค้า → ได้คลิปขายพร้อมโพสต์”, with an autoplay-muted vertical sample in a phone frame. Then show before/after, familiar seller problems, four AI team cards, three setup steps, trust controls, price inquiry, practical FAQ and human contact. The user says media rendering, avatar/live selling, publishing and automated replies are fully available in their production system. The user approved `/create/` as a temporary stable URL pending connection, temporary labeled media, and phone inquiry instead of unset credit rates.
- **2026-09-27** — The icon is a Naga-shaped N, with the selected plush mascot's swept crest, a small expressive eye, and a restrained cyan accent. It should feel recognizable and playful while remaining clear at favicon size across landing, studio, admin and mobile home-screen icons.
- **2026-09-26** — The user rejected the round-eyed smiling reconstruction because it was a different character. The original white/cobalt artwork is the identity source: dark blue visor, two cyan pill eyes, no mouth or white eyeballs, layered swept crest and broad coiled tail. The shipped hero uses that artwork on a shallow 2.5D relief inside the shop scene, and the same image as the no-WebGL fallback. Describe this honestly as a relief, not a complete 360-degree reconstruction. The older Godot prototype stays in source but its public launch button is hidden until its identity agrees with the main mascot.
- **2026-09-26** — The user chose plush option 2 as the mascot. Integrate that exact white/cobalt felt Naka into the shop scene and poster, harmonize the 3D props with matte, soft materials, and animate subtle upper-body breathing with the seated coil anchored. Whole-body bobbing, scaling and repeated greeting tilts were removed after the user found them unnatural on 2026-09-27. Keep the animation pausable and honor reduced motion. The selected art is an illustrated-angle relief, not a full-volume character.
- **2026-09-25** — The plush cutout composited in front of the 3D shop looked disconnected. This feedback led to the integrated relief and softer stage treatment above.
- **2026-09-25** — The Muse reference suggested a warmer, more expressive companion. A literal plush cutout was explored and rejected because it conflicted with the shop's 3D lighting and materials. Preserve its approachable expression in the native ceramic Naka model instead.
- **2026-09-25** — The mascot must be shown doing the seller's job: taking a real product brief toward a sales clip, customer reply and live plan. A passive naga beside a storefront does not communicate the product or feel memorable. Keep the same recognizable white/cobalt naga identity and make its action legible on phones.
- **2026-09-25** — Real-time 3D must render the naga's face, porcelain body, product, and four workflow cards with clear separation on desktop and mobile. Keep a restrained light rig and correct outward-facing geometry; the optional Godot model should retain the same selling story.
- **2026-09-25** — The first viewport must say plainly that naka-ai helps sell online and show Shopee, Facebook, TikTok, and Instagram together in readable type. Carry those channels into the sales workflow and studio options while staying precise about which integrations actually work. *Why:* the user found the earlier mascot-led message too indirect for online sellers.
- **2026-09-25** — The user replaced the old caption/image/plan categories with exactly four primary services: sales clips, AI short dramas, comment and message bots, AI Live. Carry this structure through navigation, marketing, workspace forms, generation prompts, and downloads. Draft generation is available; video rendering, non-LINE bot integrations, avatars and live broadcasting must remain clearly marked as unavailable.
- **2026-09-25** — Keep the visual language continuous from the 3D night-blue Naga scene through the service examples. Remove the old warm soap photograph and old caption sample; use a service-specific storyboard and Naga world instead. Eliminate the black WebGL rectangle around the model. *Why:* the user found the transition visually disconnected and unattractive in the supplied screenshot.
- **2026-09-25** — Mascot and page composition must feel proportionate, premium, and credible enough to sell to Thai merchants while meeting a global SaaS craft bar. *Why:* oversized image crops and heavy display type made the first version feel like concept art rather than a finished product.
- **2026-09-25** — On every viewport, show the mascot’s face and enough of the coiled body to read as a naga; size the asset by container height, not page width. *Why:* width-led scaling hid the face on phones and let the illustration overpower the product message on desktop.
- **2026-09-25** — Build the landing as a scroll-led miniature world inspired by the supplied reference: one Thai shop changes with each selling task, while a clear studio CTA remains available throughout. Retain the original Blender and Godot sources plus a static fallback. *Why:* the user explicitly chose a cinematic 3D story direction and asked for an implementation with Blender and Godot Engine.
- **2026-09-25** — The hero is a real-time Three.js scene (`public/scene3d.js`, vendored three r180 in `public/vendor/three`): procedural white/cobalt naga, product pedestal, and four service cards that come forward one per scroll chapter. The Blender poster stays as the no-WebGL fallback; Godot stays opt-in. Sections after the story continue the night-blue world rather than switching to white. *Why:* the user found the page lacking charm and asked for 3D at a world-class level.

## Composition
Current marketing surface: a dark blue hero with one large product-video phone, direct Thai selling promise, and a small selected Naka plush mascot supporting the story. Sticky global navigation remains available while the body moves through four selectable service cards with a shared detail panel, result, one seller journey with a lazy-loaded Godot 2D scene and selectable steps, four expandable seller-benefit cards, price, FAQ and final contact sections. Keep the earlier Three.js and Blender/Godot 3D experiments in source history; they are not part of the current public landing. `/create/` provides distinct brief questions per workflow and phone contact until the production creation flow is connected.
