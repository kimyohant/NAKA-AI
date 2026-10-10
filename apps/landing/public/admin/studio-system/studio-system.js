// ระบบ Studio: naka-studio's version, disk use and video queues, read through /api/admin/studio-system
// (the server calls the studio; the browser never sees its address or token). Sign-in as /admin/system/.
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var KEY = 'naka_admin_customers'; // shared with /admin/customers/ and /admin/system/: one sign-in covers all
  var token = '', authVersion = 0, signingIn = false;
  var STATUS = { queued: 'รอคิว', unknown: 'ไม่ทราบผล' };
  var USAGE = [['videos', 'วิดีโอ'], ['images', 'รูปภาพ'], ['merged', 'คลิปที่รวมแล้ว'], ['uploads', 'ไฟล์อัปโหลด'], ['db', 'ฐานข้อมูล'], ['temp', 'ไฟล์ชั่วคราว'], ['other', 'อื่น ๆ']];

  function el(tag, text, className) { var node = document.createElement(tag); if (text != null) node.textContent = String(text); if (className) node.className = className; return node; }
  function message(node, text, error) { node.textContent = text; node.className = error ? 'error' : ''; }
  function when(iso) { var d = new Date(iso); return isNaN(d) ? '—' : d.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }); }
  function bytes(n) {
    if (typeof n !== 'number' || !isFinite(n)) return '—';
    if (n >= 1024 * 1024 * 1024) return (n / 1024 / 1024 / 1024).toFixed(1) + ' GB';
    if (n >= 1024 * 1024) return Math.round(n / 1024 / 1024) + ' MB';
    if (n >= 1024) return Math.round(n / 1024) + ' KB';
    return n + ' B';
  }
  function duration(seconds) {
    var h = Math.floor(seconds / 3600), d = Math.floor(h / 24);
    return d ? d + ' วัน ' + (h % 24) + ' ชม.' : h ? h + ' ชม. ' + Math.floor((seconds % 3600) / 60) + ' นาที' : Math.floor(seconds / 60) + ' นาที';
  }
  function saveToken(value) { token = value; try { if (value) sessionStorage.setItem(KEY, value); else sessionStorage.removeItem(KEY); } catch { /* this page only */ } }

  var googleError = new URLSearchParams(location.search).get('error') === 'google' ? 'เข้าสู่ระบบด้วย Google ไม่สำเร็จ กรุณาลองอีกครั้ง' : '';
  function login(text) {
    authVersion++; saveToken('');
    $('app').hidden = true; $('logout').hidden = true; $('who').hidden = true; $('login').hidden = false; $('token').value = '';
    text = text || googleError;
    message($('login-status'), text, !!text);
  }
  // Signed in with Google (session cookie, sent automatically) or a break-glass token kept in this tab.
  async function api(route, method) {
    var version = authVersion;
    var response = await fetch('/api/admin' + route, { method: method || 'GET', cache: 'no-store',
      headers: token ? { Authorization: 'Bearer ' + token } : {} });
    if (version !== authVersion) throw new Error('stale');
    if (response.status === 401 || response.status === 403) {
      var denied = await response.clone().json().catch(function () { return {}; });
      if (denied.reason === 'origin') throw new Error(denied.error); // a refused write, not a sign-out
      login(denied.reason === 'signin' ? '' : denied.error || 'กรุณาเข้าสู่ระบบใหม่'); throw new Error('signed-out');
    }
    var result = await response.json().catch(function () { return {}; });
    if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : 'ทำรายการไม่สำเร็จ กรุณาลองใหม่');
    return result;
  }
  function quiet(error) { return error.message === 'stale' || error.message === 'signed-out'; }

  // ---------- rendering ----------

  function pair(list, term, value) { var tile = el('div', null, 'tile'); tile.append(el('dt', term), el('dd', value)); list.append(tile); }

  function cancelButton(task) {
    var button = el('button', 'ยกเลิก', 'btn btn-ghost btn-sm');
    button.type = 'button';
    var armed = null;
    button.addEventListener('click', async function () {
      // two clicks: the first arms the button for a few seconds (no browser dialog)
      if (!armed) {
        button.textContent = 'กดอีกครั้งเพื่อยืนยัน';
        armed = setTimeout(function () { armed = null; button.textContent = 'ยกเลิก'; }, 4000);
        return;
      }
      clearTimeout(armed); armed = null;
      button.disabled = true; button.textContent = 'กำลังยกเลิก…';
      try {
        await api('/studio-system/tasks/' + task.id + '/cancel', 'POST');
        message($('page-status'), 'ยกเลิกงาน #' + task.id + ' แล้ว');
        await load();
      } catch (error) {
        if (quiet(error)) return;
        button.disabled = false; button.textContent = 'ยกเลิก';
        message($('page-status'), error.message, true);
      }
    });
    return button;
  }

  function renderQueues(queues) {
    var root = $('queues'); root.replaceChildren();
    if (!queues.length) { root.append(el('p', 'ยังไม่ได้ตั้งค่า provider วิดีโอใน studio', 'muted')); return; }
    queues.forEach(function (q) {
      var block = el('div', null, 'queue');
      var head = el('div', null, 'queue-head');
      head.append(el('strong', q.name || q.provider), el('span', q.provider, 'queue-provider'));
      var stats = el('dl', null, 'studio-breakdown queue-stats');
      pair(stats, 'รอคิว', q.queued); pair(stats, 'กำลังทำ', q.running); pair(stats, 'ไม่ทราบผล', q.unknown);
      pair(stats, 'เสร็จ 24 ชม.', q.completed24h); pair(stats, 'ล้มเหลว 24 ชม.', q.failed24h);
      block.append(head, stats);
      if (q.waiting.length) {
        var wrap = el('div', null, 'table-wrap');
        var table = el('table', null, 'queue-table');
        var thead = el('thead'); var hr = el('tr');
        ['งาน', 'สถานะ', 'ช็อต', 'ส่งเมื่อ', 'ข้อความ', ''].forEach(function (h) { hr.append(el('th', h)); });
        thead.append(hr);
        var tbody = el('tbody');
        q.waiting.forEach(function (task) {
          var tr = el('tr');
          tr.append(el('td', '#' + task.id), el('td', STATUS[task.status] || task.status, 'status-' + task.status),
            el('td', task.storyboardId ? 'เรื่อง ' + (task.dramaId || '—') + ' · ช็อต ' + task.storyboardId : '—'),
            el('td', when(task.createdAt)), el('td', task.error || '—', 'queue-error'));
          var action = el('td'); action.append(cancelButton(task)); tr.append(action);
          tbody.append(tr);
        });
        table.append(thead, tbody); wrap.append(table); block.append(wrap);
      }
      root.append(block);
    });
  }

  function renderStorage(storage) {
    var usage = storage && storage.usage;
    $('storage-total').textContent = usage ? 'ใช้ไปทั้งหมด ' + bytes(usage.total) : 'กำลังคำนวณ…';
    var list = $('storage-breakdown'); list.replaceChildren();
    if (usage) USAGE.forEach(function (item) { if (usage[item[0]] || item[0] !== 'temp' && item[0] !== 'other') pair(list, item[1], bytes(usage[item[0]])); });
    if (storage && typeof storage.freeBytes === 'number') pair(list, 'พื้นที่ว่างบนดิสก์', bytes(storage.freeBytes));
    $('storage-note').textContent = storage && storage.stale ? 'ตัวเลขนี้กำลังคำนวณใหม่ โหลดหน้าใหม่ในอีกสักครู่' :
      storage && storage.computedAt ? 'คำนวณเมื่อ ' + when(storage.computedAt) : '';
  }

  function renderVersion(overview) {
    var list = $('version'); list.replaceChildren();
    pair(list, 'เวอร์ชัน', 'v' + overview.version);
    pair(list, 'ทำงานต่อเนื่อง', duration(overview.uptimeSeconds || 0));
    pair(list, 'ฐานข้อมูล', overview.database);
    pair(list, 'Node.js', overview.node);
  }

  async function load() {
    try {
      var result = await api('/studio-system');
      var overview = result.overview || {};
      $('not-connected').hidden = true; $('overview').hidden = false;
      renderQueues(overview.videoQueues || []); renderStorage(overview.storage); renderVersion(overview);
    } catch (error) {
      if (quiet(error)) throw error;
      $('overview').hidden = true; $('not-connected').hidden = false;
      $('not-connected-reason').textContent = error.message;
    }
  }

  async function loadAll() {
    var me = await api('/me');
    $('who').textContent = me.kind === 'token' ? 'เข้าด้วยโทเคนฉุกเฉิน' : 'เข้าระบบเป็น ' + me.label;
    $('who').className = 'who' + (me.kind === 'token' ? ' token' : '');
    await load();
  }
  function show() {
    $('login').hidden = true; $('app').hidden = false; $('logout').hidden = false; $('who').hidden = false; message($('login-status'), '');
    if (googleError) history.replaceState(null, '', location.pathname);
  }
  $('refresh').addEventListener('click', function () {
    message($('page-status'), 'กำลังโหลด…');
    load().then(function () { message($('page-status'), ''); }).catch(function () {});
  });
  $('logout').addEventListener('click', function () {
    var wasGoogle = !token;
    login('ออกจากระบบแล้ว');
    if (wasGoogle) fetch('/api/auth/logout', { method: 'POST' }).catch(function () {});
  });
  $('login-form').addEventListener('submit', async function (event) {
    event.preventDefault();
    var value = $('token').value.trim(); if (!value || signingIn) return;
    signingIn = true; authVersion++; saveToken(value); $('token').value = ''; message($('login-status'), 'กำลังตรวจสอบ…');
    try { await loadAll(); show(); }
    catch (error) { if (!quiet(error)) { saveToken(''); message($('login-status'), 'เชื่อมต่อไม่ได้ กรุณาลองอีกครั้ง', true); } }
    finally { signingIn = false; }
  });
  try { token = sessionStorage.getItem(KEY) || ''; } catch { /* storage unavailable */ }
  loadAll().then(show).catch(function (error) { if (!quiet(error)) login('เชื่อมต่อไม่ได้ กรุณาลองโหลดหน้าใหม่'); });
})();
