// Sign-in and API calls for back-office pages built on the shared shell (ภาพรวม, การเงิน, งานที่ล้มเหลว).
// A page has the shared sign-in card (#login, #login-form, #token, #login-status), #app, a #logout button
// and calls NakaAdmin.start(load). Signed in = a Google admin session (cookie) or the break-glass token,
// kept in sessionStorage under the key every back-office page shares, so one sign-in covers them all.
(function () {
  'use strict';
  var KEY = 'naka_admin_customers';
  var token = '', authVersion = 0, signingIn = false;
  try { token = sessionStorage.getItem(KEY) || ''; } catch (e) { /* storage unavailable: this page only */ }
  var $ = function (id) { return document.getElementById(id); };
  var googleError = new URLSearchParams(location.search).get('error') === 'google' ? 'เข้าสู่ระบบด้วย Google ไม่สำเร็จ กรุณาลองอีกครั้ง' : '';

  function el(tag, text, className) {
    var node = document.createElement(tag);
    if (text != null) node.textContent = String(text);
    if (className) node.className = className;
    return node;
  }
  function message(node, text, error) { node.textContent = text || ''; node.classList.toggle('error', !!error); }
  function save(value) { token = value; try { if (value) sessionStorage.setItem(KEY, value); else sessionStorage.removeItem(KEY); } catch (e) { /* this page only */ } }

  // ---------- formatting (Thai, Bangkok time) ----------
  function num(n) { return Number(n || 0).toLocaleString('th-TH'); }
  function baht(n) { return '฿' + Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 }); }
  /** unix seconds, an ISO string, or SQLite's 'YYYY-MM-DD HH:MM:SS' (UTC) → Thai date and time */
  function when(value) {
    if (value == null || value === '') return '—';
    var d = typeof value === 'number' ? new Date(value * 1000)
      : new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(value) ? value.replace(' ', 'T') + 'Z' : value);
    return isNaN(d) ? '—' : d.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short' });
  }

  // ---------- sign-in ----------
  function login(text) {
    authVersion++; save('');
    $('app').hidden = true; $('login').hidden = false; $('token').value = '';
    text = text || googleError;
    message($('login-status'), text, !!text && text !== 'ออกจากระบบแล้ว');
  }
  function show() {
    $('login').hidden = true; $('app').hidden = false; message($('login-status'), '');
    if (googleError) { googleError = ''; history.replaceState(null, '', location.pathname); }
  }
  function quiet(error) { return !!error && (error.message === 'stale' || error.message === 'signed-out'); }

  /** fetch /api/admin + route; a lost sign-in shows the sign-in card and throws 'signed-out'. */
  async function request(route, init) {
    var version = authVersion;
    init = init || {};
    var headers = Object.assign({}, init.headers || {}, token ? { Authorization: 'Bearer ' + token } : {});
    var response = await fetch('/api/admin' + route, Object.assign({ cache: 'no-store' }, init, { headers: headers }));
    if (version !== authVersion) throw new Error('stale');
    if (response.status === 401 || response.status === 403) {
      var denied = await response.clone().json().catch(function () { return {}; });
      if (denied.reason === 'origin') throw new Error(denied.error || 'คำขอไม่ถูกต้อง'); // a refused write, not a sign-out
      login(denied.reason === 'signin' ? '' : denied.error || 'กรุณาเข้าสู่ระบบใหม่');
      throw new Error('signed-out');
    }
    return response;
  }
  async function api(route, init) {
    var response = await request(route, init);
    var body = await response.json().catch(function () { return {}; });
    if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : 'ทำรายการไม่สำเร็จ กรุณาลองใหม่');
    return body;
  }
  /** Download a file the API answers (the token goes in a header, so a plain link would not do). */
  async function download(route, fallbackName) {
    var response = await request(route);
    if (!response.ok) {
      var body = await response.json().catch(function () { return {}; });
      throw new Error(typeof body.error === 'string' ? body.error : 'ดาวน์โหลดไม่สำเร็จ กรุณาลองใหม่');
    }
    var name = (/filename="([^"]+)"/.exec(response.headers.get('Content-Disposition') || '') || [])[1] || fallbackName;
    var url = URL.createObjectURL(await response.blob());
    var a = el('a'); a.href = url; a.download = name; a.hidden = true;
    document.body.append(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  /** POST a FormData with upload progress (fetch has none). Resolves the JSON answer; errors as api(). */
  function upload(route, form, onProgress) {
    var version = authVersion;
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/admin' + route);
      if (token) xhr.setRequestHeader('Authorization', 'Bearer ' + token);
      xhr.upload.onprogress = function (e) { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
      xhr.onerror = function () { reject(new Error('อัปโหลดไม่สำเร็จ ตรวจการเชื่อมต่อแล้วลองใหม่')); };
      xhr.onload = function () {
        if (version !== authVersion) return reject(new Error('stale'));
        var body = {}; try { body = JSON.parse(xhr.responseText); } catch (e) { /* not JSON */ }
        if (xhr.status === 401 || (xhr.status === 403 && body.reason !== 'origin')) { login(body.reason === 'signin' ? '' : body.error || 'กรุณาเข้าสู่ระบบใหม่'); return reject(new Error('signed-out')); }
        if (xhr.status < 200 || xhr.status >= 300) return reject(new Error(typeof body.error === 'string' ? body.error : 'อัปโหลดไม่สำเร็จ (HTTP ' + xhr.status + ')'));
        resolve(body);
      };
      xhr.send(form);
    });
  }

  /** Wire the sign-in card and logout, then run load() once signed in. load() shows its own errors. */
  function start(load) {
    $('logout').addEventListener('click', function () {
      var wasGoogle = !token;
      login('ออกจากระบบแล้ว');
      if (wasGoogle) fetch('/api/auth/logout', { method: 'POST' }).catch(function () {});
    });
    $('login-form').addEventListener('submit', async function (event) {
      event.preventDefault();
      var value = $('token').value.trim();
      if (!value || signingIn) return;
      signingIn = true; authVersion++; save(value); $('token').value = '';
      message($('login-status'), 'กำลังตรวจสอบ…');
      try { await api('/me'); show(); load(); }
      catch (error) { if (!quiet(error)) { save(''); message($('login-status'), 'เชื่อมต่อไม่ได้ กรุณาลองอีกครั้ง', true); } }
      finally { signingIn = false; }
    });
    api('/me').then(function () { show(); load(); })
      .catch(function (error) { if (!quiet(error)) login('เชื่อมต่อไม่ได้ กรุณาลองโหลดหน้าใหม่'); });
  }

  window.NakaAdmin = { $: $, el: el, message: message, num: num, baht: baht, when: when, api: api, download: download, upload: upload, quiet: quiet, start: start };
})();
