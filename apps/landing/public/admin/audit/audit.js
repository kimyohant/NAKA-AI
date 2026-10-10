// ประวัติการจัดการ: every admin action from GET /api/admin/audit (src/admin/audit.ts), as one sentence each,
// with what changed behind "ดูค่าก่อนและหลัง".
(function () {
  'use strict';
  var A = window.NakaAdmin, $ = A.$, el = A.el;
  var FIELDS = ['q', 'source', 'actor'];
  var SOURCE = { customer: ['ลูกค้า', 'b-paid'], setting: ['ตั้งค่าระบบ', ''], plan: ['แพ็กเกจ', ''], studio: ['Studio', 'b-pending'], alert: ['แจ้งเตือน LINE', 'b-muted'], content: ['เนื้อหาหน้าเว็บ', 'b-ok'] };
  var STATUS = { active: 'ใช้งาน', disabled: 'ระงับ' };
  var FIELD = { credits: 'เครดิต', status: 'สถานะบัญชี', planId: 'แพ็กเกจ', subscriptionStatus: 'สถานะแพ็กเกจ', expiresAt: 'วันหมดอายุ',
    nextCreditAt: 'เติมเครดิตถัดไป', period: 'รอบ', sessions: 'การเข้าสู่ระบบ', name: 'ชื่อ', price_thb: 'ราคา (บาท)', monthly_credits: 'เครดิตต่อเดือน',
    max_parallel_jobs: 'งานพร้อมกัน', on_sale: 'เปิดขาย', enabled: 'เปิดใช้', monthlyLimit: 'โควตาต่อเดือน', email: 'อีเมล' };
  var cursor = null, version = 0;

  function plain(value) {
    if (value === null || value === undefined || value === '') return 'ไม่มี';
    if (typeof value === 'object' && 'hint' in value) return value.hint ? 'ค่าลับ ลงท้าย ' + value.hint : 'ค่าลับ';
    if (typeof value === 'boolean') return value ? 'เปิด' : 'ปิด';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }

  /** one Thai sentence for an entry */
  function summary(e) {
    var d = e.detail || {}, input = d.input || {};
    if (e.source === 'customer') {
      if (e.action === 'credits') return 'เติม ' + A.num(input.amount) + ' เครดิต';
      if (e.action === 'package') return 'เปิดแพ็กเกจ ' + input.planId + ' ' + input.months + ' เดือน';
      if (e.action === 'status') return 'เปลี่ยนสถานะบัญชีเป็น ' + (STATUS[input.status] || input.status);
      if (e.action === 'password') return 'ตั้งรหัสผ่านใหม่';
      if (e.action === 'feature') return 'ตั้งฟีเจอร์รายคน ' + (d.feature || '');
    }
    if (e.source === 'setting') return { set: 'ตั้งค่า ', clear: 'ล้างค่า ', import: 'ย้ายค่าจาก Cloudflare: ' }[e.action] + e.target;
    if (e.source === 'plan') return (e.action === 'create' ? 'สร้างแพ็กเกจ ' : 'แก้แพ็กเกจ ') + e.target;
    if (e.source === 'studio') return 'ยกเลิกงานใน Studio ' + e.target.replace('task:', '#');
    if (e.source === 'alert') {
      if (e.target === 'pairing') return 'สร้างรหัสเชื่อม LINE';
      if (e.target === 'rules') return 'เปลี่ยนเรื่องที่แจ้งเตือน';
      if (e.action === 'test') return 'ส่งข้อความทดสอบ';
      return (e.action === 'remove' ? 'เลิกส่งแจ้งเตือนให้ ' : 'เพิ่มผู้รับแจ้งเตือน ') + (d.name || 'บัญชี LINE');
    }
    if (e.source === 'content') {
      if (e.target.indexOf('announcement:') === 0) return { create: 'ประกาศ: ', update: (d.after && d.after.active ? 'เปิดประกาศ: ' : 'ปิดประกาศ: '), remove: 'ลบประกาศ: ' }[e.action] + (d.message || (d.after && d.after.message) || '');
      if (e.target === 'order') return 'เรียงคลิปตัวอย่างใหม่ ' + A.num(d.count) + ' คลิป';
      if (e.action === 'create') return 'เพิ่มคลิปตัวอย่าง ' + (d.title || '');
      if (e.action === 'remove') return 'ลบคลิปตัวอย่าง ' + (d.title || '');
      return (d.after && d.after.hidden ? 'ซ่อนคลิปตัวอย่าง ' : 'แสดงคลิปตัวอย่าง ') + (d.title || '');
    }
    return e.action + ' ' + e.target;
  }

  /** before → after for every field that changed; null when there is nothing to show */
  function changes(e) {
    var d = e.detail || {};
    var rows = [];
    var before = d.before, after = d.after;
    if (before && typeof before === 'object' && !('hint' in before) || after && typeof after === 'object' && !('hint' in after)) {
      var b = before || {}, a = after || {};
      Object.keys(Object.assign({}, b, a)).forEach(function (key) {
        if (JSON.stringify(b[key]) !== JSON.stringify(a[key])) rows.push([FIELD[key] || key, plain(b[key]), plain(a[key])]);
      });
    } else if ('before' in d || 'after' in d) rows.push(['ค่า', plain(before), plain(after)]);
    if (!rows.length) return null;
    var box = el('details'); box.append(el('summary', 'ดูค่าก่อนและหลัง'));
    var wrap = el('div', null, 'table-wrap'); var table = el('table'); var head = el('tr');
    head.append(el('th', 'ข้อมูล'), el('th', 'ก่อน'), el('th', 'หลัง'));
    var thead = el('thead'); thead.append(head); var tbody = el('tbody');
    rows.forEach(function (r) { var tr = el('tr'); r.forEach(function (c) { tr.append(el('td', c)); }); tbody.append(tr); });
    table.append(thead, tbody); wrap.append(table); box.append(wrap);
    return box;
  }

  function row(e) {
    var li = el('li', null, 'record');
    var main = el('div');
    main.append(el('p', summary(e), 'record-title'));
    var meta = el('p', null, 'record-meta');
    if (e.source === 'customer') {
      var link = el('a', e.targetName || e.target); link.href = '/admin/customers/?customer=' + encodeURIComponent(e.target);
      meta.append('ลูกค้า ', link);
    } else meta.append(e.actor ? 'โดย ' + e.actor : '');
    main.append(meta);
    var info = el('div');
    info.append(el('p', A.when(e.createdAt), 'record-meta'));
    if (e.source === 'customer' && e.actor) info.append(el('p', 'โดย ' + e.actor, 'record-meta'));
    var end = el('div', null, 'record-end');
    var s = SOURCE[e.source] || [e.source, ''];
    end.append(el('span', s[0], 'badge ' + s[1]));
    li.append(main, info, end);
    if (e.note) li.append(el('p', 'เหตุผล: ' + e.note, 'record-error'));
    var diff = changes(e);
    if (diff) li.append(diff);
    return li;
  }

  function query(withCursor) {
    var params = new URLSearchParams();
    FIELDS.forEach(function (f) { var v = $(f).value.trim(); if (v) params.set(f, v); });
    if (withCursor && cursor) params.set('cursor', cursor);
    return params.toString();
  }
  function fillActors(actors) {
    var select = $('actor'), keep = select.value;
    select.replaceChildren(new Option('ทุกคน', ''));
    actors.forEach(function (a) { select.append(new Option(a, a)); });
    if (keep && actors.indexOf(keep) < 0) select.append(new Option(keep, keep));
    select.value = keep;
  }

  async function load(append) {
    var mine = ++version;
    A.message($('status'), 'กำลังโหลด…');
    if (!append) { cursor = null; $('list').replaceChildren(); $('more').hidden = true; }
    $('more').disabled = true;
    try {
      var r = await A.api('/audit?' + query(append));
      if (mine !== version) return;
      fillActors(r.actors);
      r.entries.forEach(function (e) { $('list').append(row(e)); });
      cursor = r.nextCursor; $('more').hidden = !cursor;
      A.message($('status'), $('list').children.length ? '' : 'ไม่พบรายการ');
    } catch (error) { if (mine === version && !A.quiet(error)) A.message($('status'), error.message, true); }
    finally { $('more').disabled = false; }
  }

  var params = new URLSearchParams(location.search);
  FIELDS.forEach(function (f) { var v = params.get(f); if (v) { if (f === 'actor') $('actor').append(new Option(v, v)); $(f).value = v; } });
  $('filters').addEventListener('submit', function (event) {
    event.preventDefault();
    var q = query(false); history.replaceState(null, '', location.pathname + (q ? '?' + q : '')); load(false);
  });
  $('reset').addEventListener('click', function () { FIELDS.forEach(function (f) { $(f).value = ''; }); history.replaceState(null, '', location.pathname); load(false); });
  $('more').addEventListener('click', function () { load(true); });
  A.start(function () { load(false); });
})();
