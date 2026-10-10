// การเงิน: every payment from GET /api/admin/payments (src/admin/insights.ts), 50 at a time, and the same
// filter as a CSV file. The filter lives in the address bar, so a link (e.g. from ภาพรวม) opens it filtered.
(function () {
  'use strict';
  var A = window.NakaAdmin, $ = A.$, el = A.el;
  var FIELDS = ['q', 'status', 'method', 'from', 'to'];
  var STATUS = { successful: ['สำเร็จ', 'b-ok'], pending: ['รอชำระ', 'b-pending'], failed: ['ไม่สำเร็จ', 'b-bad'], expired: ['หมดเวลา', 'b-muted'] };
  var METHOD = { promptpay: 'พร้อมเพย์', card: 'บัตร', stripe_checkout: 'Stripe' };
  var PERIOD = { monthly: 'รายเดือน', yearly: 'รายปี' };
  var cursor = null, version = 0;

  function query(withCursor) {
    var params = new URLSearchParams();
    FIELDS.forEach(function (f) { var v = $(f).value.trim(); if (v) params.set(f, v); });
    if (withCursor && cursor) params.set('cursor', cursor);
    return params.toString();
  }
  function fromAddress() {
    var params = new URLSearchParams(location.search);
    FIELDS.forEach(function (f) { var v = params.get(f); if (v != null) $(f).value = v; });
  }

  function row(p) {
    var li = el('li', null, 'record');
    var who = el('div');
    var title = el('p', null, 'record-title');
    var link = el('a', p.name || 'ไม่มีชื่อ'); link.href = '/admin/customers/?customer=' + encodeURIComponent(p.userId);
    title.append(link);
    who.append(title, el('p', [p.email, p.phone].filter(Boolean).join(' · ') || p.userId, 'record-meta'));
    var what = el('div');
    what.append(el('p', (p.planName || p.planId) + ' · ' + (PERIOD[p.period] || p.period) + ' · ' + (METHOD[p.method] || p.method), 'record-meta'),
      el('p', 'สร้าง ' + A.when(p.createdAt) + (p.paidAt ? ' · ชำระ ' + A.when(p.paidAt) : ''), 'record-meta'),
      el('p', 'รหัส ' + p.id + (p.receipt ? ' · ใบเสร็จ ' + p.receipt : ''), 'record-meta'));
    var end = el('div', null, 'record-end');
    // a pending payment past its expiry was never paid; the status catches up later
    var late = p.status === 'pending' && p.expiresAt && p.expiresAt * 1000 < Date.now();
    var status = late ? ['หมดเวลา (รออัปเดต)', 'b-muted'] : STATUS[p.status] || [p.status, 'b-muted'];
    end.append(el('b', A.baht(p.amount)), el('br'), el('span', status[0], 'badge ' + status[1]));
    li.append(who, what, end);
    if (p.failure) li.append(el('p', 'สาเหตุ: ' + p.failure, 'record-error'));
    return li;
  }

  async function load(append) {
    var mine = ++version;
    var line = $('status-line');
    A.message(line, 'กำลังโหลด…');
    if (!append) { cursor = null; $('list').replaceChildren(); $('more').hidden = true; }
    $('more').disabled = true;
    try {
      var result = await A.api('/payments?' + query(append));
      if (mine !== version) return;
      result.payments.forEach(function (p) { $('list').append(row(p)); });
      cursor = result.nextCursor;
      $('more').hidden = !cursor;
      var t = result.totals;
      $('totals').textContent = A.num(t.count) + ' รายการ · สำเร็จ ' + A.num(t.successful) + ' รายการ รวม ' + A.baht(t.successfulAmount);
      A.message(line, t.count ? '' : 'ไม่พบรายการที่ตรงกับตัวกรอง');
    } catch (error) {
      if (mine === version && !A.quiet(error)) A.message(line, error.message, true);
    } finally { $('more').disabled = false; }
  }

  $('filters').addEventListener('submit', function (event) {
    event.preventDefault();
    var q = query(false);
    history.replaceState(null, '', location.pathname + (q ? '?' + q : ''));
    load(false);
  });
  $('reset').addEventListener('click', function () {
    FIELDS.forEach(function (f) { $(f).value = ''; });
    history.replaceState(null, '', location.pathname);
    load(false);
  });
  $('more').addEventListener('click', function () { load(true); });
  $('csv').addEventListener('click', async function () {
    var button = $('csv');
    button.disabled = true; A.message($('status-line'), 'กำลังเตรียมไฟล์…');
    try { await A.download('/payments.csv?' + query(false), 'naka-ai-payments.csv'); A.message($('status-line'), 'ดาวน์โหลดแล้ว'); }
    catch (error) { if (!A.quiet(error)) A.message($('status-line'), error.message, true); }
    finally { button.disabled = false; }
  });
  fromAddress();
  A.start(function () { load(false); });
})();
