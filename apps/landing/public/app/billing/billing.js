// /app/billing/ — buy a prepaid package on Stripe's hosted Checkout page, PromptPay or card (src/billing).
// The server decides every price; this page only chooses a package and shows the result.
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var params = new URLSearchParams(location.search);
  var state = { plans: [], period: params.get('period') === 'yearly' ? 'yearly' : 'monthly', planId: params.get('plan'), enabled: false, poll: null };

  // whole baht as they are; a discounted price with satang always shows two decimals (319.20)
  function baht(n) { return n.toLocaleString('th-TH', Number.isInteger(n) ? {} : { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' บาท'; }
  function day(seconds) { return new Date(seconds * 1000).toLocaleDateString('th-TH', { dateStyle: 'long' }); }
  async function api(path, options) {
    var init = Object.assign({ credentials: 'same-origin' }, options || {});
    if (init.body) { init.body = JSON.stringify(init.body); init.headers = { 'Content-Type': 'application/json' }; }
    var response = await fetch(path, init);
    if (response.status === 401) { location.replace('/login/?next=' + encodeURIComponent(location.pathname + location.search)); throw new Error('signed-out'); }
    var data = await response.json().catch(function () { return {}; });
    if (!response.ok) { var error = new Error(data.error || 'ทำรายการไม่สำเร็จ ลองอีกครั้ง'); error.status = response.status; throw error; }
    return data;
  }
  function setStatus(text, isError) { $('pay-status').textContent = text; $('pay-status').className = 'form-status' + (isError ? ' is-error' : ''); }

  async function loadState() {
    var data = await api('/api/billing/me');
    state.plans = data.plans;
    var sub = data.subscription;
    $('current-name').textContent = sub ? sub.name : 'ยังไม่มีแพ็กเกจ (ฟรี)';
    $('current-meta').textContent = sub
      ? (sub.expiresAt ? 'ใช้ได้ถึง ' + day(sub.expiresAt) : 'ไม่มีวันหมดอายุ') + ' · เครดิตคงเหลือ ' + data.credits
      : 'เครดิตคงเหลือ ' + data.credits + ' · เลือกแพ็กเกจด้านล่างเพื่อเริ่มใช้งานเต็มรูปแบบ';
    renderPlans();
    loadReceipts();
  }

  // Receipts are extra: if they fail to load, the rest of the page still works.
  async function loadReceipts() {
    try {
      var list = (await api('/api/receipts')).receipts;
      $('receipt-list').replaceChildren.apply($('receipt-list'), list.map(function (r) {
        var item = document.createElement('li');
        var link = document.createElement('a');
        link.href = '/app/receipts/?id=' + encodeURIComponent(r.id);
        link.textContent = r.number;
        var meta = document.createElement('span');
        meta.textContent = r.planName + ' ' + (r.period === 'yearly' ? 'รายปี' : 'รายเดือน') + ' · ' + baht(r.amount) + ' · ' + day(r.issuedAt);
        item.append(link, meta);
        return item;
      }));
      $('receipts').hidden = list.length === 0;
    } catch (error) { /* keep the section hidden */ }
  }

  function renderPlans() {
    var list = $('plan-list');
    list.replaceChildren();
    state.plans.forEach(function (plan) {
      var price = state.period === 'yearly' ? plan.yearly : plan.monthly;
      var card = document.createElement('button');
      card.type = 'button';
      card.className = 'plan-option';
      card.setAttribute('role', 'radio');
      card.setAttribute('aria-checked', String(plan.id === state.planId));
      var name = document.createElement('b'); name.textContent = plan.name;
      var amount = document.createElement('span'); amount.className = 'plan-price'; amount.textContent = baht(price) + (state.period === 'yearly' ? '/ปี' : '/เดือน');
      var detail = document.createElement('small'); detail.textContent = plan.monthlyCredits + ' เครดิต/เดือน · ทำพร้อมกัน ' + plan.parallelJobs + ' งาน';
      card.append(name, amount, detail);
      card.addEventListener('click', function () { state.planId = plan.id; renderPlans(); if (state.coupon || $('coupon-code').value.trim()) applyCoupon(); });
      list.append(card);
    });
    var chosen = state.plans.find(function (p) { return p.id === state.planId; });
    $('pay-now').disabled = !chosen || !state.enabled;
    $('coupon-box').hidden = !state.enabled;
    var coupon = state.coupon && chosen && state.coupon.planId === chosen.id && state.coupon.period === state.period ? state.coupon : null;
    $('pay-summary').textContent = chosen
      ? 'แพ็กเกจ' + chosen.name + ' ' + (state.period === 'yearly' ? 'รายปี' : 'รายเดือน') + ' · ' +
        (coupon ? baht(coupon.amount) + ' (ปกติ ' + baht(coupon.price) + ' ' + coupon.label + ')' : baht(state.period === 'yearly' ? chosen.yearly : chosen.monthly))
      : 'เลือกแพ็กเกจด้านบนก่อน';
  }

  // A discount code is checked against the chosen package (POST /api/billing/coupon); the server checks it again at checkout.
  async function applyCoupon() {
    var code = $('coupon-code').value.trim();
    state.coupon = null;
    if (!code) { $('coupon-status').textContent = ''; renderPlans(); return; }
    if (!state.planId) { $('coupon-status').textContent = 'เลือกแพ็กเกจก่อนแล้วกดใช้โค้ด'; return; }
    $('coupon-apply').disabled = true;
    try {
      var r = await api('/api/billing/coupon', { method: 'POST', body: { code: code, planId: state.planId, period: state.period } });
      state.coupon = { code: r.code, label: r.label, price: r.price, amount: r.amount, planId: state.planId, period: state.period };
      $('coupon-status').textContent = 'ใช้โค้ด ' + r.code + ' แล้ว ' + r.label + ' เหลือ ' + baht(r.amount);
      $('coupon-status').classList.remove('error');
    } catch (error) {
      if (error.message === 'signed-out') return;
      $('coupon-status').textContent = error.message;
      $('coupon-status').classList.add('error');
    } finally { $('coupon-apply').disabled = false; renderPlans(); }
  }
  $('coupon-form').addEventListener('submit', function (event) { event.preventDefault(); applyCoupon(); });

  document.querySelectorAll('.billing-toggle button').forEach(function (button) {
    if (button.dataset.period === state.period) button.setAttribute('aria-pressed', 'true');
    else button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', function () {
      state.period = button.dataset.period;
      document.querySelectorAll('.billing-toggle button').forEach(function (b) { b.setAttribute('aria-pressed', String(b === button)); });
      renderPlans();
      if (state.coupon || $('coupon-code').value.trim()) applyCoupon();
    });
  });

  // Back from Stripe with ?payment=: the server re-reads the session from Stripe on each poll.
  // PromptPay can take a little while to settle after the page says it is done.
  function watchPayment(paymentId) {
    clearInterval(state.poll);
    var started = Date.now();
    var tick = async function () {
      try {
        var payment = await api('/api/billing/payments/' + encodeURIComponent(paymentId));
        if (payment.status === 'successful') {
          clearInterval(state.poll);
          setStatus('ชำระเงินสำเร็จ เปิดแพ็กเกจและเติมเครดิตให้แล้ว');
          history.replaceState(null, '', '/app/billing/');
          loadState();
        } else if (payment.status === 'failed' || payment.status === 'expired') {
          clearInterval(state.poll);
          setStatus(payment.status === 'expired' ? 'รายการชำระหมดเวลาแล้ว กดชำระใหม่ได้เลย' : 'ชำระเงินไม่สำเร็จ ลองใหม่หรือเปลี่ยนวิธีชำระ', true);
        } else if (params.get('cancelled')) {
          clearInterval(state.poll);
          setStatus('ยกเลิกการชำระแล้ว เลือกแพ็กเกจแล้วกดชำระใหม่ได้เลย');
          history.replaceState(null, '', '/app/billing/');
        } else if (Date.now() - started > 10 * 60 * 1000) {
          clearInterval(state.poll);
          setStatus('ยังไม่ได้รับผลการชำระ ถ้าชำระแล้ว ระบบจะเปิดแพ็กเกจให้เองภายในไม่กี่นาที กรุณาอย่าชำระซ้ำ');
        } else {
          setStatus('กำลังรอผลการชำระเงินจาก Stripe…');
        }
      } catch (error) {
        if (error.message !== 'signed-out') setStatus('กำลังตรวจสถานะการชำระเงิน…');
      }
    };
    tick();
    state.poll = setInterval(tick, 3000);
  }

  $('pay-now').addEventListener('click', async function () {
    setStatus('กำลังเปิดหน้าชำระเงิน…');
    $('pay-now').disabled = true;
    try {
      var result = await api('/api/billing/checkout', { method: 'POST', body: { planId: state.planId, period: state.period, coupon: state.coupon ? state.coupon.code : undefined } });
      location.assign(result.redirect); // Stripe returns to /app/billing/?payment=…
    } catch (error) {
      if (error.message !== 'signed-out') setStatus(error.message, true);
      renderPlans();
    }
  });

  $('retry').addEventListener('click', function () { location.reload(); });
  window.NakaAuth.me().then(async function (me) {
    if (me.status === 'signed-out') return location.replace('/login/?next=' + encodeURIComponent(location.pathname + location.search));
    if (me.status !== 'signed-in' || me.source !== 'server') { $('page-loading').hidden = true; $('page-error').hidden = false; return; }
    try {
      state.enabled = (await api('/api/billing/config')).enabled;
      await loadState();
      $('page-loading').hidden = true;
      $('page').hidden = false;
      if (!state.enabled) setStatus('ระบบชำระเงินออนไลน์ยังไม่เปิดใช้งาน สั่งซื้อแพ็กเกจได้ที่ 089-278-8587');
      if (params.get('payment')) { setStatus('กำลังตรวจผลการชำระเงิน…'); watchPayment(params.get('payment')); }
    } catch (error) {
      if (error.message === 'signed-out') return;
      $('page-loading').hidden = true;
      $('page-error').hidden = false;
    }
  });
})();
