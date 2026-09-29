// /app/inbox/ — the seller's view of the AI inbox (docs/phase4-inbox.md).
// Everything customers wrote is rendered with textContent, never as HTML.
(function () {
  'use strict';

  var auth = window.NakaAuth;
  var $ = function (id) { return document.getElementById(id); };
  var state = { status: '', threadId: null, accounts: {} };

  var REASONS = {
    escalation_keyword: 'มีคำที่ต้องให้คนในร้านดูแล',
    untrusted_instruction: 'ข้อความพยายามสั่งบอท',
    attachment_requires_human: 'ลูกค้าส่งรูปหรือไฟล์',
    private_information: 'คอมเมนต์สาธารณะมีข้อมูลส่วนตัว',
    knowledge_missing: 'ยังไม่มีข้อมูลร้านให้บอทใช้ตอบ',
    ungrounded_number: 'บอทไม่แน่ใจตัวเลข',
    public_reply_redacted: 'คำตอบเดิมมีข้อมูลส่วนตัว จึงเปลี่ยนเป็นชวนไปแชท',
    model_refusal: 'บอทไม่ตอบเรื่องนี้',
    model_handoff: 'บอทแนะนำให้คนตอบ',
    draft_unavailable: 'ร่างคำตอบไม่สำเร็จ',
    invalid_event_time: 'เวลาของข้อความไม่ถูกต้อง',
  };
  var MODES = { off: 'บอทปิดอยู่', draft: 'บอทร่างคำตอบรออนุมัติ', auto: 'บอทตอบอัตโนมัติเมื่อมั่นใจ' };

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }
  function when(seconds) {
    if (!seconds) return '';
    return new Date(seconds * 1000).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });
  }
  async function api(path, options) {
    var init = Object.assign({ credentials: 'same-origin', headers: {} }, options || {});
    if (init.body && typeof init.body !== 'string') {
      init.body = JSON.stringify(init.body);
      init.headers['Content-Type'] = 'application/json';
    }
    var response = await fetch(path, init);
    if (response.status === 401) {
      location.replace('/login/?next=' + encodeURIComponent('/app/inbox/'));
      throw new Error('signed-out');
    }
    var data = response.status === 204 ? {} : await response.json().catch(function () { return {}; });
    if (!response.ok) {
      var error = new Error(data.error || 'ทำรายการไม่สำเร็จ ลองอีกครั้ง');
      error.status = response.status;
      throw error;
    }
    return data;
  }

  // ---- tabs (arrow keys move between them) ----
  var tabs = ['threads', 'settings', 'kb'];
  function selectTab(name, focus) {
    tabs.forEach(function (t) {
      var tab = $('tab-' + t);
      var on = t === name;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
      $('panel-' + t).hidden = !on;
      if (on && focus) tab.focus();
    });
  }
  tabs.forEach(function (t, i) {
    var tab = $('tab-' + t);
    tab.addEventListener('click', function () { selectTab(t); });
    tab.addEventListener('keydown', function (event) {
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
      var next = tabs[(i + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      selectTab(next, true);
    });
  });

  // ---- threads ----
  async function loadThreads() {
    var query = state.status ? '?status=' + state.status : '';
    var data = await api('/api/inbox/threads' + query);
    var list = $('thread-list');
    list.replaceChildren();
    $('thread-empty').hidden = data.threads.length > 0;
    data.threads.forEach(function (thread) {
      var item = el('li');
      var button = el('button', 'thread-item');
      button.type = 'button';
      button.setAttribute('aria-current', String(thread.id === state.threadId));
      var top = el('span', 'thread-top');
      top.append(el('b', '', thread.customerName || (thread.kind === 'dm' ? 'ลูกค้าทางแชท' : 'ผู้คอมเมนต์')),
        el('span', 'badge badge-' + thread.status, thread.status === 'needs_human' ? 'รอคนตอบ' : thread.status === 'closed' ? 'ปิดแล้ว' : 'บอทดูแล'));
      var account = state.accounts[thread.accountId];
      button.append(top, el('small', '', (thread.kind === 'dm' ? 'แชท' : 'คอมเมนต์') + (account ? ' · ' + account : '') + ' · ' + when(thread.lastMessageAt)));
      button.addEventListener('click', function () { openThread(thread.id); });
      item.append(button);
      list.append(item);
    });
  }

  async function openThread(id) {
    state.threadId = id;
    document.querySelectorAll('.thread-item').forEach(function (b) { b.setAttribute('aria-current', 'false'); });
    var view = $('thread-view');
    view.replaceChildren(el('p', 'empty', 'กำลังโหลด…'));
    var data = await api('/api/inbox/threads/' + encodeURIComponent(id));
    loadThreads().catch(function () {});
    view.replaceChildren();

    var head = el('div', 'view-head');
    head.append(el('h2', '', data.thread.customerName || (data.thread.kind === 'dm' ? 'ลูกค้าทางแชท' : 'ผู้คอมเมนต์')));
    if (data.thread.status !== 'needs_human') {
      var takeover = el('button', 'secondary-button', 'ให้คนในร้านรับต่อ');
      takeover.type = 'button';
      takeover.addEventListener('click', async function () {
        takeover.disabled = true;
        await api('/api/inbox/threads/' + encodeURIComponent(id) + '/handoff', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        openThread(id);
      });
      head.append(takeover);
    }
    view.append(head);
    if (data.thread.kind === 'comment') view.append(el('p', 'hint', 'คอมเมนต์สาธารณะ: คำตอบจะเห็นได้ทุกคน อย่าใส่ข้อมูลส่วนตัว ชวนลูกค้าไปคุยต่อในแชทแทน'));

    var log = el('ol', 'message-log');
    data.messages.forEach(function (message) {
      var item = el('li', 'bubble ' + (message.direction === 'in' ? 'bubble-in' : 'bubble-out'));
      item.append(el('p', '', message.body || '(ไฟล์แนบหรือสติกเกอร์)'), el('small', '', when(message.messageAt || message.sentAt)));
      log.append(item);
    });
    view.append(log);

    // The newest customer message that still has an unsent draft gets the reply box.
    var pending = data.messages.filter(function (m) { return m.direction === 'in' && m.status === 'drafted'; }).pop();
    var failed = data.messages.filter(function (m) { return m.error; }).pop();
    if (failed) view.append(el('p', 'form-status is-error', failed.error));
    if (pending) view.append(replyBox(pending));
  }

  function replyBox(message) {
    var form = el('form', 'reply-box');
    if (message.handoffReason) form.append(el('p', 'reason', 'ส่งต่อคนเพราะ: ' + (REASONS[message.handoffReason] || 'ต้องให้คนตรวจ')));
    var label = el('label', 'field', 'คำตอบที่นาคาร่างไว้ (แก้ได้ก่อนส่ง)');
    var area = el('textarea');
    area.rows = 4;
    area.maxLength = 900;
    area.value = message.draft || '';
    label.append(area);
    var send = el('button', 'primary-button', 'ส่งคำตอบ');
    send.type = 'submit';
    var status = el('p', 'form-status');
    status.setAttribute('role', 'status');
    form.append(label, send, status);
    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      send.disabled = true;
      status.className = 'form-status';
      status.textContent = 'กำลังส่ง…';
      try {
        var result = await api('/api/inbox/messages/' + encodeURIComponent(message.id) + '/approve', { method: 'POST', body: { reply: area.value } });
        status.textContent = result.status === 'sent' ? 'ส่งแล้ว' : 'ยังไม่ได้ส่ง ตรวจสถานะบทสนทนาอีกครั้ง';
        if (result.status === 'sent') setTimeout(function () { openThread(state.threadId); }, 600);
      } catch (error) {
        status.className = 'form-status is-error';
        status.textContent = error.message;
      } finally {
        send.disabled = false;
      }
    });
    return form;
  }

  document.querySelectorAll('.filter button').forEach(function (button) {
    button.addEventListener('click', function () {
      state.status = button.dataset.status;
      document.querySelectorAll('.filter button').forEach(function (b) { b.setAttribute('aria-pressed', String(b === button)); });
      loadThreads();
    });
  });

  // ---- settings ----
  async function loadSettings() {
    var data = await api('/api/inbox/settings');
    var form = $('settings-form');
    form.querySelector('input[name=mode][value="' + data.mode + '"]').checked = true;
    form.tone.value = data.tone;
    form.keywords.value = (data.escalate_keywords || []).join(', ');
    $('bot-state').textContent = MODES[data.mode];
    $('bot-state').dataset.mode = data.mode;
  }
  $('settings-form').addEventListener('submit', async function (event) {
    event.preventDefault();
    var form = event.currentTarget;
    var status = $('settings-status');
    status.className = 'form-status';
    status.textContent = 'กำลังบันทึก…';
    try {
      var keywords = form.keywords.value.split(/[,\n]/).map(function (k) { return k.trim(); }).filter(Boolean);
      var mode = form.querySelector('input[name=mode]:checked');
      var data = await api('/api/inbox/settings', { method: 'PUT', body: { mode: mode ? mode.value : 'off', tone: form.tone.value.trim(), escalate_keywords: keywords } });
      status.textContent = 'บันทึกแล้ว';
      $('bot-state').textContent = MODES[data.mode];
      $('bot-state').dataset.mode = data.mode;
    } catch (error) {
      status.className = 'form-status is-error';
      status.textContent = error.status === 402 ? error.message + ' · ดูแพ็กเกจได้ที่หน้าแรก' : error.message;
    }
  });

  async function loadAccounts() {
    var list = $('account-list');
    list.replaceChildren();
    try {
      var data = await api('/api/social/accounts');
      state.accounts = {};
      data.accounts.forEach(function (account) {
        state.accounts[account.id] = account.name;
        var item = el('li');
        item.append(el('b', '', account.platform === 'instagram' ? 'Instagram' : 'Facebook'), el('span', '', ' ' + account.name),
          el('span', 'badge badge-' + (account.status === 'active' ? 'open' : 'needs_human'), account.status === 'active' ? 'ใช้งานได้' : 'ต้องเชื่อมใหม่'));
        list.append(item);
      });
      if (!data.accounts.length) list.append(el('li', 'hint', 'ยังไม่ได้เชื่อมเพจ'));
    } catch (error) {
      list.append(el('li', 'hint', error.status === 503 ? 'ระบบเชื่อมต่อโซเชียลยังไม่พร้อมใช้งาน' : error.message));
    }
  }

  // ---- knowledge base ----
  async function loadKb() {
    var data = await api('/api/inbox/kb');
    var list = $('kb-list');
    list.replaceChildren();
    if (!data.items.length) list.append(el('li', 'empty', 'ยังไม่มีข้อมูลร้าน บอทจะส่งทุกข้อความให้คุณตอบเองจนกว่าจะเพิ่ม'));
    data.items.forEach(function (item) {
      var row = el('li', 'kb-item');
      var text = el('div');
      text.append(el('b', '', item.title), el('p', '', item.content));
      var remove = el('button', 'text-button', 'ลบ');
      remove.type = 'button';
      remove.setAttribute('aria-label', 'ลบ ' + item.title);
      remove.addEventListener('click', async function () {
        remove.disabled = true;
        await api('/api/inbox/kb/' + encodeURIComponent(item.id), { method: 'DELETE' });
        loadKb();
      });
      row.append(text, remove);
      list.append(row);
    });
  }
  $('kb-form').addEventListener('submit', async function (event) {
    event.preventDefault();
    var form = event.currentTarget;
    var status = $('kb-status');
    status.className = 'form-status';
    try {
      await api('/api/inbox/kb', { method: 'POST', body: { title: form.title.value.trim(), content: form.content.value.trim() } });
      form.reset();
      status.textContent = 'เพิ่มแล้ว';
      loadKb();
    } catch (error) {
      status.className = 'form-status is-error';
      status.textContent = error.message;
    }
  });

  // ---- boot ----
  $('retry').addEventListener('click', function () { location.reload(); });
  auth.me().then(async function (me) {
    if (me.status === 'signed-out') return location.replace('/login/?next=' + encodeURIComponent('/app/inbox/'));
    if (me.status !== 'signed-in' || me.source !== 'server') {
      $('page-loading').hidden = true;
      $('page-error').hidden = false;
      return;
    }
    try {
      await loadAccounts();
      await Promise.all([loadSettings(), loadThreads(), loadKb()]);
      $('page-loading').hidden = true;
      $('page').hidden = false;
    } catch (error) {
      if (error.message === 'signed-out') return;
      $('page-loading').hidden = true;
      $('page-error').hidden = false;
    }
  });
})();
