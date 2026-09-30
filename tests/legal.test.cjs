// Phase 6B legal pages (docs/phase6-legal.md): static HTML that Meta, Google and
// Omise reviewers must be able to open, linked from the pages customers see.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { existsSync, readFileSync } = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const pub = path.join(root, 'public');
const PAGES = ['privacy', 'terms', 'refund', 'data-deletion'];
const read = (...parts) => readFileSync(path.join(...parts), 'utf8');
const page = (name) => read(pub, 'legal', name, 'index.html');

test('ทั้ง 4 หน้ามีอยู่ ภาษาไทย มี title/h1 และเปิดให้ search engine เห็นได้', () => {
  for (const name of PAGES) {
    const html = page(name);
    assert.match(html, /<html[^>]*lang="th"/, `${name}: lang="th"`);
    assert.match(html, /<title>[^<]+<\/title>/, `${name}: title`);
    assert.match(html, /<h1[^>]*>[^<]+/, `${name}: h1`);
    assert.doesNotMatch(html, /noindex/i, `${name}: must be indexable`);
    assert.match(html, /ปรับปรุงล่าสุด/, `${name}: last updated`);
  }
});

test('ลิงก์ภายในของหน้ากฎหมายชี้ไปไฟล์ที่มีจริง', () => {
  for (const name of PAGES) {
    for (const [, href] of page(name).matchAll(/(?:href|src)="(\/[^"#?]*)/g)) {
      const target = href.endsWith('/') ? path.join(pub, href, 'index.html') : path.join(pub, href);
      assert.ok(existsSync(target), `${name}: ${href} not found`);
    }
  }
});

test('หน้าแรก, /login/ และ /app/billing/ ลิงก์ไปนโยบายความเป็นส่วนตัวและข้อกำหนด', () => {
  for (const file of ['index.html', 'login/index.html', 'app/billing/index.html']) {
    const html = read(pub, file);
    assert.match(html, /href="\/legal\/privacy\/"/, `${file}: privacy link`);
    assert.match(html, /href="\/legal\/terms\/"/, `${file}: terms link`);
  }
});

test('ไม่มีช่องที่ยังไม่ได้กรอก (fill-me) เหลือบนหน้าที่จะเผยแพร่', () => {
  for (const name of PAGES) {
    const left = [...page(name).matchAll(/class="fill-me">([^<]*)</g)].map((m) => m[1]);
    assert.deepEqual(left, [], `${name}: fill in ${left.join(', ')}`);
  }
});
