// งานที่ล้มเหลว: failed jobs from GET /api/admin/jobs (src/admin/insights.ts): naka-ai's own job queue, with
// whether the credits came back, and naka-studio's image/video tasks named by customer.
(function () {
  'use strict';
  var A = window.NakaAdmin, $ = A.$, el = A.el;
  var KIND = { affiliate_review: 'คลิปรีวิว', ai_video: 'วิดีโอ AI', inbox_reply: 'ตอบแชต AI Inbox',
    marketer_insight: 'นักการตลาด AI: วิเคราะห์คลิป', marketer_bulk: 'นักการตลาด AI: ทำหลายชิ้น', marketer_recreate: 'นักการตลาด AI: ทำซ้ำคลิป' };
  var VIDEO = { recreate: 'ทำซ้ำคลิปไวรัล', replace: 'เปลี่ยนคน/สินค้า', product: 'วิดีโอสินค้า', plan: 'โฆษณาหลายแบบ' };
  var version = 0;

  function customer(userId, name) {
    if (!userId) return el('span', 'ไม่ทราบเจ้าของ');
    var a = el('a', name || userId); a.href = '/admin/customers/?customer=' + encodeURIComponent(userId);
    return a;
  }
  function empty(list, text) { list.replaceChildren(el('li', text, 'empty')); }

  function landingRow(job) {
    var li = el('li', null, 'record');
    var head = el('div');
    var title = el('p', (KIND[job.kind] || job.kind) + (job.videoKind ? ' · ' + (VIDEO[job.videoKind] || job.videoKind) : ''), 'record-title');
    var meta = el('p', null, 'record-meta'); meta.append(customer(job.userId, job.name));
    head.append(title, meta);
    var info = el('div');
    info.append(el('p', 'ล้มเหลว ' + A.when(job.failedAt) + ' · ลอง ' + job.attempts + '/' + job.maxAttempts + ' ครั้ง', 'record-meta'),
      el('p', 'งาน ' + job.id + (job.videoProvider ? ' · ' + job.videoProvider : ''), 'record-meta'));
    var end = el('div', null, 'record-end');
    if (!job.cost) end.append(el('span', 'ไม่มีค่าใช้จ่าย', 'badge b-muted'));
    else if (job.refunded) end.append(el('span', 'คืน ' + A.num(job.cost) + ' เครดิตแล้ว', 'badge b-ok'));
    else end.append(el('span', 'ยังไม่คืน ' + A.num(job.cost) + ' เครดิต', 'badge b-bad'));
    li.append(head, info, end);
    if (job.error) li.append(el('p', job.error, 'record-error'));
    return li;
  }

  function studioRow(task) {
    var li = el('li', null, 'record');
    var head = el('div');
    head.append(el('p', (task.type === 'video' ? 'วิดีโอ' : task.type === 'image' ? 'รูปภาพ' : task.type) + (task.dramaTitle ? ' · ' + task.dramaTitle : ''), 'record-title'));
    var meta = el('p', null, 'record-meta'); meta.append(customer(task.ownerUserId, task.customerName));
    if (task.ownerUserId && !task.customerKnown) meta.append(' (ไม่พบในระบบลูกค้า)');
    head.append(meta);
    var info = el('div');
    info.append(el('p', 'ล้มเหลว ' + A.when(task.updatedAt), 'record-meta'),
      el('p', 'งาน #' + task.id + (task.storyboardId ? ' · ช็อต ' + task.storyboardId : '') + (task.configName ? ' · ' + task.configName : task.provider ? ' · ' + task.provider : ''), 'record-meta'));
    var end = el('div', null, 'record-end');
    var c = task.credits;
    if (!c) end.append(el('span', 'ไม่มีค่าใช้จ่าย', 'badge b-muted'));
    else if (c.status === 'refunded') end.append(el('span', 'คืน ' + A.num(c.credits) + ' เครดิตแล้ว', 'badge b-ok'));
    else end.append(el('span', (c.status === 'held' ? 'ยังกันไว้ ' : 'ตัดแล้ว ') + A.num(c.credits) + ' เครดิต', 'badge b-bad'));
    if (task.errorCode) { end.append(el('br')); end.append(el('span', task.errorCode, 'badge b-muted')); }
    li.append(head, info, end);
    if (task.error) li.append(el('p', task.error, 'record-error'));
    return li;
  }

  async function load() {
    var mine = ++version;
    A.message($('status'), 'กำลังโหลด…');
    try {
      var days = $('days').value;
      var r = await A.api('/jobs?days=' + encodeURIComponent(days));
      if (mine !== version) return;
      var period = r.days === 1 ? '24 ชั่วโมง' : r.days + ' วัน';
      var landing = $('landing'); landing.replaceChildren();
      r.landing.jobs.forEach(function (job) { landing.append(landingRow(job)); });
      if (!r.landing.jobs.length) empty(landing, 'ไม่มีงานล้มเหลวใน ' + period);
      else if (r.landing.total > r.landing.jobs.length) landing.append(el('li', 'แสดง ' + r.landing.jobs.length + ' จาก ' + A.num(r.landing.total) + ' งานล่าสุด', 'empty'));
      $('count-landing').textContent = '(' + A.num(r.landing.total) + ')';

      var studio = $('studio'); studio.replaceChildren();
      $('studio-error').hidden = r.studio.ok;
      if (r.studio.ok) {
        r.studio.tasks.forEach(function (task) { studio.append(studioRow(task)); });
        if (!r.studio.tasks.length) empty(studio, 'ไม่มีงานล้มเหลวใน ' + period);
        else if (r.studio.total > r.studio.tasks.length) studio.append(el('li', 'แสดง ' + r.studio.tasks.length + ' จาก ' + A.num(r.studio.total) + ' งานล่าสุด', 'empty'));
        $('count-studio').textContent = '(' + A.num(r.studio.total) + ')';
      } else {
        $('studio-error').textContent = 'ดึงข้อมูลจาก naka-studio ไม่ได้: ' + r.studio.error;
        $('count-studio').textContent = '(?)';
      }
      A.message($('status'), '');
      if (r.days === 1 && window.NakaAdminShell) window.NakaAdminShell.setBadge('jobs', r.landing.total + (r.studio.ok ? r.studio.total : 0));
    } catch (error) {
      if (mine === version && !A.quiet(error)) A.message($('status'), error.message, true);
    }
  }

  var wanted = new URLSearchParams(location.search).get('days');
  if (wanted && $('days').querySelector('option[value="' + wanted.replace(/\D/g, '') + '"]')) $('days').value = wanted;
  $('days').addEventListener('change', function () {
    history.replaceState(null, '', location.pathname + '?days=' + $('days').value);
    load();
  });
  $('refresh').addEventListener('click', load);
  A.start(load);
})();
