# naka-ai bitmap assets

## naka-share-card.png

1200 × 630 Open Graph image for the current product-photo-to-sales-video landing. Source: `creative/landing-v2/share-card.html`; regenerate with `node creative/landing-v2/render-share-card.cjs`. It composes existing Naka mascot and fictional sample product assets without inventing customer proof.

## favicon-32.png and apple-touch-icon.png

Raster versions of the Naga-tail `public/logo.svg`. Regenerate after changing the SVG with `node creative/render-brand-icons.cjs`. The lower-left N terminal is a swept fin with a cyan inset so the letter also reads as the character's tail.

## soap-demo-preview.webm

Temporary muted vertical demonstration clip for the public landing, generated from `soap-campaign.png` with `creative/landing-v2/` source and `.wrangler/qa/generate-sample-video.cjs`. It is labeled as a demonstration on the page. Replace it and the matching image with approved product media when the production asset source is connected.

## naka-sales-world.png

Earlier generated shop-scene exploration. The selected `naka-plush-sales.png` is now used in both the relief mesh and fallback. `naka-world.png` is the source render of the Godot prototype.

Generated on 2026-09-24 using the built-in `image_gen.imagegen` tool, following the imagegen skill. Originals remain under `C:/Users/natta/.codex/generated_images/`. Selected files were copied here for the project.

## naka-plush-sales.png

Selected by the user on 2026-09-26 as option 2 and used in the hero relief and no-WebGL fallback. Generated on 2026-09-25 with the built-in `image_gen.imagegen` tool. The original robotic naga art defined the coiled anatomy and white/cobalt colors. Muse's Veda image was used only as a broad reference for handmade fabric warmth, expressive eyes and a wave. The full-resolution original remains in `C:/Users/natta/.codex/generated_images/01a0d26f-08a0-7633-8ce2-987c8a0c391f/`.

Final prompt:

```text
Use case: style-transfer. Asset type: transparent-background hero mascot cutout for naka-ai, a Thai AI online-selling website. Image 1 is the existing naka-ai naga identity and anatomy; preserve its unmistakable coiled serpent body, upright neck, distinct naga crest and tail, white and cobalt blue palette. Image 2 is only a high-level reference for the cozy hand-crafted plush material, simple friendly face and wave gesture; DO NOT reproduce its human appearance, curly hair, clothing, scarf, skin tone, or exact features. Create an ORIGINAL adorable 3D stuffed-toy naga, premium hand-sewn cotton/velvet texture with subtly visible stitches, rounded chubby head, two large expressive glossy dark-blue eyes with tiny catchlights, a small embroidered friendly smile, short soft fabric crest fins, tiny welcoming front paws (one waving, one presenting a small abstract vertical-video play card), iconic long coiled blue-and-white serpent tail with rounded fins. Adult-friendly character design, warm but credible for Thai merchants. Clean premium studio lighting with soft rim, high legibility at mobile size, front three-quarter view, whole body and tail visible, centered composition. Genuinely transparent background with alpha; no stage, no text, no logos, no extra humans, no exact Muse character elements. 1:1 square image, polished commercial character render.
```

## naka-mascot.png

Identity-preserving cutout from the blue-white robotic naga image supplied by the user. Full body, transparent background, visually inspected for the original character silhouette, visor, crest, coil, and colors.

Final prompt:

```text
Use case: background-extraction
Asset type: naka-ai website hero mascot, square raster cutout.
Input image: the user's attached blue-white robotic Thai naga is the identity reference and edit target.
Primary request: produce a clean isolated high-quality version of exactly this same friendly naga character for a white website hero. Keep its recognisable character, original 3/4 left-facing pose, coiled serpentine body and raised flame-like Thai crest. Keep the pearl-white armor, luminous cobalt-blue and cyan inner body, midnight blue visor with two simple rounded cyan eyes, circular blue ear detail and curling tail. Full body from crest tip through coiled base, generous 6% margins on every edge.
Scene/backdrop: genuinely transparent background with alpha, no simulated checkerboard, no colored rectangle, no scene, no floor plane; only a very subtle soft grounding shadow if transparency supports it.
Style/medium: polished 3D brand mascot, smooth ceramic-like white armor and luminous glass-blue inner surfaces, refined premium friendly technology character. Gentle bright studio lighting that reads well on white.
Constraints: preserve original naga identity and anatomical proportions. It is a Thai naga serpent, no arms, no legs, no wings, no horn redesign, no extra characters, no text, no logo, no watermark. No decorative objects. Actual transparent PNG output requested.
```

## soap-campaign.png

Fictional, AI-generated sample product campaign photograph. Blank packaging; this is demonstration content, not a real seller or testimonial. Visually inspected for clean composition, realistic soap texture, no illegible generated text.

Final prompt:

```text
Use case: product-mockup
Asset type: example generated product campaign photo for naka-ai AI ecommerce website.
Primary request: sophisticated editorial studio product photograph of an artisanal ivory soap bar, showing a believable small-business product elevated into a premium campaign.
Scene/backdrop: seamless pale warm beige background and tabletop; natural ivory travertine stone plinth at center; a single fresh small leafy botanical sprig and soft plant shadows provide texture.
Subject: two solid creamy ivory rectangular handmade soap bars with softly imperfect edges. Main upright bar on the stone block has a simple unprinted pale paper belly band, second bar rests nearby. Main soap occupies center two thirds of image.
Composition/framing: square photograph, three-quarter view, quiet asymmetrical composition balanced for product gallery card cropping. Entire products visible; open upper area. No humans.
Lighting/mood: warm side sunlight from upper left, delicate shadows, tactile realistic material, luxury natural skincare editorial, restrained colors.
Constraints: blank labels without text, no brand marks, no logos, no watermarks, no lettering of any kind. Sharp beautiful soap texture, photographic realism.
```

## card-drama.jpg, card-live.jpg, card-bot.jpg

1600x900 JPEG cover illustrations added 2026-09-29 for the team service cards
(drama / live / bot), replacing the old CSS-only placeholder art. Generated with
Seedream 5.0 image-to-image using `naka-plush-sales.png` as the identity
reference so the plush naga character stays on-model. Thai-style scenes: film
director set with Thai cinema backdrop (drama), livestream table with mangoes,
jasmine garland and Thai silk (live), chat-helper at a Thai shop counter with
blank speech bubbles (bot). The sales card keeps its video artwork.
