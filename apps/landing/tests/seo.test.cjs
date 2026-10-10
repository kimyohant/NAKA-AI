// Search engines: the home page in Thai (/) and English (/en/), robots.txt and sitemap.xml.
// The Thai title and H1 carry what Thai sellers search ("แอพ/AI ทำคลิปขายของ", "คลิปป้ายยา", "ไลฟ์สด", "พากย์ไทย");
// the slogan is "แค่มีรูปสินค้า ก็ได้คลิปขาย".
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { existsSync, readFileSync } = require('node:fs');
const path = require('node:path');

const pub = path.resolve(__dirname, '..', 'public');
const read = (rel) => readFileSync(path.join(pub, rel), 'utf8');
const th = read('index.html');
const en = read('en/index.html');

const attr = (html, re) => (html.match(re) || [])[1];
const title = (html) => attr(html, /<title>([^<]*)<\/title>/);
const description = (html) => attr(html, /<meta name="description" content="([^"]*)"/);
const jsonLd = (html) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
const nodes = (html) => jsonLd(html).flatMap((d) => d['@graph'] || [d]);

test('Thai home: title, description and H1 say what people search, with the slogan above the H1', () => {
  assert.equal(title(th), 'แอพ AI ทำคลิปขายของ คลิปป้ายยา ไลฟ์สด พากย์ไทย | naka-ai');
  assert.ok(title(th).length <= 60);
  const desc = description(th);
  assert.ok(desc.length >= 120 && desc.length <= 160, `description is ${desc.length} characters`);
  for (const words of [/ทำคลิปขายของ/, /คลิปป้ายยา/, /ไลฟ์สด/, /พากย์เสียงไทย/, /ไม่ต้องถ่ายเอง/]) assert.match(desc, words);
  assert.equal((th.match(/<h1[\s>]/g) || []).length, 1, 'one H1');
  assert.match(th, /<h1 id="hero-title">AI ทำ<span class="grad">คลิปขายของ<\/span><br>คลิปป้ายยา ละครสั้น ไลฟ์สด/);
  assert.match(th, /<p class="eyebrow">[\s\S]*?แค่มีรูปสินค้า ก็ได้คลิปขาย<\/p>\s*<h1/);
  assert.match(th, /<meta property="og:title" content="แค่มีรูปสินค้า ก็ได้คลิปขาย/);
  assert.doesNotMatch(th, /ใส่สินค้า ได้คลิปขาย|เสกคลิป/, 'the old slogan and "เสก" are gone');
});

test('both languages point at each other (canonical + hreflang th/en/x-default) and link to each other', () => {
  for (const [html, self] of [[th, 'https://naka-ai.com/'], [en, 'https://naka-ai.com/en/']]) {
    assert.match(html, new RegExp(`<link rel="canonical" href="${self}">`));
    assert.match(html, /<link rel="alternate" hreflang="th" href="https:\/\/naka-ai\.com\/">/);
    assert.match(html, /<link rel="alternate" hreflang="en" href="https:\/\/naka-ai\.com\/en\/">/);
    assert.match(html, /<link rel="alternate" hreflang="x-default" href="https:\/\/naka-ai\.com\/en\/">/);
  }
  assert.match(th, /<a class="nav-plain nav-lang" href="\/en\/" hreflang="en" lang="en">EN<\/a>/);
  assert.match(en, /<a class="nav-plain nav-lang" href="\/" hreflang="th" lang="th">ไทย<\/a>/);
  assert.match(en, /<html lang="en">/);
});

test('structured data parses, names the organisation and its slogan, and claims no prices (paid plans are not on sale)', () => {
  for (const [html, slogan] of [[th, 'แค่มีรูปสินค้า ก็ได้คลิปขาย'], [en, 'Got a product photo? Get a sales clip.']]) {
    const all = nodes(html);
    const org = all.find((n) => n['@type'] === 'Organization');
    assert.equal(org.slogan, slogan);
    assert.equal(org.contactPoint.telephone, '+66-89-278-8587');
    assert.ok(all.some((n) => n['@type'] === 'SoftwareApplication' && n.name === 'Naka Studio'));
    assert.doesNotMatch(JSON.stringify(all), /"offers"|"price"|aggregateRating/);
  }
  assert.ok(nodes(th).some((n) => n['@type'] === 'WebSite'));
});

test('English home: its own title, description and one H1; every local file it uses exists; no Thai-only script', () => {
  assert.match(title(en), /AI Sales Videos/);
  assert.ok(title(en).length <= 65);
  const desc = description(en);
  assert.ok(desc.length >= 120 && desc.length <= 170, `description is ${desc.length} characters`);
  assert.equal((en.match(/<h1[\s>]/g) || []).length, 1);
  for (const [, ref] of en.matchAll(/(?:href|src|poster)="(\/[^"#?]*)/g)) {
    if (ref.startsWith('/go/') || ref.startsWith('/app/')) continue; // routes, not files
    const target = ref.endsWith('/') ? path.join(pub, ref, 'index.html') : path.join(pub, ref);
    assert.ok(existsSync(target), `/en/ uses ${ref}, which is missing`);
  }
  for (const [, id] of en.matchAll(/href="#([\w-]+)"/g)) assert.match(en, new RegExp(`id="${id}"`), `#${id} has no target`);
  assert.doesNotMatch(en, /hero-line\.js|gallery\.js|account-menu\.js/);
  assert.match(en, /data-ready/, 'all 12 clips show without gallery.js');
});

test('the home page no longer preloads the removed soap image; preloads point at real files', () => {
  assert.doesNotMatch(th, /soap-640/);
  for (const html of [th, en]) {
    for (const [, href] of html.matchAll(/<link rel="preload" as="image" href="([^"]+)">/g)) assert.ok(existsSync(path.join(pub, href)), href);
  }
});

test('robots.txt allows the site, keeps member/admin/redirect paths out and names the sitemap', () => {
  const robots = read('robots.txt');
  assert.match(robots, /^User-agent: \*$/m);
  assert.match(robots, /^Allow: \/$/m);
  for (const p of ['/app/', '/admin/', '/api/', '/login/', '/go/']) assert.match(robots, new RegExp(`^Disallow: ${p.replace(/\//g, '\\/')}$`, 'm'));
  assert.match(robots, /^Sitemap: https:\/\/naka-ai\.com\/sitemap\.xml$/m);
});

test('sitemap.xml lists only public pages that exist, the home page in both languages', () => {
  const xml = read('sitemap.xml');
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.ok(locs.includes('https://naka-ai.com/') && locs.includes('https://naka-ai.com/en/'));
  for (const loc of locs) {
    const rel = new URL(loc).pathname;
    assert.ok(!/^\/(app|admin|login|go)\//.test(rel), `${loc} should not be in the sitemap`);
    assert.ok(existsSync(path.join(pub, rel, 'index.html')), `${loc} has no page`);
  }
  assert.equal((xml.match(/<url>/g) || []).length, (xml.match(/<\/url>/g) || []).length);
});

test('llms.txt tells AI assistants what naka-ai is, in the site\'s own words, with links that exist and no prices', () => {
  const llms = read('llms.txt');
  assert.match(llms, /^# naka-ai\n\n> แค่มีรูปสินค้า ก็ได้คลิปขาย/);
  for (const words of [/ทำคลิปขายของ/, /คลิปป้ายยา/, /ละครสั้น/, /ไลฟ์สด/, /พากย์เสียงไทย/, /TikTok Shop/, /Shopee/]) assert.match(llms, words);
  for (const [, url] of llms.matchAll(/\]\((https:\/\/naka-ai\.com[^)]*)\)/g)) {
    const p = new URL(url).pathname;
    if (p.startsWith('/go/')) continue; // a redirect into the studio, not a file
    assert.ok(existsSync(path.join(pub, p, 'index.html')), `${url} is a page of the site`);
  }
  assert.doesNotMatch(llms, /บาท|฿|ราคา|\bTHB\b/, 'no prices: the plans are not on sale');
});

test('the 3D demo pages stay out of search results and out of the sitemap', () => {
  const sitemap = read('sitemap.xml');
  for (const page of ['flow', 'world']) {
    assert.match(read(`${page}/index.html`), /<meta name="robots" content="noindex">/, page);
    assert.doesNotMatch(sitemap, new RegExp(`/${page}/`), page);
  }
});
