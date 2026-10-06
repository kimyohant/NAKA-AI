// Render the landing "reel" clips with MiniMax H3 on an Unsloth Studio server, one at a time.
//
//   node creative/unsloth-reel/generate.cjs     (credentials from the env or creative/unsloth-reel/.env.local)
//
// Credentials: UNSLOTH_BASE_URL and UNSLOTH_API_KEY. Variables already set in the environment win over
// creative/unsloth-reel/.env.local (gitignored; copy .env.example). The key is never printed and only
// the host of the base URL is logged.
// Flags: --check (verify the key, loaded model and GPU state; renders nothing) · --dry-run (build
//        requests, send nothing) · --only <id>[,<id>] · --force (re-render) · --steps <n> (default 20) ·
//        --load (load H3 if another model is loaded; off by default because the GPU is shared with
//        Naka Studio).
// Same native endpoints and job matching as Naka Studio's unsloth adapter: POST
// /api/inference/video/generate returns no job id, so each shot carries its own seed and the
// system-wide generate-progress result is accepted only when its seed matches.
// Outputs: public/showcase/h3/<id>.mp4 (540×960, H.264 + AAC, Thai audio kept), <id>.jpg poster,
// <id>-from.jpg (the exact first frame sent). Raw server files stay in creative/unsloth-reel/out/.
// After each clip, build-reel.cjs rewrites the reel band in public/index.html.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '../..');
const PUBLIC = path.join(ROOT, 'public');
const OUT_WEB = path.join(PUBLIC, 'showcase', 'h3');
const OUT_RAW = path.join(__dirname, 'out');

// Light "AI factory" section background; first frames are composited on it (contain padding, PNG alpha)
const PAD_COLOR = '0xeef2f7';

// MiniMax-H3 lattice and presets (video/status of family minimax-h3)
const FPS = 24;
const NUM_FRAMES = 124; // 17k + 5, the shortest clip H3 accepts (5.17 s)
const WIDTH = 544;
const HEIGHT = 960;
const REPO = 'unsloth/MiniMax-H3-GGUF';
const GGUF = 'minimax_h3_fl2va_pruned-Q8_0.gguf';

const args = process.argv.slice(2);
const flag = name => args.includes(name);
const value = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const DRY = flag('--dry-run');
const CHECK = flag('--check');
const FORCE = flag('--force');
const LOAD = flag('--load');
const STEPS = Number(value('--steps')) || 20;
const ONLY = (value('--only') || '').split(',').filter(Boolean);

/** Load KEY=VALUE lines from a dotenv-style file without overriding variables that are already set. */
function loadEnvFile(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return false; }
  for (const raw of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let val = m[2].trim();
    if (/^(['"]).*\1$/.test(val)) val = val.slice(1, -1);
    if (!process.env[m[1]]) process.env[m[1]] = val;
  }
  return true;
}
loadEnvFile(path.join(__dirname, '.env.local'));

const BASE = (process.env.UNSLOTH_BASE_URL || '').trim().replace(/\/+$/, '');
const KEY = (process.env.UNSLOTH_API_KEY || '').trim();
if (!DRY && (!BASE || !KEY)) {
  console.error('ยังไม่ได้ตั้ง UNSLOTH_BASE_URL / UNSLOTH_API_KEY: ใส่ใน creative/unsloth-reel/.env.local (คัดลอกจาก .env.example)');
  console.error('Set UNSLOTH_BASE_URL and UNSLOTH_API_KEY in creative/unsloth-reel/.env.local or the environment (see README.md).');
  process.exit(1);
}
/** Host of the base URL only; the full URL and the key are never logged. */
function baseHost() {
  try { return new URL(BASE).host; } catch { return '(invalid UNSLOTH_BASE_URL)'; }
}
const KEY_REJECTED = 'Unsloth ปฏิเสธ API key (401): ตรวจ UNSLOTH_API_KEY ใน .env.local / Unsloth rejected the API key (401): check UNSLOTH_API_KEY.';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const stamp = () => new Date().toTimeString().slice(0, 8);
const log = (...m) => console.log(`[${stamp()}]`, ...m);

function ffmpeg(argv) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...argv], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr || r.error}`);
}

function frameSize(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffprobe failed: ${r.stderr || r.error}`);
  const [w, h] = r.stdout.trim().split(',').map(Number);
  return { w, h };
}

async function api(method, p, body) {
  const res = await fetch(BASE + p, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(120_000),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, ok: res.ok, json, text };
}

