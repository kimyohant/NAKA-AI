// การเงิน → โค้ดส่วนลด: create and switch off discount codes through /api/admin/coupons (src/billing/coupons.ts).
// Support staff see the list; creating and switching off are for owners (the server refuses them anyway).
(function () {
  'use strict';
  var A = window.NakaAdmin, $ = A.$, el = A.el;
  var STATE = { live: ['ใช้ได้', 'b-ok'], scheduled: ['ตั้งเวลาไว้', 'b-pending'], used_up: ['ใช้ครบแล้ว', 'b-muted'], ended: ['หมดอายุ', 'b-muted'], off: ['ปิดแล้ว', 'b-muted'] };
  var plans = [], loaded = false;

  function status(text, error) { A.message($('code-status'), text, error); }
  function unix(input) { return input.value ? Math.floor(new Date(input.value).getTime() / 1000) : null; }
  function int(input) { return input.value === '' ? null : Number(input.value); }
  function send(route, method, data) {
    return A.api('/coupons' + route, { method: method, headers: data ? { 'Content-Type': 'application/json' } : {}, body: data ? JSON.stringify(data) : undefined });
  }

  function describe(c) {
    var off = c.kind === 'percent' ? 'ลด ' + c.value + '%' : 'ลด ' + A.baht(c.value);
    var names = c.planIds ? c.planIds.map(function (id) { var p = plans.find(function (x) { return x.id === id; }); return p ? p.name : id; }).join(', ') : 'ทุกแพ็กเกจ';
    var period = c.period === 'monthly' ? ' · รายเดือน' : c.period === 'yearly' ? ' · รายปี' : '';
    return off + ' · ' + names + period;
  }

  function render(r) {
    plans = r.plans;
    var box = $('c-plans');
    if (!box.children.length) plans.forEach(function (p) {
      var label = el('label'); var input = el('input'); input.type = 'checkbox'; input.value = p.id;
      label.append(input, p.name); box.append(label);
    });
    var list = $('codes'); list.replaceChildren();
    if (!r.coupons.length) list.append(el('li', 'ยังไม่มีโค้ดส่วนลด', 'empty'));
    r.coupons.forEach(function (c) {
      var li = el('li', null, 'record');
      var main = el('div'); main.append(el('p', c.code, 'record-title'), el('p', describe(c), 'record-meta'));
      if (c.note) main.append(el('p', c.note, 'record-meta'));
      var info = el('div');
      info.append(el('p', 'ใช้แล้ว ' + A.num(c.paid) + (c.pending ? ' · รอชำระ ' + A.num(c.pending) : '') + (c.maxUses ? ' จาก ' + A.num(c.maxUses) : '') + ' · ต่อคน ' + c.perUser + ' ครั้ง', 'record-meta'),
        el('p', 'ลดไปแล้วรวม ' + A.baht(c.discountTotal), 'record-meta'),
        el('p', 'เริ่ม ' + A.when(c.startsAt) + (c.endsAt ? ' · ถึง ' + A.when(c.endsAt) : ''), 'record-meta'));
      var end = el('div', null, 'record-end');
      var s = STATE[c.state] || [c.state, 'b-muted'];
      end.append(el('span', s[0], 'badge ' + s[1]), el('br'));
      var toggle = el('button', c.active ? 'ปิดโค้ด' : 'เปิดอีกครั้ง', 'btn-sm'); toggle.type = 'button';
      toggle.addEventListener('click', async function () {
        toggle.disabled = true;
        try { render(await send('/' + c.code, 'PUT', { active: !c.active })); status((c.active ? 'ปิดโค้ด ' : 'เปิดโค้ด ') + c.code + ' แล้ว'); }
        catch (error) { if (!A.quiet(error)) { status(error.message, true); toggle.disabled = false; } }
      });
      end.append(toggle);
      li.append(main, info, end); list.append(li);
    });
  }

  async function load() {
    if (loaded) return;
    loaded = true;
    try {
      render(await A.api('/coupons'));
      var me = await A.api('/me');
      if (me.role !== 'owner') { $('code-create').hidden = true; document.querySelectorAll('#codes button').forEach(function (b) { b.hidden = true; }); }
    } catch (error) { loaded = false; if (!A.quiet(error)) status(error.message, true); }
  }

  $('code-form').addEventListener('submit', async function (event) {
    event.preventDefault();
    var picked = Array.prototype.map.call(document.querySelectorAll('#c-plans input:checked'), function (i) { return i.value; });
    try {
      render(await send('', 'POST', { code: $('c-code').value, kind: $('c-kind').value, value: int($('c-value')), period: $('c-period').value || null,
        maxUses: int($('c-max')), perUser: int($('c-per')) || 1, startsAt: unix($('c-start')), endsAt: unix($('c-end')),
        planIds: picked.length ? picked : null, note: $('c-note').value }));
      status('สร้างโค้ด ' + $('c-code').value.trim().toUpperCase() + ' แล้ว');
      $('code-form').reset();
    } catch (error) { if (!A.quiet(error)) status(error.message, true); }
  });
  // load when the tab is first opened (or straight away when it was the last tab used)
  $('tab-codes').addEventListener('click', load);
  var poll = setInterval(function () { if (!$('app').hidden) { clearInterval(poll); if (!$('panel-codes').hidden) load(); } }, 200);
})();
