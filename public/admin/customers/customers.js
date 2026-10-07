(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var KEY = 'naka_admin_customers';
  var token = '', customer = null, plans = [], pending = null, busy = false, signingIn = false;
  var authVersion = 0, listVersion = 0, detailVersion = 0, selectedId = null, returnFocus = null;
  var labels = { active: 'ใช้งาน', disabled: 'ระงับ', cancelled: 'ยกเลิก', expired: 'หมดอายุ',
    pending: 'รอชำระ', successful: 'สำเร็จ', failed: 'ไม่สำเร็จ', revoked: 'ยกเลิกการเชื่อมต่อ', error: 'ขัดข้อง',
    monthly: 'รายเดือน', yearly: 'รายปี', card: 'บัตร', promptpay: 'พร้อมเพย์',
    grant: 'เติมเครดิต', purchase: 'ซื้อเครดิต', job_hold: 'ใช้เครดิต', job_refund: 'คืนเครดิต',
    credits: 'เติมเครดิต', package: 'จัดการแพ็กเกจ', status: 'เปลี่ยนสถานะ', password: 'ตั้งรหัสผ่านใหม่', stripe_checkout: 'Stripe', free: 'ฟรี',
    starter: 'เริ่มต้น', pro: 'โปร', business: 'ธุรกิจ', max: 'สูงสุด',
    facebook: 'Facebook', instagram: 'Instagram' };
  function label(value) { return labels[value] || value || '—'; }
  function num(value) { return Number(value || 0).toLocaleString('th-TH'); }
  function date(value) {
    if (value == null) return '—';
    var parsed = typeof value === 'number' ? new Date(value * 1000) : new Date(value.replace(' ', 'T') + (/[Z+-]\d|Z$/.test(value.slice(10)) ? '' : 'Z'));
    return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
  }
  function el(tag, text, className) { var node = document.createElement(tag); if (text != null) node.textContent = String(text); if (className) node.className = className; return node; }
  function message(id, text, error) { $(id).textContent = text; $(id).className = error ? 'error' : ''; }
  function saveToken(value) { token = value; try { if (value) sessionStorage.setItem(KEY, value); else sessionStorage.removeItem(KEY); } catch { /* token remains in this page only */ } }
  var googleError = new URLSearchParams(location.search).get('error') === 'google' ? 'เข้าสู่ระบบด้วย Google ไม่สำเร็จ กรุณาลองอีกครั้ง' : '';
  function login(messageText) {
    authVersion++; listVersion++; detailVersion++; saveToken(''); customer = null; selectedId = null; pending = null;
    $('app').hidden = true; $('detail').hidden = true; $('confirmation').hidden = true; $('logout').hidden = true;
    $('login').hidden = false; $('token').value = ''; $('customer-list').replaceChildren();
    var text = messageText || googleError;
    message('login-status', text, !!text);
  }
  async function api(route, data) {
    var version = authVersion;
    var response = await fetch('/api/admin/customers' + route, { method: data ? 'POST' : 'GET', cache: 'no-store', credentials: 'same-origin',
      headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(data ? { 'Content-Type': 'application/json' } : {}) }, body: data ? JSON.stringify(data) : undefined });
    if (version !== authVersion) throw new Error('stale');
    // 401/403: not signed in, not an admin, or the 12-hour admin sign-in ran out (src/admin/auth.ts).
    if (response.status === 401 || response.status === 403) {
      var denied = await response.clone().json().catch(function () { return {}; });
      if (denied.reason === 'origin') { var refused = new Error(denied.error); refused.status = 403; throw refused; } // a refused write, not a sign-out
      login(denied.reason === 'signin' ? '' : denied.error || 'กรุณาเข้าสู่ระบบใหม่'); throw new Error('signed-out');
    }
    var result = await response.json().catch(function () { return {}; });
    if (version !== authVersion) throw new Error('stale');
    if (!response.ok) { var error = new Error(typeof result.error === 'string' ? result.error : 'โหลดข้อมูลไม่สำเร็จ กรุณาลองใหม่'); error.status = response.status; throw error; }
    return result;
  }
  function usableError(error) { return error.message !== 'signed-out' && error.message !== 'stale'; }
  function lock(value) {
    busy = value;
    document.querySelectorAll('.actions fieldset').forEach(function (field) { field.disabled = value || !!pending; });
    ['confirm', 'cancel', 'logout', 'query', 'reset-search'].forEach(function (id) { $(id).disabled = value; });
  }
  function cancel() {
    pending = null; $('confirmation').hidden = true; lock(false);
    if (returnFocus) returnFocus.focus();
  }
  function summary(target, entries) {
    $(target).replaceChildren();
    entries.forEach(function (entry) { var box = el('div'); box.append(el('dt', entry[0]), el('dd', entry[1])); $(target).append(box); });
  }
  function history(target, rows, render) {
    $(target).replaceChildren();
    if (!rows.length) { $(target).append(el('p', 'ยังไม่มีรายการ', 'muted')); return; }
    var list = el('ul'); rows.forEach(function (row) { var item = el('li'); render(item, row); list.append(item); }); $(target).append(list);
  }
  async function loadCustomers() {
    var version = ++listVersion;
    message('list-status', 'กำลังค้นหาลูกค้า…'); $('customer-list').replaceChildren();
    try {
      var result = await api('?q=' + encodeURIComponent($('query').value.trim()));
      if (version !== listVersion) return;
      result.customers.forEach(function (row) {
        var tr = el('tr', null, 'customer-row' + (row.id === selectedId ? ' selected' : '')); tr.dataset.userId = row.id;
        var cell = el('td'), button = el('button', row.name || 'ไม่มีชื่อ'); button.type = 'button';
        button.setAttribute('aria-label', 'ดูรายละเอียด ' + (row.name || row.id));
        cell.append(button, el('small', row.phone || row.email || row.id));
        tr.append(cell, el('td', label(row.status)), el('td', label(row.planId)), el('td', num(row.credits), 'num'));
        tr.addEventListener('click', function () { if (!busy) openCustomer(row.id, true).catch(function () {}); });
        $('customer-list').append(tr);
      });
      message('list-status', result.customers.length ? 'แสดง ' + result.customers.length + ' คน · สูงสุด 50 คน เรียงจากสมัครล่าสุด' : 'ไม่พบลูกค้าที่ตรงกับคำค้น');
    } catch (error) { if (version === listVersion && usableError(error)) message('list-status', error.status ? error.message : 'เชื่อมต่อไม่ได้ กดค้นหาเพื่อลองอีกครั้ง', true); throw error; }
  }
  function renderDetail(data) {
    customer = data.customer; plans = data.plans;
    $('customer-title').textContent = customer.name || 'ลูกค้าไม่มีชื่อ';
    $('customer-status').textContent = label(customer.status); $('customer-status').className = 'badge ' + customer.status;
    summary('customer-summary', [['รหัสลูกค้า', customer.id], ['เบอร์โทร', customer.phone || '—'], ['อีเมล', customer.email || '—'],
      ['สมัครเมื่อ', date(customer.createdAt)], ['เครดิตคงเหลือ', num(customer.credits)], ['แพ็กเกจที่ใช้งาน', label(customer.planId)]]);
    var sub = data.subscription;
    summary('subscription-summary', sub ? [['แพ็กเกจ', sub.planName], ['สถานะ', sub.expiresAt && sub.expiresAt <= Date.now() / 1000 ? 'หมดอายุ' : label(sub.status)],
      ['ใช้ได้ถึง', sub.expiresAt == null ? 'ไม่มีกำหนด' : date(sub.expiresAt)], ['รอบ', label(sub.period)], ['เติมเครดิตรอบถัดไป', date(sub.nextCreditAt)]] : [['แพ็กเกจ', 'ฟรี — ยังไม่มีการสมัครแพ็กเกจ']]);
    $('plan').replaceChildren(); plans.forEach(function (plan) { var option = el('option', plan.name + ' · ' + num(plan.monthlyCredits) + ' เครดิต/เดือน'); option.value = plan.id; $('plan').append(option); });
    if (plans.some(function (p) { return p.id === customer.planId; })) $('plan').value = customer.planId;
    $('package-review').disabled = !plans.length;
    $('status').value = customer.status === 'disabled' ? 'active' : 'disabled';
    history('ledger', data.ledger, function (item, row) {
      item.append(el('strong', (row.delta > 0 ? '+' : '') + num(row.delta) + ' เครดิต · ' + label(row.reason)),
        el('p', row.note || 'ไม่มีหมายเหตุ', 'preserve-lines'), el('p', date(row.created_at) + ' · รายการ ' + row.id + (row.job_id ? ' · งาน ' + row.job_id : ''), 'muted'));
    });
    history('payments', data.payments, function (item, row) {
      item.append(el('strong', Number(row.amount).toLocaleString('th-TH', { minimumFractionDigits: 2 }) + ' บาท · ' + label(row.status)),
        el('p', label(row.planId) + ' · ' + label(row.period) + ' · ' + label(row.method)),
        el('p', 'สร้าง ' + date(row.createdAt) + ' · ชำระ ' + date(row.paidAt), 'muted'), el('p', 'รหัสรายการ ' + row.id, 'muted'));
    });
    history('receipts', data.receipts, function (item, row) { item.append(el('span', row.number)); });
    history('social', data.socialAccounts, function (item, row) { item.append(el('strong', row.name), el('p', label(row.platform) + ' · ' + label(row.status)), el('p', row.id, 'muted')); });
    history('audit', data.audit, function (item, row) {
      item.append(el('strong', label(row.action) + ' · ' + date(row.createdAt)), el('p', row.note, 'preserve-lines'));
      if (row.actor) item.append(el('p', 'โดย ' + row.actor, 'muted'));
      var input = row.detail.input;
      item.append(el('p', row.action === 'credits' ? 'เติม ' + num(input.amount) + ' เครดิต' : row.action === 'package' ? 'แพ็กเกจ ' + label(input.planId) + ' · ' + num(input.months) + ' เดือน' : 'สถานะ ' + label(input.status)));
      var disclosure = el('details'), table = el('table'), head = el('tr');
      head.append(el('th', 'ข้อมูล'), el('th', 'ก่อน'), el('th', 'หลัง')); var thead = el('thead'); thead.append(head); table.append(thead);
      var fields = { credits: 'เครดิต', status: 'สถานะบัญชี', planId: 'แพ็กเกจ', subscriptionStatus: 'สถานะแพ็กเกจ', expiresAt: 'วันหมดอายุ', nextCreditAt: 'เติมเครดิตถัดไป', period: 'รอบ', sessions: 'การเข้าสู่ระบบ' };
      var tbody = el('tbody'); Object.keys(fields).forEach(function (key) {
        var tr = el('tr'), before = row.detail.before[key], after = row.detail.after[key];
        var format = function (value) { return /At$/.test(key) ? date(value) : typeof value === 'number' ? num(value) : label(value); };
        tr.append(el('th', fields[key]), el('td', format(before)), el('td', format(after))); tbody.append(tr);
      }); table.append(tbody); disclosure.append(el('summary', 'ดูค่าก่อนและหลัง'), table, el('p', 'รหัสบันทึก ' + row.id, 'muted')); item.append(disclosure);
    });
    $('detail').hidden = false;
  }
  async function openCustomer(id, focus) {
    if (busy) return;
    if (pending) cancel();
    selectedId = id; customer = null; var version = ++detailVersion;
    $('detail').hidden = true; $('reload-detail').hidden = true; message('detail-status', 'กำลังโหลดรายละเอียด…');
    try {
      var data = await api('/' + encodeURIComponent(id));
      if (version !== detailVersion) return;
      renderDetail(data); message('detail-status', '');
      if (focus) { message('mutation-status', ''); $('customer-title').focus(); }
      document.querySelectorAll('.customer-row').forEach(function (row) { row.classList.toggle('selected', row.dataset.userId === selectedId); });
    } catch (error) {
      if (version === detailVersion && usableError(error)) { message('detail-status', error.status ? error.message : 'โหลดรายละเอียดไม่สำเร็จ กรุณาลองใหม่', true); $('reload-detail').hidden = false; }
      throw error;
    }
  }
  function review(action, data, event) {
    if (!customer || busy) return;
    var note = data.note.trim();
    if (!note) { message('mutation-status', 'กรุณาระบุเหตุผลก่อนยืนยัน', true); return; }
    data.note = note;
    pending = { id: customer.id, action: action, data: data };
    returnFocus = event.submitter;
    var who = (customer.name || customer.id) + ' (' + (customer.phone || customer.email || customer.id) + ')';
    var title, effect;
    if (action === 'credits') { title = 'เติม ' + num(data.amount) + ' เครดิตให้ ' + who; effect = 'เครดิตที่แสดงปัจจุบัน ' + num(customer.credits) + ' → ' + num(customer.credits + data.amount) + ' เครดิต'; }
    else if (action === 'package') {
      var plan = plans.find(function (p) { return p.id === data.planId; });
      title = 'เปิด/ต่อแพ็กเกจ ' + (plan ? plan.name : data.planId) + ' ' + data.months + ' เดือนให้ ' + who;
      effect = 'แพ็กเดิมที่ยังไม่หมดอายุจะต่อจากวันหมดเดิมโดยไม่เติมเครดิตเพิ่ม แพ็กใหม่หรือหมดแล้วเริ่มวันนี้และเติมให้ถึงยอดแพ็กเกจ โดยไม่ลดยอดที่สูงกว่า ไม่มีใบเสร็จจากรายการนี้';
    } else if (action === 'password') { title = 'ตั้งรหัสผ่านใหม่ให้ ' + who; effect = 'ระบบสุ่มรหัสใหม่และแสดงครั้งเดียวหลังยืนยัน รหัสเดิมใช้ไม่ได้ และลูกค้าจะออกจากระบบทุกอุปกรณ์'; }
    else { title = (data.status === 'disabled' ? 'ระงับบัญชี ' : 'เปิดใช้งานบัญชี ') + who; effect = data.status === 'disabled' ? 'ลูกค้าจะออกจากระบบทุกอุปกรณ์ทันที' : 'ลูกค้าต้องเข้าสู่ระบบใหม่เพื่อใช้งาน'; }
    $('confirm-summary').textContent = title; $('confirm-effect').textContent = effect;
    $('confirm-note').textContent = 'เหตุผล: ' + note; $('confirmation').hidden = false;
    message('mutation-status', 'ตรวจสอบรายการก่อนกดยืนยัน'); lock(false); $('confirm-title').focus();
  }
  ['credits', 'package', 'status', 'password'].forEach(function (action) {
    $(action + '-form').addEventListener('submit', function (event) {
      event.preventDefault(); if (pending || busy) return;
      var data = { note: $(action + '-note').value };
      if (action === 'credits') data.amount = Number($('amount').value);
      else if (action === 'package') { data.planId = $('plan').value; data.months = Number($('months').value); }
      else if (action === 'status') data.status = $('status').value;
      review(action, data, event);
    });
  });
  $('confirm').addEventListener('click', async function () {
    if (!pending || busy) return;
    var operation = pending; lock(true); message('mutation-status', 'กำลังบันทึก…');
    try {
      var result = await api('/' + encodeURIComponent(operation.id) + '/' + operation.action, operation.data);
      pending = null; $('confirmation').hidden = true; $(operation.action + '-note').value = '';
      lock(false);
      message('mutation-status', 'บันทึกสำเร็จ · รหัสบันทึก ' + result.auditId +
        (result.temporaryPassword ? ' · รหัสผ่านใหม่: ' + result.temporaryPassword + ' (แสดงครั้งเดียว แจ้งลูกค้าแล้วปิดหน้านี้)' : ''));
      try { await openCustomer(operation.id, false); await loadCustomers(); }
      catch { if (token) { message('detail-status', 'บันทึกสำเร็จแล้ว แต่โหลดข้อมูลล่าสุดไม่สำเร็จ กรุณาโหลดใหม่โดยไม่ส่งรายการซ้ำ', true); $('reload-detail').hidden = false; } }
    } catch (error) {
      pending = null; $('confirmation').hidden = true;
      if (usableError(error)) {
        $('detail').hidden = true; customer = null; $('reload-detail').hidden = false;
        message('detail-status', error.status && error.status < 500 ? error.message : 'ยังยืนยันผลบันทึกไม่ได้ กรุณาโหลดรายละเอียดและตรวจบันทึกก่อนทำรายการอีกครั้ง', true);
      }
    } finally { lock(false); }
  });
  $('cancel').addEventListener('click', cancel);
  $('reload-detail').addEventListener('click', function () { if (selectedId) openCustomer(selectedId, false).catch(function () {}); });
  $('search-form').addEventListener('submit', function (event) { event.preventDefault(); if (!busy) loadCustomers().catch(function () {}); });
  $('reset-search').addEventListener('click', function () { if (busy) return; $('query').value = ''; loadCustomers().catch(function () {}); });
  $('logout').addEventListener('click', function () {
    if (busy) return;
    login(); fetch('/api/auth/logout', { method: 'POST' }).catch(function () {});
  });
  $('login-form').addEventListener('submit', async function (event) {
    event.preventDefault(); var value = $('token').value.trim(); if (!value || busy || signingIn) return;
    signingIn = true; authVersion++; saveToken(value); $('token').value = ''; message('login-status', 'กำลังตรวจสอบ…');
    try { await loadCustomers(); $('login').hidden = true; $('app').hidden = false; $('logout').hidden = false; message('login-status', ''); }
    catch (error) { if (usableError(error)) { saveToken(''); message('login-status', 'เชื่อมต่อไม่ได้ กรุณาลองเข้าสู่ระบบอีกครั้ง', true); } }
    finally { signingIn = false; }
  });
  try { token = sessionStorage.getItem(KEY) || ''; } catch { /* storage unavailable */ }
  // A Google admin session (cookie) or a stored break-glass token.
  loadCustomers().then(function () { $('login').hidden = true; $('app').hidden = false; $('logout').hidden = false; }).catch(function (error) { if (usableError(error)) login('เชื่อมต่อไม่ได้ กรุณาลองเข้าสู่ระบบอีกครั้ง'); });
})();