/** Fit the source image to 9:16 at the H3 preset size; this exact frame is also shown on the card. */
function prepareFirstFrame(shot) {
  if (!shot.first_frame) return null;
  const src = path.join(PUBLIC, shot.first_frame);
  if (!fs.existsSync(src)) throw new Error(`first_frame not found: public/${shot.first_frame}`);
  const framePath = path.join(OUT_RAW, `${shot.id}-first.jpg`);
  // 'contain' keeps the whole image (cutouts like the mascot stay uncropped); the default 'cover'
  // fills and crops. Both sit on the light section background, so PNG alpha never turns black.
  const fit = shot.fit === 'contain'
    ? `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease:flags=lanczos`
    : `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase:flags=lanczos,crop=${WIDTH}:${HEIGHT}`;
  ffmpeg(['-f', 'lavfi', '-i', `color=${PAD_COLOR}:s=${WIDTH}x${HEIGHT}`, '-i', src, '-filter_complex',
    `[1]${fit}[f];[0][f]overlay=(W-w)/2:(H-h)/2,format=yuvj420p`, '-frames:v', '1', '-q:v', '2', framePath]);
  const { w, h } = frameSize(framePath);
  if (w !== WIDTH || h !== HEIGHT) throw new Error(`first frame is ${w}×${h}, expected ${WIDTH}×${HEIGHT}`);
  if (!DRY) ffmpeg(['-i', framePath, '-vf', 'scale=180:320:flags=lanczos', '-q:v', '4', path.join(OUT_WEB, `${shot.id}-from.jpg`)]);
  return 'data:image/jpeg;base64,' + fs.readFileSync(framePath).toString('base64');
}

const isH3Ready = st => st.loaded && String(st.repo_id || '').toLowerCase() === REPO.toLowerCase() && (!st.h3_task || st.h3_task === 'fl2va');

async function ensureModel() {
  const s = await api('GET', '/api/inference/video/status');
  if (s.status === 401) throw new Error(KEY_REJECTED);
  if (!s.ok) throw new Error(`video/status HTTP ${s.status}`);
  const st = s.json || {};
  if (isH3Ready(st)) return;
  if (!LOAD) throw new Error(`H3 (fl2va) is not loaded on the server (loaded: ${st.repo_id || 'nothing'}). Load it in Unsloth Studio, or rerun with --load.`);
  log('loading H3 fl2va…');
  const l = await api('POST', '/api/inference/video/load', { model_path: REPO, gguf_filename: GGUF, h3_task: 'fl2va' });
  if (!l.ok) throw new Error(`video/load HTTP ${l.status} ${l.text.slice(0, 200)}`);
  for (const deadline = Date.now() + 30 * 60_000; Date.now() < deadline;) {
    await sleep(5_000);
    const p = await api('GET', '/api/inference/video/load-progress');
    if (p.json?.phase === 'ready') return;
    if (p.json?.phase === 'error') throw new Error(`model load failed: ${p.json.error}`);
  }
  throw new Error('model load timed out after 30 minutes');
}

const IDLE_PHASES = new Set(['', 'idle', 'completed', 'complete', 'done', 'failed', 'error', 'cancelled', 'canceled']);
const pctOf = p => (p.progress != null ? ` ${Math.round(Number(p.progress) * (Number(p.progress) <= 1 ? 100 : 1))}%` : '');

/** --check: verify the key, report the loaded model and whether the GPU is rendering. Renders nothing. */
async function check() {
  log(`Unsloth server: ${baseHost()}`);
  const s = await api('GET', '/api/inference/video/status');
  if (s.status === 401) { console.error(KEY_REJECTED); process.exitCode = 1; return; }
  if (!s.ok) { console.error(`video/status HTTP ${s.status}`); process.exitCode = 1; return; }
  log('API key: accepted / คีย์ใช้ได้');
  const st = s.json || {};
  log(`model: ${st.loaded ? st.repo_id || '(unknown repo)' : 'nothing loaded / ยังไม่ได้โหลดโมเดล'}${st.h3_task ? ` · h3_task ${st.h3_task}` : ''}`);
  log(isH3Ready(st)
    ? 'H3 fl2va: ready / พร้อมเรนเดอร์'
    : `H3 fl2va: not loaded / ยังไม่พร้อม. Load ${REPO} (${GGUF}, task fl2va) in Unsloth Studio, or render with --load`);

  const g = await api('GET', '/api/inference/video/generate-progress');
  if (!g.ok) { log(`generate-progress HTTP ${g.status}`); process.exitCode = 1; return; }
  const p = g.json || {};
  const phase = String(p.phase || '').toLowerCase();
  log(IDLE_PHASES.has(phase)
    ? `GPU: free / GPU ว่าง (last phase: ${phase || 'none'})`
    : `GPU: busy / GPU กำลังเรนเดอร์งานอื่น (${phase}${pctOf(p)}); a render would wait for it`);
}

async function submit(body) {
  // 409 = the GPU is busy with someone else's render; wait for the slot (up to 2 h)
  // A dropped connection ("fetch failed") right after the previous clip's export is common: the
  // server is not ready for a new job yet. Retry those a few times instead of skipping the shot.
  let dropped = 0;
  for (let attempt = 0; attempt < 480; attempt++) {
    let r;
    try {
      r = await api('POST', '/api/inference/video/generate', body);
    } catch (err) {
      if (++dropped > 8) throw err;
      log(`  connection dropped (${err.message}), retrying in 20 s…`);
      await sleep(20_000);
      continue;
    }
    if (r.ok && r.json?.status === 'started') return;
    if (r.status === 401) throw new Error(KEY_REJECTED);
    if (r.status === 409 || /busy|in[- ]?progress|already/i.test(r.text)) {
      if (attempt % 8 === 0) log('  server busy, waiting for the GPU…');
      await sleep(15_000);
      continue;
    }
    throw new Error(`generate HTTP ${r.status} ${r.text.slice(0, 300)}`);
  }
  throw new Error('GPU stayed busy for 2 hours');
}

