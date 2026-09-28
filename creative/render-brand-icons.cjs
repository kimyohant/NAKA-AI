const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');

const source = path.resolve(__dirname, '../public/logo.svg');
const sizes = [32, 180, 384];
const destinations = {
  32: path.resolve(__dirname, '../public/favicon-32.png'),
  180: path.resolve(__dirname, '../public/apple-touch-icon.png'),
  384: path.resolve(__dirname, '../.wrangler/qa/logo-review.png'),
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let browser;
let ws;

(async () => {
  browser = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', [
    '--headless=new', '--no-first-run', '--disable-extensions', '--remote-debugging-port=9247',
    `--user-data-dir=${path.resolve('.wrangler/qa/icons-' + Date.now())}`, 'about:blank'
  ], { windowsHide: true, stdio: 'ignore' });
  let page;
  for (let i = 0; i < 60; i++) {
    try { page = (await (await fetch('http://127.0.0.1:9247/json')).json()).find(tab => tab.type === 'page'); if (page) break; } catch {}
    await sleep(500);
  }
  assert.ok(page, 'Edge launched');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = event => {
    const message = JSON.parse(event.data);
    if (pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const key = ++id;
    const timer = setTimeout(() => reject(Error('timeout ' + method)), 30000);
    pending.set(key, message => { clearTimeout(timer); message.error ? reject(Error(JSON.stringify(message.error))) : resolve(message.result); });
    ws.send(JSON.stringify({ id: key, method, params }));
  });
  await send('Page.enable');
  await send('Page.navigate', { url: 'file:///' + source.replaceAll('\\', '/') });
  await sleep(400);
  for (const size of sizes) {
    await send('Emulation.setDeviceMetricsOverride', { width: size, height: size, deviceScaleFactor: 1, mobile: false });
    await sleep(250);
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.mkdirSync(path.dirname(destinations[size]), { recursive: true });
    fs.writeFileSync(destinations[size], Buffer.from(shot.data, 'base64'));
    console.log(`${size}px → ${destinations[size]}`);
  }
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { ws?.close(); browser?.kill(); });
