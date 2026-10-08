// Phase 5B welcome card (docs/phase5-onboarding.md).
// Fetches GET /api/onboarding and renders the top card of /app/: the signup
// bonus message (only when a bonus was actually granted) and a 3-step
// checklist leading to /review/, /app/inbox/ and /app/billing/.
//
// Hiding: once all three steps are done, or the user presses "ซ่อน", the card
// stays hidden via localStorage (wrapped in try/catch — if storage is
// unavailable the card simply keeps showing).
// Failure of /api/onboarding never breaks the dashboard: no card is shown.
// ?mock=1 (and ?mock=done for the completed state) stubs the endpoint like
// public/account-menu.js does, so the card can be tried without a backend.
(function () {
  var HIDE_KEY = 'naka.onboarding.hidden';
  var mount = document.getElementById('onboarding-card');
  if (!mount) return;

  var mockValue = new URLSearchParams(location.search).get('mock');
  if (mockValue !== null) installMock();

  function storageHidden() {
    try {
      return localStorage.getItem(HIDE_KEY) === '1';
    } catch (err) {
      return false;
    }
  }
  function storageHide() {
    try {
      localStorage.setItem(HIDE_KEY, '1');
    } catch (err) {
      /* storage unavailable — the card just keeps showing */
    }
  }

  // Mock stub for /api/onboarding only; everything else passes through.
  function installMock() {
    if (window.__nakaOnboardingMock) return;
    window.__nakaOnboardingMock = true;
    var original = window.fetch.bind(window);
    window.fetch = function (input, init) {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      if (url.indexOf('/api/onboarding') === -1) return original(input, init);
      var done = mockValue === 'done';
      var plain = mockValue === 'plain';
      var payload = {
        credits: plain ? 0 : 3,
        signupBonus: plain ? 0 : 3,
        steps: { firstVideo: done, pageConnected: done, hasPackage: done },
      };
      return Promise.resolve(new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      }));
    };
  }

  var STEPS = [
    { key: 'firstVideo', label: 'สร้างคลิปรีวิวแรก', href: '/review/' },
    { key: 'pageConnected', label: 'เชื่อมเพจ Facebook ให้บอทตอบแชท', href: '/app/inbox/' },
    { key: 'hasPackage', label: 'เลือกแพ็กเกจ', href: '/app/billing/' },
  ];

  function headingFor(signupBonus) {
    if (signupBonus > 0) {
      return 'ยินดีต้อนรับ! คุณได้เครดิตฟรี ' + signupBonus + ' เครดิต ลองสร้างคลิปแรกได้เลย';
    }
    return 'ยินดีต้อนรับ! เริ่ม 3 ขั้นแรกเพื่อให้ร้านเห็นผลงานชิ้นแรก';
  }

  function stepRow(step, done) {
    var li = document.createElement('li');
    li.className = 'onboarding-step' + (done ? ' is-done' : '');

    var mark = document.createElement('span');
    mark.className = 'onboarding-mark';
    mark.setAttribute('aria-hidden', 'true');
    mark.textContent = done ? '✓' : '';
    li.appendChild(mark);

    var label = document.createElement('span');
    label.className = 'onboarding-label';
    label.textContent = step.label;
    li.appendChild(label);

    var go = document.createElement('a');
    go.className = 'onboarding-go';
    go.href = step.href;
    go.textContent = done ? 'เปิดหน้านั้น' : 'ไปทำตอนนี้';
    li.appendChild(go);
    return li;
  }

  function render(data) {
    var steps = data.steps || {};
    var doneCount = STEPS.filter(function (step) { return steps[step.key]; }).length;
    if (doneCount >= STEPS.length) {
      storageHide();
      return;
    }

    var card = document.createElement('section');
    card.className = 'onboarding-inner';
    card.setAttribute('aria-labelledby', 'onboarding-title');

    var head = document.createElement('div');
    head.className = 'onboarding-head';
    var title = document.createElement('h2');
    title.id = 'onboarding-title';
    title.textContent = headingFor(Number(data.signupBonus) || 0);
    head.appendChild(title);
    var hide = document.createElement('button');
    hide.type = 'button';
    hide.className = 'onboarding-hide';
    hide.textContent = 'ซ่อน';
    hide.addEventListener('click', function () {
      storageHide();
      mount.hidden = true;
    });
    head.appendChild(hide);
    card.appendChild(head);

    var progress = document.createElement('p');
    progress.className = 'onboarding-progress';
    progress.textContent = 'เสร็จแล้ว ' + doneCount + ' จาก ' + STEPS.length + ' ขั้น';
    card.appendChild(progress);

    var list = document.createElement('ul');
    list.className = 'onboarding-steps';
    STEPS.forEach(function (step) {
      list.appendChild(stepRow(step, !!steps[step.key]));
    });
    card.appendChild(list);

    mount.textContent = '';
    mount.appendChild(card);
    mount.hidden = false;
  }

  fetch('/api/onboarding', { headers: { accept: 'application/json' } })
    .then(function (response) {
      return response.ok ? response.json() : null;
    })
    .then(function (data) {
      if (data && !storageHidden()) render(data);
    })
    .catch(function () {
      /* endpoint unavailable — the dashboard works without the card */
    });
})();
