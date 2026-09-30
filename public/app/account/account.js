// /app/account/ — profile + self-service password change (Phase 8B).
// Calls the Phase 8A contract: POST /api/auth/password/change and the
// hasPassword flag on GET /api/auth/me (docs/phase8-account.md).
// Guards: not signed in → /login/?next=/app/account/; endpoint unreachable →
// error panel with retry; the dashboard never breaks.
// ?mock=1 simulates an email account with a password; ?mock=plain simulates a
// Google account without one — no backend needed (same idea as onboarding.js).
(function () {
  var mockValue = new URLSearchParams(location.search).get('mock');

  var loading = document.getElementById('page-loading');
  var errorPanel = document.getElementById('page-error');
  var page = document.getElementById('page');
  var nameEl = document.getElementById('account-name');
  var contactEl = document.getElementById('account-contact');
  var creditsEl = document.getElementById('account-credits');
  var passwordSection = document.getElementById('password-section');
  var noPassword = document.getElementById('no-password');
  var form = document.getElementById('password-form');
  var currentEl = document.getElementById('current-password');
  var newEl = document.getElementById('new-password');
  var confirmEl = document.getElementById('confirm-password');
  var changeButton = document.getElementById('change-button');
  var statusEl = document.getElementById('password-status');

  // Mock responses for /api/auth/me and /api/auth/password/change only.
  function mockResponse(url, init) {
    var method = String((init && init.method) || 'GET').toUpperCase();
    if (method === 'GET' && url.indexOf('/api/auth/me') !== -1) {
      var payload = mockValue === 'plain'
        ? { user: { id: 'mock-user', displayName: 'ผู้ใช้ทดลอง', phone: null, email: 'trial@naka-ai.com' }, credits: 0, hasPassword: false }
        : { user: { id: 'mock-user', displayName: 'ผู้ใช้ทดลอง', phone: null, email: 'trial@naka-ai.com' }, credits: 3, hasPassword: true };
      return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
    }
    if (method === 'POST' && url.indexOf('/api/auth/password/change') !== -1) {
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
    }
    return null;
  }

  async function callApi(url, init) {
    if (mockValue !== null) {
      var mocked = mockResponse(url, init);
      if (mocked) return mocked;
    }
    return fetch(url, init);
  }

  async function me() {
    if (mockValue !== null) {
      return {
        status: 'signed-in',
        user: { displayName: 'ผู้ใช้ทดลอง', email: 'trial@naka-ai.com', phone: null },
        credits: mockValue === 'plain' ? 0 : 3,
        hasPassword: mockValue !== 'plain',
      };
    }
    var response;
    try {
      response = await fetch('/api/auth/me', { headers: { accept: 'application/json' } });
    } catch (err) {
      return { status: 'unavailable' };
    }
    if (response.status === 401) return { status: 'signed-out' };
    if (response.ok) {
      var data = await response.json().catch(function () { return null; });
      if (data && data.user) {
        return {
          status: 'signed-in',
          user: data.user,
          credits: typeof data.credits === 'number' ? data.credits : 0,
          hasPassword: data.hasPassword === true,
        };
      }
    }
    return { status: 'unavailable' };
  }

  function setStatus(message) {
    statusEl.textContent = message || '';
  }

  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    setStatus('');
    var currentPassword = currentEl.value;
    var newPassword = newEl.value;
    if (!currentPassword || !newPassword || !confirmEl.value) {
      setStatus('กรอกรหัสผ่านให้ครบทุกช่อง');
      return;
    }
    if (newPassword !== confirmEl.value) {
      setStatus('รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน');
      confirmEl.focus();
      return;
    }
    if (newPassword.length < 8) {
      setStatus('รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัวอักษร');
      newEl.focus();
      return;
    }
    changeButton.disabled = true;
    try {
      var response = await callApi('/api/auth/password/change', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: currentPassword, newPassword: newPassword }),
      });
      var data = await response.json().catch(function () { return null; });
      if (response.ok && data && data.ok) {
        setStatus('เปลี่ยนรหัสผ่านแล้ว อุปกรณ์อื่นออกจากระบบแล้ว');
        currentEl.value = '';
        newEl.value = '';
        confirmEl.value = '';
        return;
      }
      setStatus((data && data.error) || 'เปลี่ยนรหัสผ่านไม่สำเร็จ ลองอีกครั้ง');
    } catch (err) {
      setStatus('เปลี่ยนรหัสผ่านไม่สำเร็จ ลองอีกครั้งในภายหลัง');
    } finally {
      changeButton.disabled = false;
    }
  });

  document.getElementById('retry-button').addEventListener('click', function () {
    location.reload();
  });

  me().then(function (state) {
    loading.hidden = true;
    if (state.status === 'signed-in') {
      var user = state.user;
      nameEl.textContent = user.displayName || '—';
      contactEl.textContent = user.email || user.phone || '—';
      creditsEl.textContent = String(state.credits);
      if (state.hasPassword) {
        passwordSection.hidden = false;
      } else {
        noPassword.hidden = false;
      }
      page.hidden = false;
      return;
    }
    if (state.status === 'signed-out') {
      location.replace('/login/?next=' + encodeURIComponent('/app/account/'));
      return;
    }
    errorPanel.hidden = false;
  });
})();
