// ผู้ดูแลและสิทธิ์: owners (ADMIN_EMAILS, read only here) and support staff, through /api/admin/staff (src/admin/staff.ts).
(function () {
  'use strict';
  var A = window.NakaAdmin, $ = A.$, el = A.el;
  function status(text, error) { A.message($('status'), text, error); }
  function send(route, method, data) {
    return A.api('/staff' + route, { method: method, headers: data ? { 'Content-Type': 'application/json' } : {}, body: data ? JSON.stringify(data) : undefined });
  }

  function render(r) {
    var list = $('people'); list.replaceChildren();
    r.owners.forEach(function (email) {
      var li = el('li', null, 'record');
      var main = el('div'); main.append(el('p', email, 'record-title'), el('p', 'ตั้งใน ADMIN_EMAILS ของเซิร์ฟเวอร์ แก้ที่ไฟล์ตั้งค่า', 'record-meta'));
      var end = el('div', null, 'record-end'); end.append(el('span', 'เจ้าของ', 'badge b-ok'));
      li.append(main, el('div'), end); list.append(li);
    });
    r.staff.forEach(function (s) {
      var li = el('li', null, 'record');
      var main = el('div'); main.append(el('p', s.email, 'record-title'), el('p', (s.note ? s.note + ' · ' : '') + 'เพิ่มโดย ' + s.addedBy + ' · ' + A.when(s.createdAt), 'record-meta'));
      var end = el('div', null, 'record-end'); end.append(el('span', 'ผู้ช่วย', 'badge'), el('br'));
      var remove = el('button', 'เอาออก', 'btn-sm danger'); remove.type = 'button';
      var armed = null;
      remove.addEventListener('click', async function () {
        if (!armed) { remove.textContent = 'แตะอีกครั้ง'; armed = setTimeout(function () { armed = null; remove.textContent = 'เอาออก'; }, 4000); return; }
        clearTimeout(armed); remove.disabled = true;
        try { render(await send('/' + encodeURIComponent(s.email), 'DELETE')); status('เอา ' + s.email + ' ออกแล้ว มีผลทันที'); }
        catch (error) { if (!A.quiet(error)) { status(error.message, true); remove.disabled = false; } }
      });
      end.append(remove);
      li.append(main, el('div'), end); list.append(li);
    });
    if (!r.owners.length && !r.staff.length) list.append(el('li', 'ยังไม่มีผู้ดูแล', 'empty'));
  }

  $('add-form').addEventListener('submit', async function (event) {
    event.preventDefault();
    try { render(await send('', 'POST', { email: $('s-email').value, note: $('s-note').value })); status('เพิ่ม ' + $('s-email').value.trim().toLowerCase() + ' เป็นผู้ช่วยแล้ว'); $('add-form').reset(); }
    catch (error) { if (!A.quiet(error)) status(error.message, true); }
  });
  A.start(async function () {
    try { render(await A.api('/staff')); }
    catch (error) { if (!A.quiet(error)) status(error.message, true); }
  });
})();
