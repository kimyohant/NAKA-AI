// Write the landing clip library (dark band under the hero: one grid, filter tabs per product)
// into public/index.html between <!-- reel:start --> and <!-- reel:end -->.
// Cards come from three sources: every shot in shots.json that generate.cjs has rendered to
// public/showcase/h3/<id>.mp4 ("row", or the href, decides its tab), the 50 sample clips in
// clips.json (public/showcase/clips/), and the chat demos in chat-cards.html. Until six H3 clips
// are rendered, the shots.json fallback clips fill in. public/gallery.js runs the tabs.
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
const SPEAKER = '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="spk" d="M4 9h4l5-4v14l-5-4H4z"/><path class="on" d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12"/><path class="off" d="M16.5 9.5l5 5m0-5l-5 5"/></svg>';

// The tabs, in order, with the line and the start link shown above the grid when a tab is open.
const TABS = [
  { id: 'all', label: 'ทั้งหมด', text: 'สี่งานขายในที่เดียว: คลิปรีวิว ละครสั้น ไลฟ์ และตอบแชท เริ่มจากรูปและข้อมูลสินค้าที่ร้านมีอยู่แล้ว', cta: 'สมัครสมาชิก เริ่มเสกกับนาคา', href: '/login/?mode=register' },
  { id: 'review', label: 'รีวิว Affiliate', tag: 'ลองฟรี', text: 'รูปสินค้า 1 ถึง 6 รูป ได้บท เสียงพากย์ไทย และคลิปแนวตั้งพร้อมแคปชันที่แนบลิงก์ของคุณ', cta: 'เริ่มสร้างคลิปรีวิว', href: '/review/?demo=1' },
  { id: 'drama', label: 'ละครสั้น AI', text: 'จากพล็อตและตัวละคร เป็นฉากแนวตั้งพร้อมเสียงพากย์ ตัดเป็นตอนสั้นชวนติดตาม', cta: 'เริ่มทำละคร', href: '/create/?workflow=drama' },
  { id: 'live', label: 'AI Live', text: 'อวตาร AI แนะนำสินค้าและตอบคำถามคนดูระหว่างไลฟ์ ตามข้อมูลสินค้าที่คุณให้', cta: 'เริ่มตั้งค่าไลฟ์', href: '/create/?workflow=live' },
  { id: 'bot', label: 'แชทบอท', text: 'ตอบแชทและคอมเมนต์ด้วยข้อมูลของร้าน เรื่องที่ต้องตัดสินใจส่งต่อให้คนในร้าน', cta: 'เริ่มตั้งค่าบอท', href: '/create/?workflow=bot' },
];
const CATS = TABS.slice(1).map(t => t.id);

const { shots, fallback } = JSON.parse(fs.readFileSync(path.join(__dirname, 'shots.json'), 'utf8'));
const isRendered = s => fs.existsSync(path.join(H3_DIR, `${s.id}.mp4`));
// "app" shots are the in-app mascot animations, not landing samples
const rendered = shots.filter(s => s.row !== 'app' && isRendered(s));
const fill = rendered.length < 6 ? fallback : [];

// the 50 sample clips: drama and live keep their tab, shop scenes (packing, orders, handoff) show
// what the bot works alongside, every other product group is a review clip
const lib = JSON.parse(fs.readFileSync(path.join(__dirname, 'clips.json'), 'utf8'));
const CLIPS_DIR = path.join(ROOT, 'public', 'showcase', 'clips');
const libCat = g => (g === 'drama' || g === 'live') ? g : g === 'shop' ? 'bot' : 'review';
const TRY = {
  review: ['ลองแบบนี้ ↗', '/review/?demo=1'],
  drama: ['ทำละครแบบนี้ ↗', '/create/?workflow=drama'],
  live: ['ตั้งค่าไลฟ์ ↗', '/create/?workflow=live'],
  bot: ['ตั้งค่าบอท ↗', '/create/?workflow=bot'],
};
// review clips alternate product groups so a tab never opens on eight of one kind
function interleave(list, key) {
  const groups = [...new Set(list.map(key))].map(k => list.filter(x => key(x) === k));
  const out = [];
  for (let i = 0; out.length < list.length; i++) for (const g of groups) if (g[i]) out.push(g[i]);
  return out;
}
const libClips = interleave(lib.clips.filter(c => fs.existsSync(path.join(CLIPS_DIR, `${c.id}.mp4`))), c => c.group);

