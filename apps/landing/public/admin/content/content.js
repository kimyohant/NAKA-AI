// เนื้อหาหน้าเว็บ: the home page's clip gallery (/api/admin/content/clips, src/content/showcase.ts) and
// announcements (/api/admin/content/announcements, src/content/announcements.ts).
(function () {
  'use strict';
  var A = window.NakaAdmin, $ = A.$, el = A.el;
  var CATS = {}, clips = [], filter = '', busy = false;
  var TONE = { info: ['#eef4ff', '#15264a', '#235be8'], promo: ['#fff4db', '#4a3200', '#8a5a00'], warning: ['#fbe7e5', '#5c140d', '#b42318'] };
  var STATE = { showing: ['กำลังแสดง', 'b-ok'], scheduled: ['ตั้งเวลาไว้', 'b-pending'], covered: ['มีประกาศใหม่กว่าแสดงแทน', 'b-muted'], ended: ['หมดเวลาแล้ว', 'b-muted'], off: ['ปิดแล้ว', 'b-muted'] };

  function status(text, error) { A.message($('status'), text, error); }
  function send(route, method, data) {
    return A.api('/content' + route, { method: method, headers: data ? { 'Content-Type': 'application/json' } : {}, body: data ? JSON.stringify(data) : undefined });
  }
  async function act(work, done) {
    if (busy) return;
    busy = true;
    try { await work(); if (done) status(done); }
    catch (error) { if (!A.quiet(error)) status(error.message, true); }
    finally { busy = false; }
  }

  // ---------- clips ----------
  function renderFilter() {
    var box = $('clip-filter'); box.replaceChildren();
    [['', 'ทั้งหมด']].concat(Object.keys(CATS).map(function (k) { return [k, CATS[k]]; })).forEach(function (f) {
      var n = f[0] ? clips.filter(function (c) { return c.category === f[0]; }).length : clips.length;
      var b = el('button', f[1] + ' ' + n, 'btn-sm'); b.type = 'button'; b.setAttribute('aria-pressed', String(filter === f[0]));
      b.addEventListener('click', function () { filter = f[0]; renderClips(); });
      box.append(b);
    });
  }
  function move(clip, step) {
    var shown = clips.filter(function (c) { return !filter || c.category === filter; });
    var other = shown[shown.indexOf(clip) + step];
    if (!other) return;
    var ids = clips.map(function (c) { return c.id; });
    var a = ids.indexOf(clip.id), b = ids.indexOf(other.id);
    ids[a] = other.id; ids[b] = clip.id;
    act(async function () { setClips((await send('/clips/order', 'PUT', { ids: ids })).clips); }, 'ย้าย "' + clip.title + '" แล้ว');
  }
  function button(text, label, onClick, className) {
    var b = el('button', text, 'btn-sm' + (className ? ' ' + className : '')); b.type = 'button';
    if (label) b.setAttribute('aria-label', label);
    b.addEventListener('click', onClick);
    return b;
  }
  function renderClips() {
    renderFilter();
    var list = $('clips'); list.replaceChildren();
    var shown = clips.filter(function (c) { return !filter || c.category === filter; });
    shown.forEach(function (c, i) {
      var li = el('li', null, 'clip' + (c.hidden ? ' is-hidden' : ''));
      var thumb;
      if (c.poster) { thumb = el('img', null, 'clip-thumb'); thumb.src = c.poster; thumb.alt = ''; thumb.loading = 'lazy'; thumb.width = 54; thumb.height = 72; }
      else thumb = el('span', 'แชท', 'clip-thumb chat');
      var text = el('div', null, 'clip-text');
      text.append(el('b', (i + 1) + '. ' + (c.title || 'ไม่มีชื่อ')),
        el('span', (CATS[c.category] || c.category || 'อื่น ๆ') + (c.kind === 'upload' ? ' · อัปโหลดเอง' : '') + (c.hidden ? ' · ซ่อนอยู่' : '')));
      var actions = el('div', null, 'clip-actions');
      var up = button('↑', 'เลื่อน ' + c.title + ' ขึ้น', function () { move(c, -1); }); up.disabled = i === 0;
      var down = button('↓', 'เลื่อน ' + c.title + ' ลง', function () { move(c, 1); }); down.disabled = i === shown.length - 1;
      actions.append(up, down, button(c.hidden ? 'แสดง' : 'ซ่อน', null, function () {
        act(async function () { setClips((await send('/clips/' + encodeURIComponent(c.id), 'PUT', { hidden: !c.hidden })).clips); },
          (c.hidden ? 'แสดง "' : 'ซ่อน "') + c.title + '" แล้ว');
      }));
      if (c.kind === 'upload') {
        var armed = null;
        var del = button('ลบ', null, function () {
          if (!armed) { del.textContent = 'แตะอีกครั้ง'; armed = setTimeout(function () { armed = null; del.textContent = 'ลบ'; }, 4000); return; }
          clearTimeout(armed);
          act(async function () { setClips((await send('/clips/' + encodeURIComponent(c.id), 'DELETE')).clips); }, 'ลบ "' + c.title + '" แล้ว');
        }, 'danger');
        actions.append(del);
      }
      li.append(thumb, text, actions); list.append(li);
    });
    if (!shown.length) list.append(el('li', 'ไม่มีคลิปในประเภทนี้', 'empty'));
  }
  function setClips(list) { clips = list; renderClips(); }

  $('upload-form').addEventListener('submit', function (event) {
    event.preventDefault();
    var form = new FormData();
    form.append('category', $('u-category').value); form.append('title', $('u-title').value);
    form.append('subtitle', $('u-subtitle').value); form.append('chip', $('u-chip').value);
    form.append('video', $('u-video').files[0]); form.append('poster', $('u-poster').files[0]);
    var bar = $('u-progress'); bar.hidden = false; bar.value = 0; $('u-submit').disabled = true;
    status('กำลังอัปโหลด…');
    A.upload('/content/clips', form, function (p) { bar.value = p; })
      .then(function (r) {
        setClips(r.clips); $('upload-form').reset(); $('upload-box').open = false;
        status('เพิ่มคลิปแล้ว แสดงเป็นคลิปแรกในหน้าแรก');
      })
      .catch(function (error) { if (!A.quiet(error)) status(error.message, true); })
      .finally(function () { bar.hidden = true; $('u-submit').disabled = false; });
  });

  // ---------- announcements ----------
  function unix(input) { return input.value ? Math.floor(new Date(input.value).getTime() / 1000) : null; }
  function preview() {
    var tone = TONE[$('n-tone').value];
    var box = $('n-preview'); box.replaceChildren();
    var bar = el('div', null, 'naka-announce');
    bar.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:10px;flex-wrap:wrap;padding:8px 16px;font-size:14px;text-align:center;background:' + tone[0] + ';color:' + tone[1];
    bar.append(el('span', $('n-message').value.trim() || 'ข้อความประกาศ'));
    if ($('n-link').value.trim()) { var a = el('b', $('n-label').value.trim() || 'ดูรายละเอียด'); a.style.color = tone[2]; bar.append(a); }
    box.append(bar);
    $('n-count').textContent = $('n-message').value.length + '/200';
  }
  ['n-message', 'n-tone', 'n-link', 'n-label'].forEach(function (id) { $(id).addEventListener('input', preview); });

  function renderNews(list) {
    var box = $('news'); box.replaceChildren();
    if (!list.length) box.append(el('li', 'ยังไม่มีประกาศ', 'empty'));
    list.forEach(function (n) {
      var li = el('li', null, 'record');
      var main = el('div'); main.append(el('p', n.message, 'record-title'));
      if (n.linkUrl) main.append(el('p', 'ลิงก์ "' + n.linkLabel + '" ไป ' + n.linkUrl, 'record-meta'));
      var info = el('div');
      info.append(el('p', 'เริ่ม ' + A.when(n.startsAt) + (n.endsAt ? ' · ถึง ' + A.when(n.endsAt) : ' · ไม่มีกำหนดหยุด'), 'record-meta'),
        el('p', 'โดย ' + n.createdBy, 'record-meta'));
      var end = el('div', null, 'record-end');
      var s = STATE[n.state] || [n.state, 'b-muted'];
      end.append(el('span', s[0], 'badge ' + s[1]), el('br'));
      var row = el('div', null, 'row news-actions');
      row.append(button(n.active ? 'ปิด' : 'เปิดอีกครั้ง', null, function () {
        act(async function () { renderNews((await send('/announcements/' + n.id, 'PUT', { active: !n.active })).announcements); }, n.active ? 'ปิดประกาศแล้ว' : 'เปิดประกาศอีกครั้งแล้ว');
      }));
      var armed = null;
      var del = button('ลบ', null, function () {
        if (!armed) { del.textContent = 'แตะอีกครั้ง'; armed = setTimeout(function () { armed = null; del.textContent = 'ลบ'; }, 4000); return; }
        clearTimeout(armed);
        act(async function () { renderNews((await send('/announcements/' + n.id, 'DELETE')).announcements); }, 'ลบประกาศแล้ว');
      }, 'danger');
      row.append(del); end.append(row);
      li.append(main, info, end); box.append(li);
    });
  }
  $('news-form').addEventListener('submit', function (event) {
    event.preventDefault();
    act(async function () {
      renderNews((await send('/announcements', 'POST', { message: $('n-message').value, tone: $('n-tone').value,
        linkUrl: $('n-link').value, linkLabel: $('n-label').value, startsAt: unix($('n-start')), endsAt: unix($('n-end')) })).announcements);
      $('news-form').reset(); preview();
    }, 'ประกาศแล้ว ลูกค้าจะเห็นภายในหนึ่งนาที');
  });

  async function load() {
    try {
      var r = await A.api('/content/clips');
      CATS = r.categories;
      var select = $('u-category'); select.replaceChildren();
      Object.keys(CATS).forEach(function (k) { select.append(new Option(CATS[k], k)); });
      $('media-off').hidden = r.mediaReady; $('u-submit').disabled = !r.mediaReady;
      setClips(r.clips);
      renderNews((await A.api('/content/announcements')).announcements);
      preview();
    } catch (error) { if (!A.quiet(error)) status(error.message, true); }
  }
  A.start(load);
})();
