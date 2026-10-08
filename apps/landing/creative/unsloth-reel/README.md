# Naka Reel: AI clips from Unsloth (MiniMax H3)

The light "AI factory" video wall under the hero (`#reel` in `public/index.html`) works like Buzzy's video grid. A large featured tile (the 3-step production line) opens a grid of 9:16 clips. Each clip is rendered from a single still image by MiniMax H3 running in Unsloth Studio. H3 generates the Thai voice together with the picture. The cards play muted. The speaker button turns on sound for one clip at a time, and "จากรูปนี้" shows the exact first frame that was sent.

| File | Role |
|---|---|
| `shots.json` | Shot list (prompt, first frame, fixed seed, card text) plus filler clips used until 6 H3 clips exist. Shots with `"row"` (review, drama, live or bot) go into that product rail (`<!-- h3:<row>:start/end -->`) instead of the video wall |
| `generate.cjs` | Renders the shots one at a time on the Unsloth server and encodes them to `public/showcase/h3/` |
| `build-reel.cjs` | Writes the band between `<!-- reel:start -->` and `<!-- reel:end -->` (generate runs it after every clip) |

## Setup

Copy `.env.example` to `.env.local` in this folder and fill in both values:

```sh
UNSLOTH_BASE_URL=http://127.0.0.1:8888
UNSLOTH_API_KEY=your-unsloth-key
```

`.env.local` is gitignored. Variables already set in the shell take precedence over the file. The script never prints the key, and it logs only the host of the base URL.

## Run

```sh
node creative/unsloth-reel/generate.cjs --check            # key accepted? which model is loaded? is the GPU busy? (renders nothing)
node creative/unsloth-reel/generate.cjs --dry-run          # build every request locally, send nothing
node creative/unsloth-reel/generate.cjs                    # render all shots that are not rendered yet
node creative/unsloth-reel/generate.cjs --only naka-line   # one shot (comma-separate ids for several)
node creative/unsloth-reel/generate.cjs --only drama-naka --force   # render one shot again
```

- Run `--check` first. A 401 means the key is wrong. The model has to be H3 fl2va (`unsloth/MiniMax-H3-GGUF`, `minimax_h3_fl2va_pruned-Q8_0.gguf`). Load it in Unsloth Studio, or pass `--load` to let the script load it. `--load` is off by default because the GPU is shared with Naka Studio and loading H3 would unload whatever Naka Studio is using.
- Clips are 544×960, 124 frames (5.17 s) and 20 steps. Each takes about 12–16 minutes on the RTX 3090, so all 9 take roughly 2–2.5 hours. If the GPU is busy (409), the script waits for it to free up.
- Clips that are already rendered are skipped. Use `--force` to render them again. Raw server files and the prepared first frames go to `out/`, which is gitignored.
- First frames are fitted to 9:16 on the light section background `#eef2f7` (`"fit": "contain"` keeps the whole image, for example mascot cutouts). Prompts keep scenes bright and daylit to match the light page, and each Thai line stays under about 5 seconds of speech.
- Never commit the API key or the server address.
