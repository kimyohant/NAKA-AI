(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var KEY = 'naka_admin_customers'; // shared with /admin/customers/, so one sign-in covers both pages
  var token = '', authVersion = 0, signingIn = false;
  var GROUPS = { payments: 'ชำระเงิน (Stripe)', ai: 'AI และเสียงพากย์', email: 'อีเมล', login: 'การเข้าสู่ระบบ',
    sms: 'SMS OTP', video: 'วิดีโอ AI', line_bot: 'LINE OA (บอทขายของ)', meta: 'Facebook / Instagram (Meta)' };
  var SOURCES = { panel: 'ตั้งจากหน้านี้', cloudflare: 'ใช้ค่าจาก Cloudflare', default: 'ค่าเริ่มต้น', unset: 'ยังไม่ได้ตั้ง' };
  var ACTIONS = { set: 'ตั้งค่า', clear: 'ล้างค่า', import: 'ย้ายจาก Cloudflare', create: 'เพิ่มแพ็กเกจ', update: 'แก้แพ็กเกจ' };
  var PLAN_FIELDS = { name: 'ชื่อ', price_thb: 'ราคา', monthly_credits: 'เครดิต/เดือน', max_parallel_jobs: 'งานพร้อมกัน', on_sale: 'เปิดขาย' };
  var labels = {};

  function el(tag, text, className) { var node = document.createElement(tag); if (text != null) node.textContent = String(text); if (className) node.className = className; return node; }
  function message(node, text, error) { node.textContent = text; node.className = error ? 'error' : ''; }
  function date(seconds) { return new Date(seconds * 1000).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }); }
  function saveToken(value) { token = value; try { if (value) sessionStorage.setItem(KEY, value); else sessionStorage.removeItem(KEY); } catch { /* this page only */ } }

  var googleError = new URLSearchParams(location.search).get('error') === 'google' ? 'เข้าสู่ระบบด้วย Google ไม่สำเร็จ กรุณาลองอีกครั้ง' : '';
  function login(text) {
    authVersion++; saveToken('');
    $('app').hidden = true; $('logout').hidden = true; $('who').hidden = true; $('login').hidden = false; $('token').value = '';
    text = text || googleError;
    message($('login-status'), text, !!text);
  }
  // Signed in with Google (session cookie, sent automatically) or a break-glass token kept in this tab.
  async function api(route, method, data) {
    var version = authVersion;
    var response = await fetch((route.charAt(0) === '!' ? '/api/admin' + route.slice(1) : '/api/admin/system' + route), { method: method || 'GET', cache: 'no-store',
      headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(data ? { 'Content-Type': 'application/json' } : {}) }, body: data ? JSON.stringify(data) : undefined });
    if (version !== authVersion) throw new Error('stale');
    // 401/403: not signed in, not an admin, the 12-hour admin sign-in ran out, or a wrong token.
    if (response.status === 401 || response.status === 403) {
      var denied = await response.clone().json().catch(function () { return {}; });
      if (denied.reason === 'origin') throw new Error(denied.error); // a refused write, not a sign-out
      login(denied.reason === 'signin' ? '' : denied.error || 'กรุณาเข้าสู่ระบบใหม่'); throw new Error('signed-out');
    }
    var result = await response.json().catch(function () { return {}; });
    if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : 'บันทึกไม่สำเร็จ กรุณาลองใหม่');
    return result;
  }
  function quiet(error) { return error.message === 'stale' || error.message === 'signed-out'; }

  // ---------- settings ----------

  function sourceBadge(setting) {
    if (setting.kind === 'secret' && setting.set && setting.readable === false) return el('span', 'อ่านไม่ได้ — กุญแจเปลี่ยน กรุณาใส่ใหม่', 'source bad');
    var text = SOURCES[setting.source] || setting.source;
    if (setting.kind === 'secret' && setting.set && setting.hint) text += ' · ลงท้าย ' + setting.hint;
    if (setting.source === 'panel' && setting.updatedAt) text += ' · ' + date(setting.updatedAt);
    return el('span', text, 'source ' + setting.source);
  }

  function settingRow(setting, keyReady) {
    var card = el('div', null, 'card setting');
    var info = el('div');
    var id = 'set-' + setting.key;
    var name = el('label', setting.label, 'name'); name.htmlFor = id;
    info.append(name, el('div', setting.key, 'key'));
    if (setting.help) info.append(el('p', setting.help, 'muted help'));
    info.append(sourceBadge(setting));
    var status = el('p'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    var form = el('form');
    var input;

    async function save(value, button) {
      if (button) button.disabled = true;
      message(status, 'กำลังบันทึก…');
      try { render(await api('/settings/' + setting.key, 'PUT', { value: value })); flash('บันทึก ' + setting.label + ' แล้ว'); }
      catch (error) { if (!quiet(error)) message(status, error.message, true); if (input && input.type === 'checkbox') input.checked = !input.checked; }
      finally { if (button) button.disabled = false; }
    }

    if (setting.kind === 'switch') {
      var wrap = el('label', null, setting.key === 'FEATURE_MAINTENANCE' ? 'switch danger' : 'switch');
      input = el('input'); input.type = 'checkbox'; input.id = id; input.checked = setting.value === 'on';
      var state = el('span', input.checked ? 'เปิดอยู่' : 'ปิดอยู่');
      wrap.append(input, state);
      name.htmlFor = '';
      input.setAttribute('aria-label', setting.label);
      input.addEventListener('change', function () {
        if (setting.key === 'FEATURE_MAINTENANCE' && input.checked &&
            !confirm('เปิดโหมดปิดปรับปรุง? ลูกค้าจะใช้งานเว็บไม่ได้จนกว่าจะปิด')) { input.checked = false; return; }
        if (setting.key === 'FEATURE_GOOGLE_LOGIN' && !input.checked &&
            !confirm('ปิดล็อกอินด้วย Google? ผู้ดูแลจะเข้าหลังร้านใหม่ได้ด้วยโทเคนฉุกเฉินเท่านั้น (คนที่เข้าอยู่แล้วใช้ต่อได้ไม่เกิน 12 ชั่วโมง)')) { input.checked = true; return; }
        input.disabled = true;
        save(input.checked ? 'on' : 'off').finally(function () { input.disabled = false; });
      });
      form.append(wrap);
    } else {
      if (setting.kind === 'select') {
        input = el('select');
        setting.options.forEach(function (option) { var o = el('option', option); o.value = option; input.append(o); });
        input.value = setting.value || setting.options[0];
      } else {
        input = el('input');
        input.type = setting.kind === 'secret' ? 'password' : setting.kind === 'number' ? 'number' : 'text';
        input.autocomplete = 'off'; input.spellcheck = false;
        if (setting.kind === 'number') { input.min = '0'; input.step = '1'; }
        if (setting.kind === 'secret') {
          input.placeholder = setting.set ? 'ตั้งแล้ว — ใส่ค่าใหม่เพื่อเปลี่ยน' : 'วางค่าที่นี่';
          if (!keyReady) { input.disabled = true; input.placeholder = 'ต้องตั้ง SETTINGS_KEY ก่อน'; }
        } else input.value = setting.value || '';
      }
      input.id = id;
      var button = el('button', 'บันทึก', 'btn btn-primary btn-sm'); button.type = 'submit';
      if (setting.kind === 'secret' && !keyReady) button.disabled = true;
      form.append(input, button);
      form.addEventListener('submit', function (event) {
        event.preventDefault();
        var value = input.value.trim();
        if (!value) { message(status, 'กรุณากรอกค่า หรือกด "ล้างค่า" ถ้าต้องการลบ', true); return; }
        save(value, button).then(function () { if (setting.kind === 'secret') input.value = ''; });
      });
    }
    if (setting.source === 'panel') {
      var clear = el('button', 'ล้างค่า', 'btn btn-ghost btn-sm'); clear.type = 'button';
      clear.title = 'ลบค่าที่ตั้งจากหน้านี้ แล้วกลับไปใช้ค่าใน Cloudflare (ถ้ามี)';
      clear.addEventListener('click', async function () {
        if (!confirm('ล้างค่า ' + setting.label + '? ระบบจะกลับไปใช้ค่าใน Cloudflare (ถ้ามี)')) return;
        clear.disabled = true;
        try { render(await api('/settings/' + setting.key, 'DELETE')); flash('ล้างค่า ' + setting.label + ' แล้ว'); }
        catch (error) { if (!quiet(error)) message(status, error.message, true); clear.disabled = false; }
      });
      form.append(clear);
    }
    card.append(info, form, status);
    return card;
  }

  function render(data) {
    $('key-warning').hidden = data.keyReady;
    var features = $('features'), connections = $('connections'), general = $('general');
    features.replaceChildren(); connections.replaceChildren(); general.replaceChildren();
    var lastGroup = null, line = 0;
    data.settings.forEach(function (setting) {
      labels[setting.key] = setting.label;
      var row = settingRow(setting, data.keyReady);
      if (setting.group === 'features') features.append(row);
      else if (setting.group === 'general') general.append(row);
      else {
        if (setting.group !== lastGroup) {
          var title = el('h2', null, 'group-title');
          title.append(el('i', String(++line).padStart(2, '0'), 'line-no'), document.createTextNode(GROUPS[setting.group] || setting.group));
          connections.append(title); lastGroup = setting.group;
        }
        connections.append(row);
      }
    });
    $('locked').replaceChildren.apply($('locked'), data.locked.map(function (item) {
      var li = el('li'); li.append(el('span', item.label + ' (' + item.key + ')'), el('span', item.set ? 'ตั้งแล้ว' : 'ยังไม่ได้ตั้ง', item.set ? 'ok' : 'missing'));
      return li;
    }));
  }
  function flash(text) { message($('page-status'), text); }

  // ---------- plans ----------

  function numberField(labelText, value, min, max, disabled) {
    var wrap = el('div'), id = 'f' + Math.random().toString(36).slice(2);
    var label = el('label', labelText); label.htmlFor = id;
    var input = el('input'); input.type = 'number'; input.id = id; input.min = min; input.max = max; input.required = true; input.value = value; input.disabled = !!disabled;
    wrap.append(label, input);
    return { wrap: wrap, input: input };
  }

  function planCard(plan) {
    var free = plan.id === 'free';
    var form = el('form', null, 'card plan-card' + (plan.onSale || free ? '' : ' off'));
    var head = el('div', null, 'plan-head');
    head.append(el('h2', plan.name), el('span', (plan.id + (free ? '' : plan.onSale ? ' · ON SALE' : ' · OFF SALE')).toUpperCase(), 'tag'));
    var priceLine = el('p', null, 'plan-price');
    priceLine.append(document.createTextNode(Number(plan.price).toLocaleString('th-TH')),
      el('small', ' บาท/เดือน · ' + plan.subscribers + ' สมาชิกที่ใช้อยู่'));
    var grid = el('div', null, 'plan-grid');
    var nameWrap = el('div', null, 'full'), nameId = 'pn-' + plan.id, nameLabel = el('label', 'ชื่อ'); nameLabel.htmlFor = nameId;
    var name = el('input'); name.id = nameId; name.maxLength = 40; name.required = true; name.value = plan.name;
    nameWrap.append(nameLabel, name);
    var price = numberField('ราคา/เดือน (บาท)', plan.price, free ? 0 : 10, 100000, free);
    var credits = numberField('เครดิต/เดือน', plan.monthlyCredits, 0, 100000);
    var jobs = numberField('งานพร้อมกัน', plan.parallelJobs, 1, 20);
    grid.append(nameWrap, price.wrap, credits.wrap, jobs.wrap);
    var sale = el('label', null, 'check'), saleBox = el('input'); saleBox.type = 'checkbox'; saleBox.checked = plan.onSale;
    sale.append(saleBox, document.createTextNode(free ? ' แพ็กเกจฟรี (ทุกบัญชีเริ่มที่นี่)' : ' เปิดขาย'));
    saleBox.disabled = free;
    var button = el('button', 'บันทึกแพ็กเกจ', 'btn btn-primary btn-sm'); button.type = 'submit';
    var status = el('p'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    form.append(head, priceLine, grid, sale, button, status);
    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      var data = { name: name.value.trim(), monthlyCredits: Number(credits.input.value), parallelJobs: Number(jobs.input.value) };
      if (!free) { data.price = Number(price.input.value); data.onSale = saleBox.checked; }
      if (!free && plan.onSale && !data.onSale && !confirm('หยุดขายแพ็กเกจ ' + plan.name + '? ลูกค้าเดิมยังใช้ต่อได้')) return;
      button.disabled = true; message(status, 'กำลังบันทึก…');
      try { renderPlans(await api('/plans/' + plan.id, 'PUT', data)); flash('บันทึกแพ็กเกจ ' + data.name + ' แล้ว'); }
      catch (error) { if (!quiet(error)) message(status, error.message, true); button.disabled = false; }
    });
    return form;
  }
  function renderPlans(data) { $('plans').replaceChildren.apply($('plans'), data.plans.map(planCard)); }

  $('new-plan').addEventListener('submit', async function (event) {
    event.preventDefault();
    var button = event.submitter || this.querySelector('button');
    button.disabled = true; message($('new-plan-status'), 'กำลังเพิ่ม…');
    try {
      renderPlans(await api('/plans', 'POST', { id: $('np-id').value.trim(), name: $('np-name').value.trim(), price: Number($('np-price').value),
        monthlyCredits: Number($('np-credits').value), parallelJobs: Number($('np-jobs').value), onSale: $('np-sale').checked }));
      this.reset(); message($('new-plan-status'), 'เพิ่มแพ็กเกจแล้ว');
    } catch (error) { if (!quiet(error)) message($('new-plan-status'), error.message, true); }
    finally { button.disabled = false; }
  });

  // ---------- history ----------

  function describe(row) {
    var d = row.detail || {};
    if (row.area === 'plan') {
      if (!d.before) return 'ราคา ' + d.after.price_thb + ' บาท · ' + d.after.monthly_credits + ' เครดิต';
      return Object.keys(PLAN_FIELDS).filter(function (k) { return d.before[k] !== d.after[k]; })
        .map(function (k) { return PLAN_FIELDS[k] + ' ' + d.before[k] + ' → ' + d.after[k]; }).join(' · ') || 'ไม่มีการเปลี่ยนแปลง';
    }
    var show = function (v) { return v == null ? 'ไม่มี' : typeof v === 'object' ? (v.hint ? 'ค่าลับลงท้าย ' + v.hint : 'ค่าลับ') : v; };
    if (row.action === 'clear') return 'ลบ ' + show(d.before);
    return (d.before !== undefined ? show(d.before) + ' → ' : '') + show(d.after);
  }
  async function loadAudit() {
    var data = await api('/audit');
    var list = $('audit');
    if (!data.audit.length) { list.replaceChildren(el('li', 'ยังไม่มีการแก้ไข', 'muted')); return; }
    list.replaceChildren.apply(list, data.audit.map(function (row) {
      var li = el('li');
      li.append(el('p', (ACTIONS[row.action] || row.action) + ' · ' + (labels[row.target] || row.target), 'entry-head'),
        el('p', describe(row)), el('p', date(row.createdAt) + (row.actor ? ' · โดย ' + row.actor : '') + (row.note ? ' · ' + row.note : ''), 'muted'));
      return li;
    }));
  }

  // ---------- trending clips (AI marketer gallery) ----------

  var trendCategories = {};
  var SOURCE_LABEL = { curated: 'เพิ่มเอง', import: 'ไฟล์', api: 'API' };
  function shortNum(n) { return n == null ? '—' : Number(n).toLocaleString('th-TH'); }

  function renderTrending(data) {
    trendCategories = data.categories || trendCategories;
    if (!$('ta-category').options.length) {
      Object.keys(trendCategories).forEach(function (k) { var o = el('option', trendCategories[k]); o.value = k; $('ta-category').append(o); });
    }
    var c = data.counts || {};
    $('trend-summary').textContent = 'ทั้งหมด ' + data.videos.length + ' คลิป · เพิ่มเอง ' + (c.curated || 0) + ' · จากไฟล์ ' + (c.import || 0) + ' · จาก API ' + (c.api || 0) +
      (data.apiConfigured ? '' : ' · ยังไม่ได้ตั้ง API');
    $('trend-sync').disabled = !data.apiConfigured;
    $('trend-rows').replaceChildren.apply($('trend-rows'), data.videos.map(function (v) {
      var tr = el('tr', null, v.active ? '' : 'off');
      var cover = v.thumbnail ? el('img') : el('span', null, 'thumb');
      if (v.thumbnail) { cover.src = v.thumbnail; cover.alt = ''; cover.referrerPolicy = 'no-referrer'; cover.loading = 'lazy'; }
      var link = el('a', v.title || v.productName || v.url); link.href = v.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
      var first = el('td'); first.append(cover, link);
      var cat = el('select');
      Object.keys(trendCategories).forEach(function (k) { var o = el('option', trendCategories[k]); o.value = k; cat.append(o); });
      cat.value = v.category; cat.setAttribute('aria-label', 'หมวด');
      cat.addEventListener('change', function () { patchTrend(v.id, { category: cat.value }); });
      var catTd = el('td'); catTd.append(cat);
      var on = el('input'); on.type = 'checkbox'; on.checked = v.active; on.setAttribute('aria-label', 'แสดงในหน้าลูกค้า');
      on.addEventListener('change', function () { patchTrend(v.id, { active: on.checked }); });
      var onTd = el('td'); onTd.append(on);
      var del = el('button', 'ลบ', 'btn btn-danger btn-sm'); del.type = 'button';
      del.addEventListener('click', async function () {
        if (!confirm('ลบคลิปนี้ออกจากคลิปมาแรง?')) return;
        try { renderTrending(await api('!/marketer/trending/' + v.id, 'DELETE')); } catch (error) { if (!quiet(error)) flash(error.message); }
      });
      var delTd = el('td'); delTd.append(del);
      var srcTd = el('td'); srcTd.append(el('span', SOURCE_LABEL[v.source] || v.source, 'src'));
      tr.append(first, catTd, el('td', shortNum(v.views), 'num'), el('td', shortNum(v.revenue), 'num'), srcTd, onTd, delTd);
      return tr;
    }));
  }
  async function loadTrendingAdmin() { renderTrending(await api('!/marketer/trending')); }
  async function patchTrend(id, data) {
    try { renderTrending(await api('!/marketer/trending/' + id, 'PATCH', data)); flash('บันทึกแล้ว'); }
    catch (error) { if (!quiet(error)) { flash(error.message); loadTrendingAdmin().catch(function () {}); } }
  }

  $('trend-add').addEventListener('submit', async function (event) {
    event.preventDefault();
    var form = this, button = form.querySelector('button');
    button.disabled = true; message($('ta-status'), 'กำลังเพิ่ม…');
    try {
      renderTrending(await api('!/marketer/trending', 'POST', { url: $('ta-url').value.trim(), category: $('ta-category').value,
        views: $('ta-views').value.trim() || 0, revenue: $('ta-revenue').value.trim() || undefined, productName: $('ta-product').value.trim() }));
      form.reset(); message($('ta-status'), 'เพิ่มแล้ว');
    } catch (error) { if (!quiet(error)) message($('ta-status'), error.message, true); }
    finally { button.disabled = false; }
  });

  /** RFC 4180 CSV to objects keyed by the header row: quotes, commas and line breaks inside fields. */
  function parseCsv(text) {
    var rows = [], row = [], field = '', quoted = false;
    text = text.replace(/^\uFEFF/, '');
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (quoted) {
        if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (ch === '"') quoted = false; else field += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ',') { row.push(field); field = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(field); field = '';
        if (row.some(function (cell) { return cell.trim(); })) rows.push(row);
        row = [];
      } else field += ch;
    }
    row.push(field);
    if (row.some(function (cell) { return cell.trim(); })) rows.push(row);
    var header = (rows.shift() || []).map(function (h) { return h.trim(); });
    return rows.map(function (cells) { var o = {}; header.forEach(function (h, j) { if (h) o[h] = (cells[j] || '').trim(); }); return o; });
  }

  $('trend-import').addEventListener('submit', async function (event) {
    event.preventDefault();
    var form = this, file = $('ti-file').files[0];
    if (!file) return;
    if (file.size > 2500000) { message($('ti-status'), 'ไฟล์ต้องไม่เกิน 2.5 MB', true); return; }
    var text = await file.text(), rows = null;
    try {
      if (/\.json$/i.test(file.name) || /^\s*[\[{]/.test(text)) {
        var parsed = JSON.parse(text);
        rows = Array.isArray(parsed) ? parsed : ['data', 'list', 'items', 'videos', 'results'].map(function (k) { return parsed[k]; }).find(Array.isArray);
      } else rows = parseCsv(text);
    } catch (e) { rows = null; }
    if (!rows || !rows.length) { message($('ti-status'), 'อ่านไฟล์ไม่ได้ หรือไม่มีแถวข้อมูล', true); return; }
    var button = form.querySelector('button[type=submit]');
    button.disabled = true; message($('ti-status'), 'กำลังนำเข้า ' + rows.length + ' แถว…');
    try {
      var result = await api('!/marketer/trending/import', 'POST', { rows: rows.slice(0, 1000), currency: $('ti-currency').value, usdRate: Number($('ti-rate').value) || undefined });
      renderTrending(result);
      var skipped = result.skippedCount ? ' · ข้าม ' + result.skippedCount + ' แถว (เช่น ' +
        result.skipped.slice(0, 3).map(function (x) { return 'แถว ' + x.row + ': ' + x.reason; }).join(', ') + ')' : '';
      message($('ti-status'), 'นำเข้า ' + result.imported + ' คลิป' + skipped, result.skippedCount > 0);
      form.reset();
    } catch (error) { if (!quiet(error)) message($('ti-status'), error.message, true); }
    finally { button.disabled = false; }
  });

  $('trend-sync').addEventListener('click', async function () {
    var button = this;
    button.disabled = true; message($('ts-status'), 'กำลังดึง…');
    try {
      var result = await api('!/marketer/trending/sync', 'POST');
      renderTrending(result);
      message($('ts-status'), 'ดึงแล้ว ' + result.imported + ' คลิป' + (result.skipped ? ' · ข้าม ' + result.skipped : ''));
    } catch (error) { if (!quiet(error)) message($('ts-status'), error.message, true); }
    finally { button.disabled = false; }
  });

  // ---------- tabs, import, sign-in ----------

  var tabs = Array.prototype.slice.call(document.querySelectorAll('[role="tab"]'));
  function select(tab) {
    tabs.forEach(function (t) {
      var on = t === tab; t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1;
      $(t.getAttribute('aria-controls')).hidden = !on;
    });
    message($('page-status'), '');
    if (tab.id === 'tab-trending') loadTrendingAdmin().catch(function (error) { if (!quiet(error)) message($('page-status'), error.message, true); });
    if (tab.id === 'tab-audit') loadAudit().catch(function (error) { if (!quiet(error)) message($('page-status'), error.message, true); });
  }
  tabs.forEach(function (tab, i) {
    tab.addEventListener('click', function () { select(tab); });
    tab.addEventListener('keydown', function (event) {
      var next = event.key === 'ArrowRight' ? tabs[(i + 1) % tabs.length] : event.key === 'ArrowLeft' ? tabs[(i - 1 + tabs.length) % tabs.length] : null;
      if (next) { event.preventDefault(); select(next); next.focus(); }
    });
  });

  $('import').addEventListener('click', async function () {
    var button = this; button.disabled = true; message($('import-status'), 'กำลังย้าย…');
    try {
      var result = await api('/settings/import', 'POST');
      render(result);
      var text = result.imported.length ? 'ย้ายแล้ว ' + result.imported.length + ' ค่า: ' + result.imported.join(', ') : 'ไม่มีค่าใหม่ให้ย้าย';
      if (result.skipped.length) text += ' · ข้าม ' + result.skipped.map(function (s) { return s.key + ' (' + s.reason + ')'; }).join(', ');
      message($('import-status'), text, result.skipped.length > 0);
    } catch (error) { if (!quiet(error)) message($('import-status'), error.message, true); }
    finally { button.disabled = false; }
  });

  async function loadAll() {
    var results = await Promise.all([api('!/me'), api('/settings'), api('/plans')]);
    $('who').textContent = results[0].kind === 'token' ? 'เข้าด้วยโทเคนฉุกเฉิน' : 'เข้าระบบเป็น ' + results[0].label;
    $('who').className = 'who' + (results[0].kind === 'token' ? ' token' : '');
    render(results[1]); renderPlans(results[2]);
  }
  function show() {
    $('login').hidden = true; $('app').hidden = false; $('logout').hidden = false; $('who').hidden = false; message($('login-status'), '');
    if (googleError) history.replaceState(null, '', location.pathname);
  }
  $('logout').addEventListener('click', function () {
    var wasGoogle = !token;
    login('ออกจากระบบแล้ว');
    if (wasGoogle) fetch('/api/auth/logout', { method: 'POST' }).catch(function () {});
  });
  $('login-form').addEventListener('submit', async function (event) {
    event.preventDefault();
    var value = $('token').value.trim(); if (!value || signingIn) return;
    signingIn = true; authVersion++; saveToken(value); $('token').value = ''; message($('login-status'), 'กำลังตรวจสอบ…');
    try { await loadAll(); show(); }
    catch (error) { if (!quiet(error)) { saveToken(''); message($('login-status'), 'เชื่อมต่อไม่ได้ กรุณาลองอีกครั้ง', true); } }
    finally { signingIn = false; }
  });
  try { token = sessionStorage.getItem(KEY) || ''; } catch { /* storage unavailable */ }
  loadAll().then(show).catch(function (error) { if (!quiet(error)) login('เชื่อมต่อไม่ได้ กรุณาลองโหลดหน้าใหม่'); });
})();
