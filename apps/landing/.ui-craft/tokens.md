# naka-ai tokens

One house with Naka Studio (since 2026-10-09, commit 3d41b3e). Source of truth: `public/ui-land.css` (loaded last on every public page) for naka-ai.com, and `apps/studio/frontend/app/assets/studio.css` for the studio, which carries the same values. Change both together.

## Primitive
- Ground #F7F8FA; surface #FFFFFF; gray #EEF0F3 / #E3E6EB; line #E7E9EE.
- Ink #17181A; ink-2 #5C6370; ink-3 #8A919D.
- Orange: action #F97316 (hover #FB8A3C); brand text #EA580C; brand ink #C2410C; on dark #FB923C; tint #FFF1E7.
- Night band (dark sections, studio dark theme ground): #17181A / #232529, line rgba(255,255,255,.09), ink #F4F5F7 / #A9AFBA. The studio's dark theme uses its near-black surfaces (#141414 / #1C1C1E) with the same orange.
- Cobalt #1D50BE is the logo and Naka only, never an action colour. Cyan stays inside the mascot artwork.
- Type: Kanit for headings and the display face, IBM Plex Sans Thai for text (the studio uses the same pair).
- Space scale: 4, 8, 12, 16, 24, 32, 48, 64, 96, 128 px.
- Radius: panels 20 px, pills 999 px.

## Semantic
- --bg: ground; --surface: white; --text: ink; --muted: ink-2; --line: line.
- --action: orange; text on an orange fill is ink (#17181A): white on #F97316 is 2.8:1, ink is 6.3:1. The studio names this --action-primary-text.
- Orange used as text on the light ground is the darker brand text (#EA580C) or brand ink (#C2410C).
- Success/error only for actual state; accompanying text required.

## Component
- Buttons: minimum 44 px target, primary 48 px (landing), ink on orange; ghost #E8EAEE.
- Focus ring visible on every control; controls always keyboard reachable.
- Layout: maximum width 1200 px, 16–24 px mobile gutters; at 390 px nothing may scroll sideways.
- Shadows: soft and sparse (--u-float); no neon glow.
- Motion: 160–220 ms opacity/color/transform feedback; honor reduced motion.

## History
- 2026-09-24 → 10-08: pearl/cobalt with blue actions and Anuphan (the earlier version of this file). Superseded by the one-house restyle above; the cobalt now lives only in the logo and Naka.
