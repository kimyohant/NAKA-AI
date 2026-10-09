/**
 * Art style catalog for the drama studio, modelled on Topview Drama Studio's "Art Style" picker (Live Action /
 * Animation / Custom), for study. Seeded like the 8 built-in presets (seed.ts): inserted when the value is
 * missing, never overwriting a preset someone edited.
 *
 * Names follow Topview's cards. The prompts describe the look itself (medium, light, palette, lens, setting)
 * rather than naming a director, studio or franchise: image models refuse or drift on "in the style of <person>",
 * and the description is what actually carries the look. Every character is an original, fictional one.
 *
 * Example images: public/studio-art/styles/<value>.webp (the frontend's styleExample()); styles without one show
 * the gradient card until a preview is generated in Settings → styles.
 * Live action: some video providers refuse reference images that look like real people (the reason the old
 * "live" preset was retired in seed.ts); the drama page says so on that tab.
 */
export type ArtStyleCategory = 'live_action' | 'animation'

export interface ArtStyleSeed {
  name: string
  value: string
  category: ArtStyleCategory
  sortOrder: number
  prompt: string
  description: string
}

const LIVE_TAIL = 'original fictional cast with no celebrity likeness, consistent actor appearance and wardrobe across shots, avoid cartoon or anime features, avoid 3D render look, avoid illustration style, avoid plastic waxy skin, avoid text and logos'
const ANIM_TAIL = 'original fictional characters, consistent character design across shots, avoid photorealism unless stated, avoid text and logos'

const live = (sortOrder: number, value: string, name: string, description: string, look: string): ArtStyleSeed =>
  ({ name, value, category: 'live_action', sortOrder, description, prompt: `live-action film still, ${look}, ${LIVE_TAIL}` })
const anim = (sortOrder: number, value: string, name: string, description: string, look: string): ArtStyleSeed =>
  ({ name, value, category: 'animation', sortOrder, description, prompt: `${look}, ${ANIM_TAIL}` })

