// The works list is independent of the account dashboard: a failed request stays local to this section.
(function () {
  'use strict';
  const list = document.getElementById('works-list');
  if (!list) return;
  const message = document.getElementById('works-message');
  const refresh = document.getElementById('works-refresh');
  const more = document.getElementById('works-more');
  const statusLabels = {
    queued: 'รอคิว กำลังทำ',
    running: 'กำลังทำ',
    done: 'เสร็จแล้ว',
    failed: 'ไม่สำเร็จ คืนเครดิตแล้ว',
  };
  const dateFormat = new Intl.DateTimeFormat('th-TH', {
    timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short',
  });
  let next = null;
  let busy = false;

  // Match the local preview convention used by onboarding.js.
  const mock = new URLSearchParams(location.search).get('mock');
  if (mock !== null && !window.__nakaWorksMock) {
    window.__nakaWorksMock = true;
    const original = window.fetch.bind(window);
    window.fetch = function (input, init) {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      if (!url.startsWith('/api/works')) return original(input, init);
      const sample = mock === 'empty' ? [] : [
        { id: 'sample-done', title: 'สบู่มะลิ', status: 'done', createdAt: '2026-09-30 10:00:00', href: '/review/?job=sample-done' },
        { id: 'sample-running', title: 'กระเป๋าผ้า', status: 'running', createdAt: '2026-09-30 09:30:00', href: '/review/?job=sample-running' },
        { id: 'sample-failed', title: 'แก้วเซรามิก', status: 'failed', createdAt: '2026-09-29 16:20:00', href: '/review/?job=sample-failed' },
      ];
      return Promise.resolve(new Response(JSON.stringify({ works: sample, next: null }), {
        headers: { 'Content-Type': 'application/json' },
      }));
    };
  }

  function thaiDate(value) {
    // SQLite datetime('now') stores UTC without a suffix.
    const date = new Date(value && value.includes('T') ? value : String(value).replace(' ', 'T') + 'Z');
    return Number.isNaN(date.getTime()) ? '' : dateFormat.format(date);
  }

  function row(work) {
    const item = document.createElement('li');
    item.className = 'works-item';
    const info = document.createElement('div');
    info.className = 'works-info';
    const name = document.createElement('strong');
    name.className = 'works-name';
    name.textContent = work.title || 'คลิปรีวิว';
    const meta = document.createElement('div');
    meta.className = 'works-meta';
    const date = document.createElement('time');
    date.textContent = thaiDate(work.createdAt);
    const state = document.createElement('span');
    state.className = 'works-status' + (work.status === 'failed' ? ' is-failed' : '');
    state.textContent = statusLabels[work.status] || 'กำลังทำ';
    meta.append(date, state);
    info.append(name, meta);
    const open = document.createElement('a');
    open.className = 'works-open';
    open.href = '/review/?job=' + encodeURIComponent(work.id);
    open.textContent = 'เปิดดู';
    item.append(info, open);
    return item;
  }

  function setEmpty() {
    message.textContent = 'ยังไม่มีผลงาน ';
    const link = document.createElement('a');
    link.href = '/review/';
    link.textContent = 'สร้างคลิปแรก';
    message.appendChild(link);
    message.hidden = false;
  }

  async function load(append) {
    if (busy) return;
    busy = true;
    refresh.disabled = true;
    more.disabled = true;
    if (!append) {
      next = null;
      list.replaceChildren();
      message.textContent = 'กำลังโหลดผลงาน…';
      message.hidden = false;
      more.hidden = true;
    }
    try {
      const response = await fetch('/api/works' + (append && next ? '?before=' + encodeURIComponent(next) : ''), {
        credentials: 'same-origin', headers: { accept: 'application/json' },
      });
      if (!response.ok) throw new Error('โหลดผลงานไม่สำเร็จ');
      const data = await response.json();
      if (!Array.isArray(data.works)) throw new Error('โหลดผลงานไม่สำเร็จ');
      list.append(...data.works.map(row));
      next = typeof data.next === 'string' ? data.next : null;
      more.hidden = !next;
      if (list.children.length === 0) setEmpty();
      else message.hidden = true;
    } catch {
      message.textContent = 'โหลดผลงานไม่สำเร็จ ลองกดรีเฟรชอีกครั้ง';
      message.hidden = false;
    } finally {
      busy = false;
      refresh.disabled = false;
      more.disabled = false;
    }
  }

  refresh.addEventListener('click', () => load(false));
  more.addEventListener('click', () => load(true));
  load(false);
})();
