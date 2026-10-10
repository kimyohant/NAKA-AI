// ภาพรวม: numbers across the whole system from GET /api/admin/overview (src/admin/insights.ts).
(function () {
  'use strict';
  var A = window.NakaAdmin, $ = A.$, el = A.el;

  function text(id, value) { $(id).textContent = value; }

  /** "ต้องดู": what needs an admin now, each linking to where it is handled. */
  function renderAlerts(o) {
    var list = $('alerts'); list.replaceChildren();
    function add(label, href, tone) {
      var item = el('li');
      var node = href ? el('a', label) : el('span', label, 'alert');
      if (href) node.href = href;
      if (tone) node.classList.add(tone);
      item.append(node); list.append(item);
    }
    var failed = o.jobs.failed24h + (o.studio.ok ? o.studio.failed24h : 0);
    if (failed) add('งานล้มเหลว ' + A.num(failed) + ' งานใน 24 ชั่วโมง', '/admin/jobs/?days=1', 'bad');
    if (!o.studio.ok) add('ดึงข้อมูล naka-studio ไม่ได้: ' + o.studio.error, '/admin/studio-system/', 'bad');
    else if (o.studio.unknown) add('งานวิดีโอสถานะไม่ทราบผล ' + A.num(o.studio.unknown) + ' งาน ยึดคิวไว้', '/admin/studio-system/');
    if (o.payments.pending) add('รอชำระเงิน ' + A.num(o.payments.pending) + ' รายการ', '/admin/payments/?status=pending');
    if (o.payments.failed7d) add('ชำระเงินไม่สำเร็จหรือหมดเวลา ' + A.num(o.payments.failed7d) + ' รายการใน 7 วัน', '/admin/payments/?status=failed');
    if (!list.children.length) add('ไม่มีอะไรต้องแก้ตอนนี้', null, 'ok');
    if (window.NakaAdminShell) window.NakaAdminShell.setBadge('jobs', failed);
  }

  function renderStats(o) {
    text('s-signups', A.num(o.customers.today));
    text('s-signups-sub', '7 วัน ' + A.num(o.customers.week) + ' · เดือนนี้ ' + A.num(o.customers.month) + ' · ทั้งหมด ' + A.num(o.customers.total));
    text('s-revenue', A.baht(o.revenue.month));
    text('s-revenue-sub', A.num(o.revenue.monthCount) + ' รายการ · วันนี้ ' + A.baht(o.revenue.today) + ' · เดือนก่อน ' + A.baht(o.revenue.lastMonth));
    var members = o.plans.reduce(function (n, p) { return n + p.members; }, 0);
    text('s-members', A.num(members));
    text('s-members-sub', 'ไม่รวมแพ็กเกจฟรี · ระงับ ' + A.num(o.customers.disabled) + ' บัญชี');
    text('s-credits', A.num(o.credits.usedLanding + o.credits.usedStudio));
    text('s-credits-sub', 'naka-ai ' + A.num(o.credits.usedLanding) + ' · Studio ' + A.num(o.credits.usedStudio) + ' · แจก/ซื้อ ' + A.num(o.credits.granted));
  }

  function bars(id, values, format, label) {
    var box = $(id); box.replaceChildren();
    var max = Math.max.apply(null, values.map(function (v) { return v.value; }).concat([0]));
    values.forEach(function (v, i) {
      var bar = el('span', null, (v.value ? '' : 'zero') + (i === values.length - 1 ? ' today' : ''));
      bar.style.height = max ? Math.max(2, Math.round(v.value / max * 100)) + '%' : '2px';
      bar.title = v.day + ': ' + format(v.value);
      box.append(bar);
    });
    var total = values.reduce(function (n, v) { return n + v.value; }, 0);
    box.setAttribute('aria-label', label + ' 14 วัน รวม ' + format(total) + ' สูงสุดต่อวัน ' + format(max));
  }
  function thaiDay(key) { return new Date(key + 'T00:00:00+07:00').toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short' }); }

  function renderChart(o) {
    bars('chart-signups', o.daily.map(function (d) { return { day: d.day, value: d.signups }; }), A.num, 'ลูกค้าใหม่');
    bars('chart-revenue', o.daily.map(function (d) { return { day: d.day, value: d.revenue }; }), A.baht, 'รายได้');
    text('chart-from', thaiDay(o.daily[0].day));
    var signups = o.daily.reduce(function (n, d) { return n + d.signups; }, 0), revenue = o.daily.reduce(function (n, d) { return n + d.revenue; }, 0);
    text('chart-total', 'ลูกค้าใหม่ ' + A.num(signups) + ' · รายได้ ' + A.baht(revenue));
  }

  function renderQueues(o) {
    var grid = $('queues'); grid.replaceChildren();
    function group(label) { grid.append(el('div', label, 'group')); }
    function cell(term, value, bad) { var d = el('div', null, bad && value ? 'bad' : ''); d.append(el('dt', term), el('dd', A.num(value))); grid.append(d); }
    group('naka-ai (คลิปรีวิว วิดีโอ AI ตอบแชต)');
    cell('รอคิว', o.jobs.queued); cell('กำลังทำ', o.jobs.running); cell('ล้มเหลว 24 ชม.', o.jobs.failed24h, true);
    group('Naka Studio (วิดีโอละครสั้น)');
    if (o.studio.ok) {
      cell('รอคิว', o.studio.queued); cell('กำลังทำ', o.studio.running); cell('ไม่ทราบผล', o.studio.unknown, true); cell('ล้มเหลว 24 ชม.', o.studio.failed24h, true);
      text('studio-note', 'Studio v' + (o.studio.version || '?') + ' · ' + A.num(o.studio.providers) + ' ผู้ให้บริการวิดีโอ · เสร็จ 24 ชม. ' + A.num(o.studio.completed24h) + ' งาน');
    } else text('studio-note', o.studio.error);
  }

  function renderPlans(o) {
    var list = $('plans'); list.replaceChildren();
    var max = Math.max.apply(null, o.plans.map(function (p) { return p.members; }).concat([1]));
    o.plans.forEach(function (p) {
      var li = el('li'); var track = el('span', null, 'track'); var fill = el('span');
      fill.style.width = Math.round(p.members / max * 100) + '%';
      track.append(fill);
      li.append(el('span', p.name + ' · ' + A.baht(p.price) + '/เดือน'), el('b', A.num(p.members) + ' คน'), track);
      list.append(li);
    });
  }

  async function load() {
    A.message($('status'), 'กำลังโหลด…');
    try {
      var o = await A.api('/overview');
      renderAlerts(o); renderStats(o); renderChart(o); renderQueues(o); renderPlans(o);
      $('board').hidden = false;
      text('updated', 'ตัวเลขทั้งระบบ · อัปเดต ' + A.when(o.generatedAt));
      A.message($('status'), '');
    } catch (error) {
      if (!A.quiet(error)) A.message($('status'), error.message, true);
    }
  }
  $('refresh').addEventListener('click', load);
  A.start(load);
})();