// tab of a shot: its row, else read from where its button leads; anything else shows under "all" only
function catOf(s) {
  if (CATS.includes(s.row)) return s.row;
  const href = String(s.href || '');
  if (href.startsWith('/review')) return 'review';
  const m = /workflow=(drama|live|bot)/.exec(href);
  return m ? m[1] : 'naka';
}

function card({ cat, href, poster, sources, chip, live, title, sub, tryLabel, from, sound }) {
  return `        <article class="g-card" data-cat="${cat}">
          <video data-autoplay muted loop playsinline preload="none" poster="${esc(poster)}" aria-hidden="true">${sources.map(([src, type]) => `<source src="${esc(src)}" type="${type}">`).join('')}</video>
          <span class="g-chip${live ? ' is-live' : ''}">${esc(chip.replace(/^●\s*/, ''))}</span>
${from ? `          <figure class="g-from"><img src="${esc(from)}" width="180" height="320" loading="lazy" alt="รูปตั้งต้นของคลิป ${esc(title)}"><figcaption>จากรูปนี้</figcaption></figure>\n` : ''}${sound ? `          <button class="reel-sound" type="button" aria-pressed="false" aria-label="เปิดเสียงคลิป ${esc(title)}">${SPEAKER}</button>\n` : ''}          <div class="g-cap"><h3>${esc(title)}</h3>${sub ? `<p>${esc(sub)}</p>` : ''}<a class="g-use" href="${esc(href)}">${esc(tryLabel)}</a></div>
        </article>`;
}

// product clips lead each tab; the clips starring Naka herself follow them
const isNaka = s => /(^|-)naka(-|$)/.test(s.id);
const ordered = [...rendered.filter(s => !isNaka(s)), ...rendered.filter(isNaka)];
const items = [
  ...ordered.map(s => ({
    cat: catOf(s), href: s.href, poster: `/showcase/h3/${s.id}.jpg`, sources: [[`/showcase/h3/${s.id}.mp4`, 'video/mp4']],
    chip: s.chip, live: s.chip_class === 'tpl-chip-live' || /^●/.test(s.chip), title: s.title, sub: s.sub, tryLabel: s.try,
    from: s.first_frame && fs.existsSync(path.join(H3_DIR, `${s.id}-from.jpg`)) ? `/showcase/h3/${s.id}-from.jpg` : null,
    sound: true,
  })),
  ...fill.map(f => ({ cat: catOf(f), href: f.href, poster: f.poster, sources: f.sources, chip: f.chip, title: f.title, sub: f.sub, tryLabel: f.try })),
  ...libClips.map(c => {
    const cat = libCat(c.group);
    return {
      cat, href: TRY[cat][1], poster: `/showcase/clips/${c.id}.jpg`, sources: [[`/showcase/clips/${c.id}.mp4`, 'video/mp4']],
      chip: lib.groups[c.group] || c.group, live: c.group === 'live', title: c.title, sub: '', tryLabel: TRY[cat][0], sound: true,
    };
  }),
];

// chat demos join their tab as the third card
const chats = fs.readFileSync(path.join(__dirname, 'chat-cards.html'), 'utf8')
  .split(/(?=<article )/).filter(b => b.startsWith('<article '))
  .map(b => ({ cat: /data-cat="(\w+)"/.exec(b)[1], html: b.trim().split('\n').map(l => '        ' + l).join('\n') }));

