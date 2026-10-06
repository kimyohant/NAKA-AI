# studio-art

These are preview images for Product Studio's Creative Gallery and the agent skill library. Paths are built by `app/utils/studioArt.js`. Each card falls back to its icon or text-only layout when an image fails to load.

| Folder | Count | Size | Used by |
|---|---|---|---|
| `templates/<templateId>/<beauty\|food\|fashion\|gadget\|home\|health>.webp` | 72 | 480×840 | `StudioTemplateCard`. Hover or focus cycles through the six product categories. |
| `skills/<librarySkillId>/still.webp`, `clay.webp` | 64 | 480×480 | Skill library cards in Settings. `still` is the banner and `clay` is the corner icon. |
| `covers/template-category/<category>.webp` | 5 | 960×548 | Gallery banner when a category filter is on |
| `covers/skill-category/<category>.webp`, `covers/agent/<agent>.webp` | 9 | 960×548 | Skill library banner when an agent or category filter is on |
| `styles/<style value>.webp` | 22 | 480×274 | Home-page style picker and Settings → visual styles (when a preset has no generated preview); a different scene per style. Built-in styles and the imported catalog; custom styles keep the gradient card |

- Every image was generated with Qwen-Image 2.1 on the Unsloth Studio server: 30 steps, guidance 4, fixed seeds 810001–810150 (style examples: 820001–820022, prompt = shared scene + the style's own prompt).
- The prompts, seeds and full-size JPEGs live outside the repo in `studio-image-pack/` (`build-prompts.cjs`, `generate.cjs`, `manifest.json`).
- All people, products and shops are fictional. The prompts ask for no text, logos or brands.
- `tests/studio-art-structure.test.mjs` fails if a template or library skill is added without art.
