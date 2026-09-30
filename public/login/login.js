// Login page — OTP by phone and Google, per the Phase 1 auth contract
// (docs/phase1-tasks.md). With ?mock=1 every /api/auth/* call is stubbed
// locally so the flow can be tried before the auth backend lands.
(function () {
  var auth = window.NakaAuth;

  var params = new URLSearchParams(location.search);
  var nextTarget = auth.safeNext(params.get("next"), "/app/");
  var phoneValue = "";
  var resendTimer = null;
  var resendEndTime = 0;

  var errorEl = document.getElementById("form-error");
  var mockNote = document.getElementById("mock-note");
  var lineButton = document.getElementById("line-button");
  var googleButton = document.getElementById("google-button");
  var stepPhone = document.getElementById("step-phone");
  var stepCode = document.getElementById("step-code");
  var phoneInput = document.getElementById("phone");
  var phoneEcho = document.getElementById("phone-echo");
  var codeInput = document.getElementById("code");
  var requestButton = document.getElementById("request-button");
  var verifyButton = document.getElementById("verify-button");
  var resendButton = document.getElementById("resend-button");
  var resendNote = document.getElementById("resend-note");

  // Bot check before an SMS is sent (docs/auth-integration-status.md). Each token is
  // single-use, so the widget is reset after every request, successful or not.
  var bot = { siteKey: null, token: null, widgetId: null };
  function updateRequestButtons() {
    var blocked = !!bot.siteKey && !bot.token;
    if (requestButton.textContent === "ขอรหัส OTP") requestButton.disabled = blocked;
  }
  function resetBotCheck() {
    bot.token = null;
    if (bot.widgetId !== null && window.turnstile) window.turnstile.reset(bot.widgetId);
    updateRequestButtons();
  }
  function setupBotCheck() {
    if (auth.mockMode()) return;
    fetch("/api/auth/config", { credentials: "same-origin" })
      .then(function (res) { return res.ok ? res.json() : {}; })
      .then(function (config) {
        lineButton.hidden = !config || config.lineLogin !== true;
        if (!config || !config.turnstileSiteKey) return;
        bot.siteKey = config.turnstileSiteKey;
        updateRequestButtons();
        var box = document.getElementById("turnstile-box");
        box.hidden = false;
        var script = document.createElement("script");
        script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
        script.async = true;
        script.onload = function () {
          bot.widgetId = window.turnstile.render(box, {
            sitekey: bot.siteKey,
            action: "otp_request",
            language: "th",
            callback: function (token) { bot.token = token; updateRequestButtons(); },
            "expired-callback": function () { bot.token = null; updateRequestButtons(); },
            "error-callback": function () { bot.token = null; updateRequestButtons(); },
          });
        };
        script.onerror = function () { showError("โหลดระบบยืนยันว่าไม่ใช่บอทไม่สำเร็จ ลองรีเฟรชหน้านี้"); };
        document.head.appendChild(script);
      })
      .catch(function () { /* config unavailable: the server still decides whether a token is required */ });
  }

  function showError(message) {
    errorEl.textContent = message;
  }
  function clearError() {
    errorEl.textContent = "";
  }
  function setBusy(button, busy, label) {
    button.disabled = busy;
    if (label) button.textContent = label;
  }

  function normalizePhone(raw) {
    return String(raw || "").replace(/[\s\-()]/g, "");
  }
  function validPhone(phone) {
    return /^0\d{8,9}$/.test(phone) || /^\+66\d{8,9}$/.test(phone);
  }

  // The resend countdown runs from the real end time (now + retryAfter), so
  // the remaining seconds never drift when the tab is throttled in the
  // background. It always reflects the retryAfter the API returns — never a
  // made-up urgency timer.
  function startResendCountdown(seconds) {
    clearInterval(resendTimer);
    resendEndTime = Date.now() + Math.max(0, Number(seconds) || 0) * 1000;
    tickResend();
    if (resendEndTime > Date.now()) resendTimer = setInterval(tickResend, 1000);
  }
  function tickResend() {
    var remaining = Math.ceil((resendEndTime - Date.now()) / 1000);
    if (remaining > 0) {
      resendButton.disabled = true;
      resendNote.textContent = "ได้ในอีก " + remaining + " วินาที";
    } else {
      clearInterval(resendTimer);
      resendTimer = null;
      resendButton.disabled = false;
      resendNote.textContent = "";
    }
  }

  function showCodeStep() {
    stepPhone.hidden = true;
    stepCode.hidden = false;
    phoneEcho.textContent = phoneValue;
    codeInput.value = "";
    codeInput.focus();
  }

  async function requestOtp() {
    clearError();
    phoneValue = normalizePhone(phoneInput.value);
    if (!validPhone(phoneValue)) {
      showError("เบอร์โทรไม่ถูกต้อง ลองตรวจอีกครั้ง เช่น 0812345678");
      phoneInput.focus();
      return;
    }
    if (bot.siteKey && !bot.token) {
      showError("กรุณายืนยันว่าไม่ใช่บอทก่อนขอรหัส");
      return;
    }
    setBusy(requestButton, true, "กำลังส่งรหัส…");
    if (!stepPhone.hidden) setBusy(resendButton, true, "กำลังส่งรหัส…");
    try {
      var payload = { phone: phoneValue };
      if (bot.token) payload.turnstileToken = bot.token;
      var res = await fetch("/api/auth/otp/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        var data = await res.json().catch(function () { return {}; });
        showCodeStep();
        startResendCountdown(data.retryAfter || 60);
        return;
      }
      var body = await res.json().catch(function () { return null; });
      if (res.status === 429) {
        startResendCountdown((body && body.retryAfter) || 60);
        showError((body && body.error) || "ขอรหัสบ่อยเกินไป รอสักครู่แล้วลองใหม่ได้เลย");
        return;
      }
      if (res.status === 400) {
        // 400 covers both a bad number and a failed bot check; the API says which.
        showError((body && body.error) || "เบอร์โทรไม่ถูกต้อง ลองตรวจอีกครั้ง เช่น 0812345678");
        return;
      }
      // 502/503 and other server errors carry a Thai message — show it.
      showError((body && body.error) || "ขอรหัสไม่สำเร็จ ลองอีกครั้งในภายหลัง");
    } catch (err) {
      showError("ขอรหัสไม่สำเร็จ ลองอีกครั้งในภายหลัง");
    } finally {
      setBusy(requestButton, false, "ขอรหัส OTP");
      if (!stepPhone.hidden) setBusy(resendButton, false, "ขอรหัสใหม่");
      resetBotCheck();
    }
  }

  async function verifyOtp() {
    clearError();
    var code = codeInput.value.replace(/\D/g, "");
    if (code.length !== 6) {
      showError("กรอกรหัสตัวเลข 6 หลักให้ครบก่อนนะคะ");
      codeInput.focus();
      return;
    }
    setBusy(verifyButton, true, "กำลังตรวจรหัส…");
    try {
      var res = await fetch("/api/auth/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: phoneValue, code: code }),
      });
      if (res.ok) {
        var data = await res.json().catch(function () { return {}; });
        if (data.user) {
          // Real login: the session lives in the HttpOnly cookie the server
          // just set. Only the mock flow writes the local mock session.
          if (auth.mockMode()) auth.signIn(data.user, { provider: "phone" });
          location.assign(nextTarget);
        }
        return;
      }
      var body = await res.json().catch(function () { return null; });
      if (res.status === 429) {
        showError((body && body.error) || "ลองกรอกรหัสผิดหลายครั้งเกินไป รอสักครู่แล้วลองใหม่อีกครั้ง");
        return;
      }
      if (res.status === 400) {
        showError((body && body.error) || "รหัสไม่ถูกต้องหรือหมดอายุแล้ว ลองตรวจอีกครั้ง");
        codeInput.select();
        return;
      }
      // 502/503 and other server errors carry a Thai message — show it.
      showError((body && body.error) || "ยืนยันรหัสไม่สำเร็จ ลองอีกครั้งในภายหลัง");
    } catch (err) {
      showError("ยืนยันรหัสไม่สำเร็จ ลองอีกครั้งในภายหลัง");
    } finally {
      setBusy(verifyButton, false, "ยืนยันและเข้าสู่ระบบ");
    }
  }

  document.getElementById("otp-form").addEventListener("submit", function (event) {
    event.preventDefault();
    if (stepPhone.hidden) verifyOtp();
    else requestOtp();
  });
  document.getElementById("change-phone").addEventListener("click", function () {
    clearError();
    clearInterval(resendTimer);
    resendEndTime = 0;
    resendButton.disabled = false;
    resendNote.textContent = "";
    stepCode.hidden = true;
    stepPhone.hidden = false;
    phoneInput.focus();
  });
  resendButton.addEventListener("click", requestOtp);
  codeInput.addEventListener("input", function () {
    codeInput.value = codeInput.value.replace(/\D/g, "").slice(0, 6);
  });

  // Google: real flow navigates to /api/auth/google/start; mock signs in locally.
  googleButton.addEventListener("click", function (event) {
    if (!auth.mockMode()) return;
    event.preventDefault();
    auth.signIn(auth.MOCK_GOOGLE_USER, { provider: "google" });
    location.assign(nextTarget);
  });

  // Boot: mock setup, provider error message, then skip the page if already signed in.
  if (auth.mockMode()) {
    auth.installMockFetch();
    mockNote.hidden = false;
  }
  if (params.get("error") === "google") {
    showError("เข้าสู่ระบบด้วย Google ไม่สำเร็จ ลองอีกครั้งหรือใช้เบอร์โทรแทนได้เลย");
  } else if (params.get("error") === "line") {
    showError("เข้าสู่ระบบด้วย LINE ไม่สำเร็จ ลองอีกครั้งหรือใช้ Google หรือเบอร์โทรแทนได้เลย");
  }
  setupBotCheck();
  auth.me().then(function (state) {
    if (state.status === "signed-in") location.replace(nextTarget);
  });
})();
