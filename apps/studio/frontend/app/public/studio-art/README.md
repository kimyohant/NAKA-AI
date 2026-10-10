# studio-art

These are preview images for Product Studio's Creative Gallery and the agent skill library. Paths are built by `app/utils/studioArt.js`. Each card falls back to its icon or text-only layout when an image fails to load.

| Folder | Count | Size | Used by |
|---|---|---|---|
| `templates/<templateId>/<beauty\|food\|fashion\|gadget\|home\|health>.webp` | 72 | 480×840 | `StudioTemplateCard`. Hover or focus cycles through the six product categories. |
| `skills/<librarySkillId>/still.webp`, `clay.webp` | 64 | 480×480 | Skill library cards in Settings. `still` is the banner and `clay` is the corner icon. |
| `covers/template-category/<category>.webp` | 5 | 960×548 | Gallery banner when a category filter is on |
| `covers/skill-category/<category>.webp`, `covers/agent/<agent>.webp` | 9 | 960×548 | Skill library banner when an agent or category filter is on |
| `styles/<style value>.webp` | 351 | 480×274 | Home-page style picker and Settings → visual styles (when a preset has no generated preview). Built-in styles, the imported catalog and the drama art styles (backend `core/db/style-seeds.ts`), a different scene per style; the 305-style hand-drawn library (`handraw-<number>`, imported from Settings), one scene per group FA–FH so a group compares cleanly; custom styles keep the gradient card |
| `menus/<id>.webp` (`menuArt()`) | 12 | 1600×914 banners, 960×548 cards, 540×945 Live preview | Top banners of AI Seller, AI Marketer, AI Live and the Skill library (`MenuHeroArt.vue`), the 7 workflow cards of the Skill library, and the empty AI Live preview |

- Every image was generated with Qwen-Image 2.1 on the Unsloth Studio server: 30 steps, guidance 4, fixed seeds 810001–810150 (style examples: 820001–820022, prompt = shared scene + the style's own prompt).
- The 24 drama art style examples added in 2026-10 were generated with Qwen-Image 2.1 FP8 on the same server through the studio's own `/tasks` image API (1344×768, server-default steps), prompt = the style's own prompt + a scene that suits it; resized to 480×274 webp.
- The 305 hand-drawn library covers (2026-10) came from the same pipeline: prompt = the style's own prompt + its group's scene (FA office worker spilling coffee, FB girl and dog in a meadow, FC cyclist in the city, FD schoolgirl under cherry blossoms, FE lady on a stone bridge, FF tiny baker's stall, FG young hero before a castle, FH street musician at a night market), asking for one single image with no text. Every cover was checked by eye. Styles whose look is partly lettering (notebook doodles, literati ink with calligraphy, punk ink-and-text) keep their pseudo-lettering. The styles named after a show or a painter (FG-004, FG-007, FG-012, FG-015, FG-016, FH-042) use an original girl in a green cloak (FH-042: a woman in a yellow raincoat) so no existing character or real person appears; FG-004 used a look-only prompt because its traits describe that show's characters.
- The menu photos (2026-10) are ad-style photography made with Qwen-Image 2.1 FP8 on the same server through `/tasks` (1344×768, the Live preview 768×1344): fictional Thai models, products, studio light, no text or logos. The banner subjects sit on the right so the title reads on the faded left (`hero-live` was mirrored for that). The AI Marketer starter cards (`public/marketer-media/way/<key>.webp`) were replaced the same way and their isometric hover clips removed.
- The prompts, seeds and full-size JPEGs live outside the repo in `studio-image-pack/` (`build-prompts.cjs`, `generate.cjs`, `manifest.json`).
- All people, products and shops are fictional. The prompts ask for no text, logos or brands.
- `tests/studio-art-structure.test.mjs` fails if a template or library skill is added without art.
