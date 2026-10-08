// Write the landing "Naka video factory" block (Buzzy-style video wall on a light AI-factory
// background) into public/index.html between <!-- reel:start --> and <!-- reel:end -->.
// Shots from shots.json appear once generate.cjs has rendered public/showcase/h3/<id>.mp4;
// until there are six, existing Naka clips fill the wall.
//   node creative/unsloth-reel/build-reel.cjs
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const INDEX = path.join(ROOT, 'public', 'index.html');
const H3_DIR = path.join(ROOT, 'public', 'showcase', 'h3');
const START = '<!-- reel:start -->';
const END = '<!-- reel:end -->';

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const pad = n => String(n).padStart(2, '0');
const SPEAKER = '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="spk" d="M4 9h4l5-4v14l-5-4H4z"/><path class="on" d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12"/><path class="off" d="M16.5 9.5l5 5m0-5l-5 5"/></svg>';

const { shots, fallback } = JSON.parse(fs.readFileSync(path.join(__dirname, 'shots.json'), 'utf8'));
const isRendered = s => fs.existsSync(path.join(H3_DIR, `${s.id}.mp4`));
// shots with a "row" belong to a product rail further down the page, not to this wall
const rendered = shots.filter(s => !s.row && isRendered(s));
const fill = rendered.length < 6 ? fallback : [];

// One clip on the wall. The ticket (#NN + chip) sits top-left on the video, the caption is a
// white frosted panel at the bottom. .reel-sound must stay a direct child of the card so
// landing.js can find the card's video through button.parentNode.
function card({ no, href, poster, sources, chip, chipClass, title, sub, tryLabel, from, sound }) {
  const video = `<video data-autoplay muted loop playsinline preload="none" poster="${esc(poster)}" aria-hidden="true">${sources.map(([src, type]) => `<source src="${esc(src)}" type="${type}">`).join('')}</video>`;
  return `          <div class="tpl reel-card">
            <a class="reel-link" href="${esc(href)}"><div class="tpl-media">${video}</div><span class="tpl-chip reel-ticket${chipClass ? ' ' + chipClass : ''}"><i>#${pad(no)}</i>${esc(chip)}</span><div class="tpl-body"><h3>${esc(title)}</h3><p>${esc(sub)}</p><span class="tpl-try">${esc(tryLabel)}</span></div></a>
${from ? `            <figure class="reel-from"><img src="${esc(from)}" width="180" height="320" loading="lazy" alt="รูปตั้งต้นของคลิป ${esc(title)}"><figcaption>จากรูปนี้</figcaption></figure>\n` : ''}${sound ? `            <button class="reel-sound" type="button" aria-pressed="false" aria-label="เปิดเสียงคลิป ${esc(title)}">${SPEAKER}</button>\n` : ''}          </div>`;
}

const items = [
  ...rendered.map(s => ({
    href: s.href, poster: `/showcase/h3/${s.id}.jpg`, sources: [[`/showcase/h3/${s.id}.mp4`, 'video/mp4']],
    chip: s.chip, chipClass: s.chip_class, title: s.title, sub: s.sub, tryLabel: s.try,
    from: s.first_frame && fs.existsSync(path.join(H3_DIR, `${s.id}-from.jpg`)) ? `/showcase/h3/${s.id}-from.jpg` : null,
    sound: true,
  })),
  ...fill.map(f => ({ href: f.href, poster: f.poster, sources: f.sources, chip: f.chip, title: f.title, sub: f.sub, tryLabel: f.try })),
];
const cards = items.map((it, i) => card({ no: i + 1, ...it }));

// The featured tile takes 2x2 cells on desktop (5 cols) and a full row on tablet (3 cols) and
// mobile (2 cols). An "open slot" card fills whatever cells are left in the last row so the wall
// never ends with a hole; data-d/-t/-m is how many columns it spans there (0 = hidden).
const n = items.length;
const holes = (cols, cells) => (cols - (cells % cols)) % cols;
const slotSpan = { d: holes(5, 4 + n), t: holes(3, 3 + n), m: holes(2, 2 + n) };
const slot = (slotSpan.d || slotSpan.t || slotSpan.m) ? `          <a class="reel-slot" href="/login/?mode=register" data-d="${slotSpan.d}" data-t="${slotSpan.t}" data-m="${slotSpan.m}"><span class="reel-ticket"><i>#${pad(n + 1)}</i>รอคิว</span><span class="slot-plus" aria-hidden="true">+</span><b>คลิปถัดไปของร้านคุณ</b><span class="slot-cta">ส่งรูปเข้าสายพาน ↗</span></a>` : '';

const hasH3 = rendered.length > 0;
const lead = hasH3
  ? (fill.length
    ? 'คลิปที่มีปุ่มลำโพงเริ่มจากรูปนิ่งรูปเดียว ภาพเคลื่อนไหวและเสียงพูดไทยถูกสร้างมาพร้อมกัน แตะไอคอนลำโพงเพื่อฟังเสียง'
    : 'ทุกคลิปบนผนังนี้เริ่มจากรูปนิ่งรูปเดียว ภาพเคลื่อนไหวและเสียงพูดไทยถูกสร้างมาพร้อมกัน แตะไอคอนลำโพงเพื่อฟังเสียง')
  : 'คลิปรีวิวและละครสั้นที่ออกจากสายพานของนาคา ตั้งแต่รูปสินค้าจนเป็นวิดีโอแนวตั้งพร้อมโพสต์';
// Only claim the H3 engine once at least one H3 clip is actually on the wall.
const status = hasH3
  ? ['MiniMax H3 · Unsloth', '9:16 · 24fps', 'เสียงพากย์ไทย']
  : ['วิดีโอแนวตั้ง 9:16', 'รีวิว · ละครสั้น', 'พร้อมโพสต์'];
