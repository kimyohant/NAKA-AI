// /app/billing/ — buy a prepaid package with PromptPay QR or a card (src/billing, Omise).
// The server decides every price; this page only chooses a package and shows the result.
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var params = new URLSearchParams(location.search);
  var state = { plans: [], period: params.get('period') === 'yearly' ? 'yearly' : 'monthly', planId: params.get('plan'), publicKey: null, poll: null };

  function baht(n) { return n.toLocaleString('th-TH') + ' บาท'; }
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
      card.addEventListener('click', function () { state.planId = plan.id; renderPlans(); });
      list.append(card);
    });
    var chosen = state.plans.find(function (p) { return p.id === state.planId; });
    $('pay-promptpay').disabled = !chosen;
    $('pay-card').disabled = !chosen || !state.publicKey;
    $('pay-summary').textContent = chosen
      ? 'แพ็กเกจ' + chosen.name + ' ' + (state.period === 'yearly' ? 'รายปี' : 'รายเดือน') + ' · ' + baht(state.period === 'yearly' ? chosen.yearly : chosen.monthly)
      : 'เลือกแพ็กเกจด้านบนก่อน';
  }

  document.querySelectorAll('.billing-toggle button').forEach(function (button) {
    if (button.dataset.period === state.period) button.setAttribute('aria-pressed', 'true');
    else button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', function () {
      state.period = button.dataset.period;
      document.querySelectorAll('.billing-toggle button').forEach(function (b) { b.setAttribute('aria-pressed', String(b === button)); });
      renderPlans();
    });
  });

  function watchPayment(paymentId) {
    clearInterval(state.poll);
    var tick = async function () {
      try {
        var payment = await api('/api/billing/payments/' + encodeURIComponent(paymentId));
        if (payment.status === 'successful') {
          clearInterval(state.poll);
          $('qr-box').hidden = true;
          setStatus('ชำระเงินสำเร็จ เปิดแพ็กเกจและเติมเครดิตให้แล้ว');
          history.replaceState(null, '', '/app/billing/');
          loadState();
        } else if (payment.status === 'failed' || payment.status === 'expired') {
          clearInterval(state.poll);
          $('qr-box').hidden = true;
          setStatus(payment.status === 'expired' ? 'QR หมดอายุแล้ว กดจ่ายใหม่ได้เลย' : 'ชำระเงินไม่สำเร็จ ลองใหม่หรือเปลี่ยนวิธีชำระ', true);
        } else if (payment.expiresAt) {
          var left = Math.max(0, payment.expiresAt - Math.floor(Date.now() / 1000));
          $('qr-countdown').textContent = 'QR ใช้ได้อีก ' + Math.floor(left / 60) + ' นาที ' + (left % 60) + ' วินาที';
        }
      } catch (error) {
        if (error.message !== 'signed-out') setStatus('กำลังตรวจสถานะการชำระเงิน…');
      }
    };
    tick();
    state.poll = setInterval(tick, 3000);
  }

  async function checkout(extra) {
    setStatus('กำลังสร้างรายการชำระเงิน…');
    $('pay-promptpay').disabled = true;
    $('pay-card').disabled = true;
    try {
      var result = await api('/api/billing/checkout', { method: 'POST', body: Object.assign({ planId: state.planId, period: state.period }, extra) });
      if (result.redirect) { location.assign(result.redirect); return; } // 3-D Secure, returns to ?payment=
      if (result.status === 'successful') { setStatus('ชำระเงินสำเร็จ เปิดแพ็กเกจและเติมเครดิตให้แล้ว'); loadState(); return; }
      if (result.qrImageUrl) {
        $('qr-image').src = result.qrImageUrl;
        $('qr-amount').textContent = 'ยอดชำระ ' + baht(result.amount);
        $('qr-box').hidden = false;
        setStatus('');
      }
      watchPayment(result.paymentId);
    } catch (error) {
      if (error.message !== 'signed-out') setStatus(error.message, true);
    } finally {
      renderPlans();
    }
  }

  $('pay-promptpay').addEventListener('click', function () { checkout({ method: 'promptpay' }); });

  // Card: Omise.js pre-built form returns a one-time token; the server charges it.
  var omiseReady = null;
  function loadOmise() {
    if (!omiseReady) omiseReady = new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = 'https://cdn.omise.co/omise.js';
      script.onload = function () { window.OmiseCard.configure({ publicKey: state.publicKey }); resolve(); };
      script.onerror = function () { omiseReady = null; reject(new Error('โหลดแบบฟอร์มบัตรไม่สำเร็จ')); };
      document.head.append(script);
    });
    return omiseReady;
  }
  $('pay-card').addEventListener('click', async function () {
    var plan = state.plans.find(function (p) { return p.id === state.planId; });
    if (!plan) return;
    try {
      await loadOmise();
      window.OmiseCard.open({
        amount: (state.period === 'yearly' ? plan.yearly : plan.monthly) * 100,
        currency: 'THB',
        frameLabel: 'naka-ai',
        submitLabel: 'ชำระเงิน',
        defaultPaymentMethod: 'credit_card',
        onCreateTokenSuccess: function (token) { checkout({ method: 'card', token: token }); },
      });
    } catch (error) {
      setStatus(error.message, true);
    }
  });

  $('retry').addEventListener('click', function () { location.reload(); });
  window.NakaAuth.me().then(async function (me) {
    if (me.status === 'signed-out') return location.replace('/login/?next=' + encodeURIComponent(location.pathname + location.search));
    if (me.status !== 'signed-in' || me.source !== 'server') { $('page-loading').hidden = true; $('page-error').hidden = false; return; }
    try {
      state.publicKey = (await api('/api/billing/config')).publicKey;
      await loadState();
      $('page-loading').hidden = true;
      $('page').hidden = false;
      if (params.get('payment')) { setStatus('กำลังตรวจผลการชำระเงิน…'); watchPayment(params.get('payment')); }
    } catch (error) {
      if (error.message === 'signed-out') return;
      $('page-loading').hidden = true;
      $('page-error').hidden = false;
    }
  });
})();