async function waitForResult(seed) {
  const started = Date.now();
  let lastPhase = '';
  for (const deadline = started + 60 * 60_000; Date.now() < deadline;) {
    await sleep(10_000);
    const r = await api('GET', '/api/inference/video/generate-progress');
    if (!r.ok) continue;
    const p = r.json || {};
    if (p.phase === 'completed' && p.video) {
      if (String(p.video.seed) !== String(seed)) continue; // another job's result
      return p.video;
    }
    if (p.phase === 'failed') throw new Error(`render failed: ${p.error || 'unknown error'}`);
    const line = `${p.phase || 'waiting'}${pctOf(p)}`;
    if (line !== lastPhase) { log(`  ${line} (${Math.round((Date.now() - started) / 60000)} min)`); lastPhase = line; }
  }
  throw new Error('render did not finish within 60 minutes');
}

async function download(url, file) {
  const full = /^https?:\/\//.test(url) ? url : BASE + (url.startsWith('/') ? '' : '/') + url;
  const res = await fetch(full, { headers: { Authorization: `Bearer ${KEY}` }, signal: AbortSignal.timeout(300_000) });
  if (!res.ok) throw new Error(`download HTTP ${res.status}`);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}

function encodeWeb(shot, raw) {
  const mp4 = path.join(OUT_WEB, `${shot.id}.mp4`);
  ffmpeg(['-i', raw, '-vf', 'scale=540:960:flags=lanczos', '-c:v', 'libx264', '-preset', 'slow', '-crf', '24', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '96k', '-ar', '44100', '-movflags', '+faststart', mp4]);
  ffmpeg(['-ss', '0.4', '-i', raw, '-vf', 'scale=540:960:flags=lanczos', '-frames:v', '1', '-q:v', '3', path.join(OUT_WEB, `${shot.id}.jpg`)]);
}

function rebuildReel() {
  const r = spawnSync(process.execPath, [path.join(__dirname, 'build-reel.cjs')], { stdio: 'inherit' });
  if (r.status !== 0) log('build-reel failed (clip is saved; rerun build-reel.cjs)');
}

(async () => {
  if (CHECK) return check();
  const { shots } = JSON.parse(fs.readFileSync(path.join(__dirname, 'shots.json'), 'utf8'));
  const queue = shots.filter(s => (!ONLY.length || ONLY.includes(s.id)) && (FORCE || DRY || !fs.existsSync(path.join(OUT_WEB, `${s.id}.mp4`))));
  fs.mkdirSync(OUT_WEB, { recursive: true });
  fs.mkdirSync(OUT_RAW, { recursive: true });
  if (!queue.length) { log('nothing to render (use --force to re-render)'); return; }
  log(`${queue.length} clip(s) · ${WIDTH}×${HEIGHT} · ${NUM_FRAMES} frames · ${STEPS} steps · ≈15 min each · ${DRY ? 'dry run' : baseHost()}`);
  if (!DRY) await ensureModel();

  const failed = [];
  for (const [i, shot] of queue.entries()) {
    log(`(${i + 1}/${queue.length}) ${shot.id} — ${shot.title}`);
    try {
      const firstFrame = prepareFirstFrame(shot);
      const body = { model: REPO, prompt: shot.prompt, width: WIDTH, height: HEIGHT, num_frames: NUM_FRAMES, fps: FPS, steps: STEPS, seed: shot.seed };
      if (firstFrame) body.first_frame = firstFrame;
      if (DRY) {
        const summary = { ...body, prompt: `${body.prompt.length} chars`, first_frame: firstFrame ? `<jpeg ${WIDTH}×${HEIGHT} ${Math.round(firstFrame.length / 1024)} KB>` : 'none (text only)' };
        log('  dry run:', JSON.stringify(summary));
        continue;
      }
      await submit(body);
      const video = await waitForResult(shot.seed);
      const raw = path.join(OUT_RAW, `${shot.id}.mp4`);
      await download(String(video.url || ''), raw);
      encodeWeb(shot, raw);
      log(`  done → public/showcase/h3/${shot.id}.mp4`);
      rebuildReel();
    } catch (err) {
      log(`  ✗ ${shot.id}: ${err.message}`);
      failed.push(shot.id);
      if (/\(401\)|not loaded/i.test(err.message)) break;
    }
  }
  if (failed.length) { log(`failed: ${failed.join(', ')}`); process.exitCode = 1; }
})().catch(err => {
  // fetch network errors carry the reason in err.cause; never echo the URL or the key
  const cause = err.cause && (err.cause.code || err.cause.message);
  const unreachable = /fetch failed/i.test(err.message) ? ` / ติดต่อเซิร์ฟเวอร์ ${baseHost()} ไม่ได้ (cannot reach the server)` : '';
  console.error(`${err.message}${cause ? ` (${cause})` : ''}${unreachable}`);
  process.exit(1);
});