const note = [
  hasH3 && 'คลิปที่มี “จากรูปนี้” สร้างด้วยโมเดลวิดีโอ MiniMax H3 ที่รันผ่าน Unsloth · ภาพและเสียงสร้างด้วย AI · สินค้าและร้านเป็นตัวอย่างสมมติ',
  fill.length && 'คลิปละครสร้างจากระบบละครของนาคา',
].filter(Boolean).join(' · ');

const block = `${START}
    <!-- generated by creative/unsloth-reel/build-reel.cjs; edit shots.json, not this block -->
    <section class="reel" id="reel" aria-labelledby="reel-title">
      <div class="reel-shell reel-head">
        <div>
          <p class="reel-kicker"><span class="reel-led" aria-hidden="true"></span>MAIN LINE · NAKA VIDEO ENGINE</p>
          <h2 id="reel-title">โรงงานวิดีโอของ<em>นาคา</em></h2>
          <p class="row-sub">${lead}</p>
        </div>
        <ul class="reel-status" aria-label="สถานะสายการผลิต">${status.map(s => `<li>${esc(s)}</li>`).join('')}</ul>
      </div>
      <div class="reel-shell reel-wall" role="group" aria-label="ตัวอย่างวิดีโอที่นาคาสร้าง">
        <div class="reel-feature">
          <p class="rf-kicker">STATION 00 · เอนจินวิดีโอของนาคา</p>
          <h3>รูปเดียว<br>เป็นคลิปพร้อม<br><em>เสียงพากย์ไทย</em></h3>
          <ol class="rf-steps"><li><b>1</b><span>ใส่รูปสินค้า<small>INPUT · รูป 1 รูป</small></span></li><li><b>2</b><span>นาคาเขียนบท<small>SCRIPT · ภาษาไทย</small></span></li><li><b>3</b><span>ได้คลิป 9:16 พร้อมเสียง<small>OUTPUT · พร้อมโพสต์</small></span></li></ol>
          <a class="btn btn-primary" href="/login/?mode=register">เริ่มเสกคลิปแรก <span aria-hidden="true">↗</span></a>
          <img class="rf-naka" src="/assets/naka-plush-320.png" width="320" height="320" loading="lazy" alt=""><span class="rf-belt" aria-hidden="true"></span>
        </div>
${cards.join('\n')}
${slot}
      </div>
      <p class="reel-shell reel-note">${esc(note)}</p>
    </section>
    ${END}`.replace(/\n\n/g, '\n');

function splice(html, start, end, content) {
  const a = html.indexOf(start);
  const b = html.indexOf(end);
  if (a < 0 || b < a) throw new Error(`markers ${start} … ${end} not found in public/index.html`);
  return html.slice(0, a) + content + html.slice(b + end.length);
}

// Product rails (#p-review, #p-drama, #p-live, #p-bot): rendered row shots lead each rail, in the
// regular dark-caption .tpl style of those rows, with the same sound toggle and "จากรูปนี้" thumb.
function rowCard(s) {
  const from = s.first_frame && fs.existsSync(path.join(H3_DIR, `${s.id}-from.jpg`)) ? `/showcase/h3/${s.id}-from.jpg` : null;
  return `          <div class="tpl h3-card">
            <a class="reel-link" href="${esc(s.href)}"><div class="tpl-media"><video data-autoplay muted loop playsinline preload="none" poster="/showcase/h3/${esc(s.id)}.jpg" aria-hidden="true"><source src="/showcase/h3/${esc(s.id)}.mp4" type="video/mp4"></video></div><span class="tpl-chip${s.chip_class ? ' ' + s.chip_class : ''}">${esc(s.chip)}</span><div class="tpl-body"><h3>${esc(s.title)}</h3><p>${esc(s.sub)}</p><span class="tpl-try">${esc(s.try)}</span></div></a>
${from ? `            <figure class="reel-from"><img src="${esc(from)}" width="180" height="320" loading="lazy" alt="รูปตั้งต้นของคลิป ${esc(s.title)}"><figcaption>จากรูปนี้</figcaption></figure>\n` : ''}            <button class="reel-sound" type="button" aria-pressed="false" aria-label="เปิดเสียงคลิป ${esc(s.title)}">${SPEAKER}</button>
          </div>`;
}

let html = splice(fs.readFileSync(INDEX, 'utf8'), START, END, block);
const rowCounts = {};
for (const row of ['review', 'drama', 'live', 'bot']) {
  const list = shots.filter(s => s.row === row && isRendered(s));
  rowCounts[row] = list.length;
  const s = `<!-- h3:${row}:start -->`;
  const e = `<!-- h3:${row}:end -->`;
  html = splice(html, s, e, `${s}\n${list.map(rowCard).join('\n')}${list.length ? '\n' : ''}          ${e}`);
}
const anyRow = Object.values(rowCounts).some(Boolean);
html = splice(html, '<!-- h3:note:start -->', '<!-- h3:note:end -->', `<!-- h3:note:start -->\n${anyRow
  ? '      <p class="shell h3-note">คลิปที่มีปุ่มลำโพงสร้างด้วยโมเดลวิดีโอ MiniMax H3 ที่รันผ่าน Unsloth · ภาพและเสียงสร้างด้วย AI · สินค้า ร้าน และตัวละครเป็นตัวอย่างสมมติ</p>\n'
  : ''}      <!-- h3:note:end -->`);
fs.writeFileSync(INDEX, html);
console.log(`reel: ${rendered.length} H3 clip(s), ${fill.length} filler clip(s) · rows: ${Object.entries(rowCounts).map(([k, v]) => `${k} ${v}`).join(', ')}`);
