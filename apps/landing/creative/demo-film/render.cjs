// Renders film.html frame by frame through Chrome DevTools Protocol and pipes PNGs to ffmpeg.
//   node creative/demo-film/render.cjs                      master + web encodes + poster
//   node creative/demo-film/render.cjs --stills 0,9.5,19    PNG stills only (into --out)
// Env: CHROME (default: Program Files Chrome), FFMPEG (default: ffmpeg on PATH).
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i < 0 ? def : args[i + 1]; };
const FPS = +opt('fps', 30);
const OUT = path.resolve(opt('out', path.join(__dirname, 'out')));
const STILLS = opt('stills', '');
const FROM = +opt('from', 0);
const TO = opt('to', '');
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const PUBLIC = path.resolve(__dirname, '../../public/assets');
const PORT = 9300 + Math.floor(Math.random() * 500);

fs.mkdirSync(OUT, { recursive: true });

function run(cmd, argv, input) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, argv, { stdio: [input ? 'pipe' : 'ignore', 'inherit', 'inherit'] });
    p.on('error', reject);
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(cmd + ' exited ' + code))));
    if (input) input(p.stdin);
  });
}

async function cdp() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'naka-film-'));
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile,
    '--window-size=1080,1920', '--hide-scrollbars', '--force-device-scale-factor=1', '--allow-file-access-from-files',
    '--disable-gpu', '--font-render-hinting=none', 'about:blank'], { stdio: 'ignore' });
  let target;
  for (let i = 0; i < 100 && !target; i++) {
    await new Promise((r) => setTimeout(r, 150));
    try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((x) => x.type === 'page'); } catch (e) { /* not up yet */ }
  }
  if (!target) throw new Error('Chrome did not start');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pending = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { const [r, j] = pending.get(d.id); pending.delete(d.id); d.error ? j(new Error(d.error.message)) : r(d.result); } };
  const send = (method, params = {}) => new Promise((r, j) => { pending.set(++id, [r, j]); ws.send(JSON.stringify({ id, method, params })); });
  const close = () => { try { ws.close(); } catch (e) {} chrome.kill(); setTimeout(() => fs.rmSync(profile, { recursive: true, force: true }), 800); };
  return { send, close };
}

(async () => {
  const { send, close } = await cdp();
  try {
    await send('Emulation.setDeviceMetricsOverride', { width: 1080, height: 1920, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: pathToFileURL(path.join(__dirname, 'film.html')).href });
    let ready = false;
    for (let i = 0; i < 200 && !ready; i++) {
      await new Promise((r) => setTimeout(r, 100));
      ready = (await send('Runtime.evaluate', { expression: '!!window.__ready', returnByValue: true })).result.value;
    }
    if (!ready) throw new Error('film.html never became ready (fonts/images)');
    const dur = (await send('Runtime.evaluate', { expression: 'DUR', returnByValue: true })).result.value;
    const shot = async (t) => {
      await send('Runtime.evaluate', { expression: `seek(${t})` });
      const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      return Buffer.from(data, 'base64');
    };

    if (STILLS) {
      for (const t of STILLS.split(',').map(Number)) {
        const f = path.join(OUT, `still-${t.toFixed(2)}.png`);
        fs.writeFileSync(f, await shot(t));
        console.log(f);
      }
      return;
    }

    const end = TO ? +TO : dur;
    const n0 = Math.round(FROM * FPS), n1 = Math.round(end * FPS);
    const master = path.join(OUT, 'naka-demo-master.mp4');
    console.log(`rendering ${n1 - n0} frames @${FPS}fps -> ${master}`);
    await run(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '14', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', master], async (stdin) => {
      for (let n = n0; n < n1; n++) {
        const png = await shot(n / FPS);
        if (!stdin.write(png)) await new Promise((r) => stdin.once('drain', r));
        if (n % 60 === 0) process.stdout.write(`  ${(n / FPS).toFixed(1)}s\n`);
      }
      stdin.end();
    });
    if (FROM !== 0 || TO) return;

    // web encodes for the landing cards (232-260 css px wide, so 540x960 covers 2x DPR)
    const scale = 'scale=540:960:flags=lanczos';
    await run(FFMPEG, ['-y', '-loglevel', 'error', '-i', master, '-vf', scale, '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '36',
      '-row-mt', '1', '-deadline', 'good', '-cpu-used', '2', '-an', path.join(PUBLIC, 'naka-demo-30s.webm')]);
    await run(FFMPEG, ['-y', '-loglevel', 'error', '-i', master, '-vf', scale, '-c:v', 'libx264', '-preset', 'slow', '-crf', '27',
      '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', path.join(PUBLIC, 'naka-demo-30s.mp4')]);
    await run(FFMPEG, ['-y', '-loglevel', 'error', '-i', master, '-vf', scale, '-frames:v', '1', '-q:v', '4', path.join(PUBLIC, 'naka-demo-poster.jpg')]);
    console.log('wrote public/assets/naka-demo-30s.{webm,mp4} and naka-demo-poster.jpg');
  } finally { close(); }
})().catch((e) => { console.error(e); process.exit(1); });
