// แจ้งเตือน LINE: recipients, pairing codes, which alerts are sent, and the messages sent so far, through
// /api/admin/alerts (src/admin/alerts.ts).
(function () {
  'use strict';
  var A = window.NakaAdmin, $ = A.$, el = A.el;
  var pairTimer = null, pairUntil = 0, knownRecipients = 0;

  function send(route, method, data) {
    return A.api('/alerts' + route, { method: method, headers: data ? { 'Content-Type': 'application/json' } : {}, body: data ? JSON.stringify(data) : undefined });
  }
  function status(text, error) { A.message($('status'), text, error); }

  function removeButton(r) {
    var button = el('button', 'เลิกส่ง', 'btn-sm danger'); button.type = 'button';
    var armed = null;
    button.addEventListener('click', async function () {
      // two taps: the first arms the button for a few seconds (no browser dialog)
      if (!armed) { button.textContent = 'แตะอีกครั้งเพื่อยืนยัน'; armed = setTimeout(function () { armed = null; button.textContent = 'เลิกส่ง'; }, 4000); return; }
      clearTimeout(armed); armed = null; button.disabled = true;
      try { render(await send('/recipients/' + encodeURIComponent(r.id), 'DELETE')); status('เลิกส่งให้ ' + (r.name || 'ผู้รับนี้') + ' แล้ว'); }
      catch (error) { if (!A.quiet(error)) { status(error.message, true); button.disabled = false; button.textContent = 'เลิกส่ง'; } }
    });
    return button;
  }

  function render(v) {
    $('not-ready').hidden = v.lineReady;
    $('webhook-url').textContent = location.origin + '/webhook/line';
    $('pair').disabled = !v.lineReady; $('test').disabled = !v.lineReady || !v.recipients.length;

    var list = $('recipients'); list.replaceChildren();
    if (!v.recipients.length) list.append(el('li', 'ยังไม่มีผู้รับ กด "เพิ่มผู้รับ" แล้วส่งรหัสเข้า LINE OA ของร้าน', 'empty'));
    v.recipients.forEach(function (r) {
      var li = el('li', null, 'record');
      var who = el('div'); who.append(el('p', r.name || 'บัญชี LINE', 'record-title'), el('p', 'เพิ่มโดย ' + (r.addedBy || '?') + ' · ' + A.when(r.createdAt), 'record-meta'));
      var end = el('div', null, 'record-end'); end.append(removeButton(r));
      li.append(who, el('div'), end); list.append(li);
    });
    // a code in use was just paired: close the code box
    if (pairTimer && v.recipients.length > knownRecipients) { stopPairing(); status('เชื่อม LINE ของ ' + (v.recipients[v.recipients.length - 1].name || 'ผู้รับใหม่') + ' แล้ว'); }
    knownRecipients = v.recipients.length;

    var rules = $('rules'); rules.replaceChildren();
    v.rules.forEach(function (rule) {
      var label = el('label', null, 'rule'); var box = el('input'); box.type = 'checkbox'; box.checked = rule.enabled;
      box.addEventListener('change', async function () {
        box.disabled = true;
        var change = {}; change[rule.key] = box.checked;
        try { render(await send('/rules', 'PUT', change)); status((box.checked ? 'เปิด' : 'ปิด') + 'การแจ้ง "' + rule.label + '" แล้ว'); }
        catch (error) { if (!A.quiet(error)) { box.checked = !box.checked; status(error.message, true); } }
        finally { box.disabled = false; }
      });
      label.append(box, el('b', rule.label), el('span', rule.help));
      rules.append(label);
    });

    var log = $('log'); log.replaceChildren();
    if (!v.log.length) log.append(el('li', 'ยังไม่ได้ส่งข้อความ', 'empty'));
    v.log.forEach(function (m) {
      var li = el('li', null, 'record');
      var main = el('div'); main.append(el('p', A.when(m.createdAt), 'record-title'), el('p', m.text, 'log-text'));
      var end = el('div', null, 'record-end');
      end.append(el('span', 'ส่งถึง ' + m.delivered + '/' + m.recipients, 'badge ' + (m.delivered === m.recipients ? 'b-ok' : 'b-bad')));
      li.append(main, el('div'), end); log.append(li);
    });
  }

  function stopPairing() { clearInterval(pairTimer); pairTimer = null; $('pairing').hidden = true; }
  async function load() {
    try { render(await A.api('/alerts')); }
    catch (error) { if (!A.quiet(error)) status(error.message, true); }
  }

  $('pair').addEventListener('click', async function () {
    $('pair').disabled = true;
    try {
      var r = await send('/pairing', 'POST');
      $('pair-text').textContent = 'แจ้งเตือน ' + r.code;
      $('pairing').hidden = false; pairUntil = r.expiresAt * 1000;
      clearInterval(pairTimer);
      var tick = 0;
      pairTimer = setInterval(function () {
        var left = Math.max(0, Math.round((pairUntil - Date.now()) / 1000));
        $('pair-left').textContent = Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0') + ' นาที';
        if (!left) { stopPairing(); status('รหัสหมดอายุแล้ว กด "เพิ่มผู้รับ" เพื่อสร้างใหม่'); return; }
        if (++tick % 5 === 0) load(); // see the new recipient appear
      }, 1000);
    } catch (error) { if (!A.quiet(error)) status(error.message, true); }
    finally { $('pair').disabled = false; }
  });
  $('copy').addEventListener('click', function () {
    var text = $('pair-text').textContent;
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(
      function () { status('คัดลอก "' + text + '" แล้ว'); },
      function () { status('คัดลอกไม่ได้ พิมพ์ "' + text + '" เองได้เลย'); });
  });
  $('test').addEventListener('click', async function () {
    $('test').disabled = true;
    try { var r = await send('/test', 'POST'); status('ส่งข้อความทดสอบถึง ' + r.delivered + ' จาก ' + r.recipients + ' คน'); await load(); }
    catch (error) { if (!A.quiet(error)) status(error.message, true); }
    finally { $('test').disabled = false; }
  });
  A.start(load);
})();