export const artStyleSeeds: ArtStyleSeed[] = [
  // ---------- Live Action (Topview's 19) ----------
  live(101, 'live-cinematic', 'Theatrical Cinematic', 'Live-Action · Realistic · Premium',
    'premium theatrical feature-film look, anamorphic widescreen framing, rich filmic color grading with deep shadows and warm highlights, motivated natural lighting, shallow depth of field, subtle 35mm film grain, detailed real-world locations'),
  live(102, 'live-microdrama', 'Modern Micro-drama', 'Rise-Up · Revenge · Urban',
    'modern vertical short-drama look, bright clean commercial lighting, glossy saturated urban colors, dramatic close-ups and reaction shots, contemporary city offices, apartments and streets, high-energy confrontational staging'),
  live(103, 'live-arthouse', 'French Arthouse', 'Arthouse · Parisian · Intimate',
    'intimate European arthouse cinema look, soft overcast natural light, muted pastel and cream palette, handheld observational framing, lived-in apartments and cafés, long contemplative compositions, delicate 16mm film texture'),
  live(104, 'live-monumental', 'Monumental Epic', 'Dune · Monumental · Sacred',
    'monumental science-fiction epic look, vast brutalist architecture and desert scale, tiny figures against colossal structures, hazy sun-bleached ochre and sand palette, diffused sacred light shafts, austere minimal compositions, ultra-wide lenses'),
  live(105, 'live-bollywood', 'Bollywood', 'Bollywood · Festive · Ornate',
    'vibrant Indian musical cinema look, ornate festive costumes and jewelry, saturated jewel-tone palette of magenta, saffron and gold, sparkling string lights and bokeh, grand celebratory set design, glamorous high-key lighting'),
  live(106, 'live-nordic-noir', 'Nordic Noir', 'Scandinavian · Bleak · Cold',
    'Scandinavian crime-series look, bleak cold desaturated blue-gray palette, overcast flat light and long winter dusk, minimalist modern interiors and lonely coastal landscapes, quiet tense framing, cold breath and wet surfaces'),
  live(107, 'live-western', 'Golden Western', 'Western · Ranch · Golden Hour',
    'classic western film look, golden-hour backlight over open ranch land and canyons, warm amber and dust palette, weathered leather, denim and wood textures, wide landscape compositions, lens flare and drifting dust'),
  live(108, 'live-pop-dystopia', 'Pop Dystopia', 'Survival Game · Primary Colors · Tension',
    'pop dystopian survival-game look, bold flat primary colors of pink, green and teal, uniform tracksuits and masked guards, symmetrical playful-yet-sinister sets, harsh clean overhead lighting, unsettling contrast of childlike design and danger'),
  live(109, 'live-prestige', 'Prestige HBO Drama', 'Corporate · Power · Cold Luxury',
    'prestige television drama look, cold luxurious corporate interiors of glass, steel and marble, controlled low-key lighting, restrained desaturated palette with cool highlights, composed power-dynamic framing, expensive tailored wardrobe'),
  live(110, 'live-desert-crime', 'Gritty Desert Crime', 'Desert · Crime · Sun-Baked',
    'gritty desert crime-thriller look, harsh overhead sun and heat haze, sun-baked yellow and dusty orange grade, sweat, grime and weathered skin texture, empty highways, motels and scrubland, tense wide shots'),
  live(111, 'live-pastel', 'Wes Anderson Style', 'Symmetry · Pastel · Refined',
    'whimsical symmetrical storybook live-action look, perfectly centered one-point compositions, curated pastel palette of pink, mint and butter yellow, flat frontal staging, meticulous miniature-like set dressing, soft even lighting'),
  live(112, 'live-surreal', 'David Lynch Style', 'Surreal · Eerie · Dreamlike · Dark',
    'surreal eerie dreamlike thriller look, deep red curtains and dim retro interiors, pools of tungsten light in darkness, slow uncanny staging, saturated reds against black, unsettling quiet atmosphere, soft film grain'),
  live(113, 'live-retro-cult', 'Quentin Tarantino Style', 'Violent · Retro · Cult',
    'retro cult crime-film look, saturated 1970s grindhouse palette, neon diner and bar signs, low trunk-shot and wide two-shot framing, bold red and yellow accents, vintage cars and costumes, gritty film grain'),
  live(114, 'live-mind-bending', 'Christopher Nolan Style', 'Mind-Bending · Cool · Grand · IMAX',
    'grand mind-bending blockbuster look, large-format IMAX clarity, cool steel-blue and charcoal grade, practical large-scale sets and real locations, precise architectural compositions, dramatic natural light, sober tailored wardrobe'),
  live(115, 'live-scifi', 'Blade Runner Style', 'Future · Ruins · Solitude',
    'neon-noir future-city look, rain-soaked streets under towering megastructures, teal and amber neon haze, volumetric fog and backlight, lonely figures among ruins and holograms, slow melancholic atmosphere'),
  live(116, 'live-kdrama', 'Modern K-Drama', 'Romance · Urban · Idol',
    'modern Korean romance-drama look, soft glowing beauty lighting, clean bright pastel-neutral palette, fashionable urban cafés and city lights at night, flawless styling, gentle bokeh, tender close-ups'),
  live(117, 'live-noir', 'Crime Drama', 'Cartel · Prison · Drama',
    'hard-edged crime drama look, low-key single-source lighting with deep blacks, gritty urban alleys, safe houses and prison corridors, desaturated green-brown grade, sweat and smoke, tense handheld close-ups'),
  live(118, 'live-dark-fantasy', 'Game of Thrones Style', 'Medieval · War · Epic · Dark',
    'dark medieval fantasy epic look, cold stone castles and misty battlefields, firelight and overcast daylight, muted steel, fur and leather palette, armor and banners, epic wide establishing shots, gritty realism'),
  live(119, 'live-european-epic', 'European Epic', 'Epic · Historical · Grand',
    'grand historical epic look, ancient Roman and European legions, polished bronze armor and red cloaks, dusty arenas and marble forums, warm golden sunlight, sweeping crowd scenes, heroic low-angle framing'),
  // ---------- Live Action: Thai stories (example images from the earlier catalog) ----------
  live(120, 'live-thaiperiod', 'Thai Period Drama', 'Thai Period · Palace · Elegant',
    'Thai historical period drama look, ornate palace interiors with gilded teak and candlelight, traditional Thai silk costumes and gold jewelry, warm amber palette, graceful formal staging, rich fabric and lacquer textures'),
  live(121, 'live-epic', 'Thai Historical Epic', 'Battle · War Elephants · Ancient Siam',
    'ancient Siam battle epic look, war elephants and armies with banners, dusty battlefields and temple spires, warm smoky sunlight, bronze and earth palette, sweeping wide shots, heroic scale'),
  live(122, 'live-family', 'Family Drama', 'Family · Warm · Everyday',
    'warm Thai family drama look, sunlit home kitchens and living rooms, natural soft daylight, cozy warm palette, candid laughter and everyday moments, gentle handheld framing'),
  live(123, 'live-horror', 'Thai Horror', 'Ghost · Dark · Suspense',
    'Thai ghost-horror look, dark hospital corridors and old houses, flashlight beams cutting through green-tinted darkness, deep shadows, eerie stillness, suspenseful framing'),

  // ---------- Animation (Topview's 20; Cinematic 3D, Ghibli, Korean Webtoon, Monochrome Manga and Chinese-style 3D are the built-in 3d / ghibli / webtoon / noir / guofeng) ----------
  anim(201, 'anim-soft-contemporary', 'Soft Contemporary Anime', 'Urban · Romance · Gentle',
    'soft contemporary anime look, gentle pastel cel shading with soft gradients, clean thin line art, warm natural daylight, everyday urban settings, cafés and trains, delicate romantic atmosphere'),
  anim(202, 'anim-mature-western', 'Mature Western Animation', 'Adult · Dark · Cinematic',
    'mature western adult-animation look, angular stylized character design, heavy cinematic shadows, muted dark palette with neon accents, painted urban backgrounds, dramatic camera angles'),
  anim(203, 'anim-spider-verse', 'Spider-Verse Style', 'Comic Book · Halftone · Pop',
    'graphic comic-book 3D animation look, halftone dots and offset color printing, bold ink outlines on 3D forms, chromatic aberration, pop-art saturated colors, stepped low-frame-rate motion feel, dynamic graffiti energy'),
  anim(204, 'anim-cyberpunk-3d', '3D Cyberpunk', 'Neon · Cybernetic · Futuristic',
    '3D cyberpunk animation look, stylized cybernetic characters, neon magenta and cyan rim light, rain-slick futuristic streets, holographic signage, high-contrast cinematic render'),
  anim(205, 'anim-cthulhu', 'Cthulhu Style', 'Eldritch · Dark Souls · Bloodborne',
    'dark gothic eldritch fantasy look, decaying cathedrals and fog, tentacled cosmic horrors, plague-doctor and hunter silhouettes, desaturated sepia and moss palette, painterly dark-souls atmosphere'),
  anim(206, 'anim-ink-wash', 'Color Ink Wash', 'Traditional · Colorful',
    'traditional East Asian color ink-wash painting look, expressive brush strokes, splashes of vermilion, indigo and gold over rice paper texture, flowing robes, dynamic martial poses, bleeding pigment edges'),
  anim(207, 'anim-horror-manga', 'Junji Ito-inspired', 'Horror · Dense · Madness',
    'dense black-and-white horror manga look, obsessive fine-line hatching, spirals and grotesque body horror, wide unblinking eyes, claustrophobic panels, stark ink contrast, creeping madness, strictly no color'),
  anim(208, 'anim-thriller-folklore', 'Thriller Folklore', 'Gloomy · Suspenseful',
    'gloomy folklore-thriller anime look, dim desaturated palette, misty villages and shrines at dusk, heavy shadows and lantern light, suspenseful framing, unsettling quiet'),
  anim(209, 'stopmotion-clay', 'Clay Stop-Motion', 'Claymation · Stop-motion · Handmade',
    'clay stop-motion animation look, plasticine characters with visible fingerprints and tool marks, handmade miniature sets, soft studio lighting, slightly imperfect charming shapes, tactile textures'),
  anim(210, 'anim-felt', 'Felt Stop-Motion', 'Felt · Soft · Handmade',
    'felt stop-motion animation look, needle-felted wool characters with fuzzy fibers, stitched details, cozy miniature sets, warm soft lighting, gentle muted palette, handmade storybook charm'),
  anim(211, 'anim-retro90s', 'Retro 90s Cel Anime', '90s · Mecha · Sports',
    'retro 1990s cel anime look, hand-painted cels with slight grain, bold outlines, limited flat shading, slightly faded warm palette, VHS-era softness, mecha and sports-anime energy'),
  anim(212, 'anime-battle', 'High-Energy Battle', 'Combat · Action · VFX',
    'high-energy battle anime look, explosive speed lines and impact frames, glowing elemental VFX, dynamic extreme angles, crisp cel shading with bold highlights, debris and shockwaves'),
  anim(213, 'cel3d-nextgen', 'Next-Gen Cel-Shaded 3D', 'Cel-Shaded · Game · Star Rail',
    'next-gen cel-shaded 3D game-animation look, toon-shaded characters with crisp outlines, vivid saturated colors, glossy stylized materials, bright clean lighting, polished action-RPG key art quality'),
  anim(214, 'painterly3d', 'Painterly Cel-Shaded', 'Arcane · Brushwork · Dramatic',
    'painterly 3D animation look, hand-painted brushstroke textures over 3D forms, dramatic rim and lantern light, rich warm and teal palette, expressive stylized faces, illustrated background depth'),
  anim(215, 'anim-pixar-3d', 'Pixar 3D', 'Family Animation · Warm · Expressive',
    'family feature 3D animation look, appealing rounded character design with large expressive eyes, soft subsurface skin, warm bounce lighting, rich saturated colors, detailed cozy environments, polished feature-film render'),
]
