# naka-ai tokens

Source of truth for landing tokens: public/styles.css. Studio uses the same values in its isolated stylesheet.

## Primitive
- Pearl 50 #F7F9FD; white #FFFFFF; blue 50 #EEF4FF; blue 100 #E3EDFF; blue 600 #235BE8; blue 700 #1849C7; navy 900 #15264A.
- Gray 500 #586782; gray 200 #DFE6F1. Cyan is reserved for mascot artwork.
- Space scale: 4, 8, 12, 16, 24, 32, 48, 64, 96, 128 px.
- Type: Anuphan (existing project Thai family), system sans fallback. Weights 400/500/600/700. English brand inherits Anuphan.
- Text sizes: 13/14/16/18/24/36, responsive display 48–80 px. Thai tracking remains natural, body line height 1.7.
- Radius: controls 10 px, panels 20 px, featured visual 28 px, pills 999 px.

## Semantic
- --background: pearl 50; --surface: white; --surface-soft: blue 50.
- --text: navy 900; --muted: gray 500; --line: gray 200.
- --accent: blue 600; --accent-hover: blue 700; --on-accent: white.
- Success/error only for actual state; accompanying text required.

## Component
- Buttons: minimum 44 px target, primary 52 px, 10 px radius.
- Focus ring: 3 px blue, 4 px offset. Controls always keyboard reachable.
- Layout: maximum width 1200 px, 24 px mobile gutters (20 px compact).
- Shadows: subtle ambient and direct layers for raised surfaces, no neon glow.
- Motion: 160–220 ms opacity/color/transform feedback; honor reduced motion.

## Reference search assessment
ui-ux-pro-max query 'AI commerce assistant friendly' matched the SaaS hero/features/CTA structure and minimal accessible controls. Its purple/pink and English-only font suggestions do not fit the accepted brand, so retain user-approved blue and existing Thai Anuphan. No generated search configuration was persisted.
