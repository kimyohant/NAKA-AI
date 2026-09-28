const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const root = path.resolve(__dirname, '..');
const buildName = process.argv[2] === 'flow' ? 'flow' : 'world';
const worldDir = path.join(root, 'public', buildName);
const htmlPath = path.join(worldDir, 'index.html');
const jsPath = path.join(worldDir, 'index.js');
const wasmPath = path.join(worldDir, 'index.wasm');
const gzipPath = `${wasmPath}.gz`;
const archivePath = path.join(root, '.tools', 'godot-build', `${buildName}.wasm`);

function patchHtml() {
  let html = fs.readFileSync(htmlPath, 'utf8').replace(/\r\n/g, '\n');
  html = html.replace('<html>', '<html lang="th">');
  html = html.replace(/background-color:\s*#[0-9a-f]{6};/gi, `background-color: ${buildName === 'flow' ? '#0a1d43' : 'transparent'};`);
  html = html.replace('#canvas {\n\tdisplay: block;\n}', '#canvas {\n\tdisplay: block;\n\twidth: 100%;\n\theight: 100%;\n}');
  if (buildName === 'flow' && !html.includes('naka-flow-error')) {
    html = html.replace('function displayFailureNotice(err) {', `function displayFailureNotice(err) {
		window.parent.postMessage({ type: 'naka-flow-error' }, window.location.origin);`);
  }
  fs.writeFileSync(htmlPath, html);
}

function patchLoader() {
  let source = fs.readFileSync(jsPath, 'utf8');
  const contextAlpha = 'alpha:!!HEAP8[attributes+0]';
  if (source.includes(contextAlpha)) source = source.replace(contextAlpha, 'alpha:true');
  if (source.includes('new DecompressionStream(\'gzip\')')) {
    fs.writeFileSync(jsPath, source);
    return;
  }

  const start = source.indexOf('\tfunction loadFetch(file, tracker, fileSize, raw) {');
  const end = source.indexOf('\n\tfunction retry(', start);
  if (start < 0 || end < 0) throw new Error('Godot loadFetch function was not found');

  const replacement = `\tfunction loadFetch(file, tracker, fileSize, raw) {
\t\ttracker[file] = {
\t\t\ttotal: fileSize || 0,
\t\t\tloaded: 0,
\t\t\tdone: false,
\t\t};
\t\tconst compressedWasm = raw && file.endsWith('.wasm') && typeof DecompressionStream !== 'undefined';
\t\tconst source = compressedWasm ? \`\${file}.gz\` : file;
\t\treturn fetch(source).then(function (response) {
\t\t\tif (!response.ok) {
\t\t\t\treturn Promise.reject(new Error(\`Failed loading file '\${source}'\`));
\t\t\t}
\t\t\tconst decoded = compressedWasm ? new Response(
\t\t\t\tresponse.body.pipeThrough(new DecompressionStream('gzip')),
\t\t\t\t{ headers: { 'Content-Type': 'application/wasm' } },
\t\t\t) : response;
\t\t\tconst tr = getTrackedResponse(decoded, tracker[file]);
\t\t\tif (raw) {
\t\t\t\treturn Promise.resolve(tr);
\t\t\t}
\t\t\treturn tr.arrayBuffer();
\t\t});
\t}
`;

  source = `${source.slice(0, start)}${replacement}${source.slice(end)}`;
  fs.writeFileSync(jsPath, source);
}

function compressWasm() {
  if (!fs.existsSync(wasmPath)) {
    if (!fs.existsSync(gzipPath)) throw new Error('Godot index.wasm was not found');
    return;
  }

  const wasm = fs.readFileSync(wasmPath);
  fs.writeFileSync(gzipPath, zlib.gzipSync(wasm, { level: 9 }));
  fs.mkdirSync(path.dirname(archivePath), { recursive: true });
  fs.renameSync(wasmPath, archivePath);
}

patchHtml();
patchLoader();
compressWasm();
console.log(`Godot web build is ready in public/${buildName}`);
