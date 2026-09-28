'use strict';

const demos = Object.fromEntries(Object.entries(window.NakaWorkflows.workflows).map(([key, item]) => [key, {
  label: item.name, title: [item.title, ''], description: item.description,
  outputTitle: 'ตัวอย่างร่าง · ' + item.name, text: item.demo, note: item.note,
  action: (key === 'bot' ? 'ดูบอตตอบแชทลูกค้า' : item.action) + ' →', href: key === 'bot' ? '/chatbot/' : '/studio/?workflow=' + key
}]));

const tabs = [...document.querySelectorAll('[role="tab"]')];
const title = document.getElementById('demo-title');
const storyboards = {
  sales: { title: 'จากไอเดียสู่คลิปสั้น', steps: ['เปิดเรื่องให้คนหยุดดู', 'เล่าจุดเด่นจากสินค้าจริง', 'ชวนดูรายละเอียดก่อนสั่งซื้อ'] },
  drama: { title: 'หนึ่งเรื่อง สามจังหวะ', steps: ['วางตัวละครและปมเรื่อง', 'สร้างบทสนทนาและจุดหักมุม', 'จบให้คนอยากดูตอนต่อไป'] },
  bot: { title: 'คำถามหนึ่งครั้ง ไปต่อได้', steps: ['รับคอมเมนต์หรือข้อความ', 'ตอบจากข้อมูลร้านที่ยืนยัน', 'ส่งต่อแอดมินเมื่อจำเป็น'] },
  live: { title: 'เตรียมรายการก่อนเปิดกล้อง', steps: ['เปิดรายการและแนะนำสินค้า', 'โชว์สินค้าและรับคำถาม', 'สรุปข้อมูลและช่องทางสั่งซื้อ'] }
};
let activeDemo = 'sales';
function selectDemo(name, focus = false) {
  const demo = demos[name];
  if (!demo) return;
  tabs.forEach(tab => {
    const selected = tab.dataset.tab === name;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    if (selected && focus) tab.focus();
  });
  document.getElementById('demo-panel').setAttribute('aria-labelledby', `tab-${name}`);
  document.getElementById('storyboard-art-label').textContent = `${String(Object.keys(storyboards).indexOf(name) + 1).padStart(2, '0')} / ${window.NakaWorkflows.workflows[name].name}`;
  const art = document.getElementById('storyboard-canvas');
  art.setAttribute('aria-label', 'ภาพตัวอย่างงาน' + window.NakaWorkflows.workflows[name].name);
  window.NakaCardArt.draw(art, name, { active: true });
  window.NakaCardArt.fontReady().then(() => { if (activeDemo === name) window.NakaCardArt.draw(art, name, { active: true }); });
  activeDemo = name;
  document.getElementById('storyboard-title').textContent = storyboards[name].title;
  document.getElementById('storyboard-steps').replaceChildren(...storyboards[name].steps.map((step, index) => {
    const li = document.createElement('li');
    const number = document.createElement('span');
    number.textContent = String(index + 1).padStart(2, '0');
    li.append(number, step);
    return li;
  }));
  document.getElementById('demo-label').textContent = demo.label;
  title.replaceChildren(document.createTextNode(demo.title[0]), document.createElement('br'), document.createTextNode(demo.title[1]));
  document.getElementById('demo-description').textContent = demo.description;
  document.getElementById('output-title').textContent = demo.outputTitle;
  document.getElementById('output-text').textContent = demo.text;
  document.getElementById('output-note').textContent = demo.note;
  const action = document.getElementById('demo-action');
  action.textContent = demo.action;
  action.href = demo.href;
}

tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => selectDemo(tab.dataset.tab));
  tab.addEventListener('keydown', event => {
    let next;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = tabs.length - 1;
    if (next !== undefined) { event.preventDefault(); selectDemo(tabs[next].dataset.tab, true); }
  });
});
document.querySelectorAll('[data-tab-link]').forEach(link => link.addEventListener('click', () => selectDemo(link.dataset.tabLink)));

let toastTimer;
function toast(message) {
  const element = document.getElementById('toast');
  clearTimeout(toastTimer);
  element.textContent = message;
  element.hidden = false;
  toastTimer = setTimeout(() => { element.hidden = true; }, 3500);
}
document.getElementById('copy-output').addEventListener('click', async () => {
  const output = document.getElementById('output-text');
  try {
    await navigator.clipboard.writeText(output.textContent);
    toast('คัดลอกข้อความตัวอย่างแล้ว');
  } catch {
    const range = document.createRange();
    range.selectNodeContents(output);
    const selection = window.getSelection();
    selection.removeAllRanges(); selection.addRange(range);
    toast('เลือกข้อความให้แล้ว กดคัดลอกบนอุปกรณ์ได้เลย');
  }
});

const menu = document.querySelector('.menu');
const mobileNav = document.getElementById('mobile-nav');
function closeMenu() { menu.setAttribute('aria-expanded', 'false'); menu.setAttribute('aria-label', 'เปิดเมนู'); mobileNav.hidden = true; }
menu.addEventListener('click', () => {
  const open = menu.getAttribute('aria-expanded') !== 'true';
  menu.setAttribute('aria-expanded', String(open));
  menu.setAttribute('aria-label', open ? 'ปิดเมนู' : 'เปิดเมนู');
  mobileNav.hidden = !open;
});
mobileNav.querySelectorAll('a').forEach(link => link.addEventListener('click', closeMenu));
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !mobileNav.hidden) { closeMenu(); menu.focus(); } });
window.matchMedia('(min-width: 1051px)').addEventListener('change', event => { if (event.matches) closeMenu(); });
document.getElementById('year').textContent = new Date().getFullYear();

selectDemo("sales");

// Pointer-driven 3D tilt on the storyboard card (skipped for touch and reduced motion).
const tiltArea = document.getElementById('storyboard-art');
if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
  tiltArea.addEventListener('pointermove', event => {
    if (event.pointerType !== 'mouse') return;
    const r = tiltArea.getBoundingClientRect();
    tiltArea.style.setProperty('--rx', ((event.clientY - r.top) / r.height - .5) * -10 + 'deg');
    tiltArea.style.setProperty('--ry', ((event.clientX - r.left) / r.width - .5) * 14 + 'deg');
  });
  tiltArea.addEventListener('pointerleave', () => { tiltArea.style.setProperty('--rx', '0deg'); tiltArea.style.setProperty('--ry', '0deg'); });
}