// One list per tab, then deal them out round-robin so "all" opens on a mix of every product.
const starsNaka = it => /\/(naka-[\w-]+|[\w]+-naka)\.jpg$/.test(it.poster);
const lists = Object.fromEntries([...CATS, 'naka'].map(c => {
  const inTab = items.filter(it => it.cat === c);
  return [c, [...inTab.filter(it => !starsNaka(it)), ...inTab.filter(starsNaka)].map(card)];
}));
for (const ch of chats) lists[ch.cat].splice(2, 0, ch.html);
const order = [];
for (let i = 0; order.length < items.length + chats.length - lists.naka.length; i++) {
  for (const c of CATS) if (lists[c][i]) order.push(lists[c][i]);
}
order.push(...lists.naka);
const videoCount = items.length;
const count = c => items.filter(it => it.cat === c).length + chats.filter(ch => ch.cat === c).length;

const note = [
  'ทุกคลิปสร้างด้วย AI ทั้งภาพและเสียง สินค้า ร้าน และตัวละครเป็นตัวอย่างสมมติ',
  rendered.length && 'คลิปที่มีป้าย “จากรูปนี้” เริ่มจากภาพนิ่งในป้าย สร้างด้วยโมเดลวิดีโอ MiniMax H3 ที่รันผ่าน Unsloth',
  fill.length && 'คลิปละครสร้างจากระบบละครของนาคา',
  chats.length && 'การ์ดแชทเป็นตัวอย่างบทสนทนา',
].filter(Boolean).join(' · ');

const block = `${START}
    <!-- generated by creative/unsloth-reel/build-reel.cjs; edit shots.json or chat-cards.html, not this block -->
    <section class="g-gallery" id="reel" aria-labelledby="reel-title" data-gallery>
${CATS.map(c => `      <span class="g-anchor" id="p-${c}" data-tab-anchor="${c}"></span>`).join('\n')}
      <div class="g-shell g-head">
        <p class="g-kicker">คลังคลิปจริง · ${videoCount} คลิป</p>
        <h2 id="reel-title">ดูงานจริงก่อน<em>ตัดสินใจ</em></h2>
        <p class="g-sub">ทุกคลิปทำด้วยนาคา พร้อมเสียงพากย์ไทย แตะปุ่มลำโพงบนคลิปเพื่อฟังเสียง หรือกดปุ่มใต้คลิปเพื่อเริ่มจากแบบเดียวกัน</p>
      </div>
      <div class="g-shell g-tabs" role="group" aria-label="เลือกประเภทงาน">
${TABS.map((t, i) => `        <button type="button" data-tab="${t.id}" aria-pressed="${i === 0}">${esc(t.label)} <span>${t.id === 'all' ? videoCount + chats.length : count(t.id)}</span></button>`).join('\n')}
      </div>
      <div class="g-shell g-panels">
${TABS.map((t, i) => `        <div class="g-panel" data-panel="${t.id}"${i ? ' hidden' : ''}><p>${t.tag ? `<b>${esc(t.tag)}</b> ` : ''}${esc(t.text)}</p><a class="btn btn-blue btn-sm" href="${esc(t.href)}">${esc(t.cta)} <span aria-hidden="true">↗</span></a></div>`).join('\n')}
      </div>
      <div class="g-shell g-grid">
${order.join('\n')}
      </div>
      <div class="g-shell g-more"><button class="g-more-btn" type="button" data-more hidden>ดูอีก <span data-more-count></span> คลิป <i aria-hidden="true">↓</i></button></div>
      <p class="g-shell g-note">${esc(note)}</p>
    </section>
    ${END}`;

const html = fs.readFileSync(INDEX, 'utf8');
const a = html.indexOf(START);
const b = html.indexOf(END);
if (a < 0 || b < a) throw new Error(`markers ${START} ... ${END} not found in public/index.html`);
fs.writeFileSync(INDEX, html.slice(0, a) + block + html.slice(b + END.length));
console.log(`library: ${videoCount} clip(s) (${fill.length} filler), ${chats.length} chat demo(s) · ${CATS.map(c => `${c} ${count(c)}`).join(', ')}`);
