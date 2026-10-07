// Login page — email + password, Google, LINE and phone OTP; only the configured ones are shown
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
  var forgotArea = document.getElementById("forgot-area");
  var forgotButton = document.getElementById("forgot-button");
  var forgotStatus = document.getElementById("forgot-status");
  var forgotAvailable = false;
  var forgotSent = false;

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
        if (config && config.googleLogin === false) googleButton.hidden = true;
        if (config && config.phoneLogin === false) document.getElementById("otp-form").hidden = true;
        if (config && config.passwordLogin !== true) passwordForm.hidden = true;
        // Phase 9B: the self-service reset link appears only when the email
        // provider is configured (9A answers passwordReset from /api/auth/config).
        if (config && config.passwordReset === true) {
          forgotAvailable = true;
          forgotArea.hidden = pwMode === "register";
          // the email link replaces the "call us" fallback
          document.getElementById("pw-help").hidden = true;
        }
        // "or" separates the provider buttons from the forms; without buttons it has nothing to separate.
        document.getElementById("login-divider").hidden = lineButton.hidden && googleButton.hidden;
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

  // Email + password: one form, two modes. The server decides every rule; this only collects input.
  var passwordForm = document.getElementById("password-form");
  var pwMode = "login";
  var pwSubmit = document.getElementById("pw-submit");
  var pwPassword = document.getElementById("pw-password");
  function setPasswordMode(mode) {
    pwMode = mode;
    var register = mode === "register";
    document.getElementById("pw-tab-login").setAttribute("aria-selected", String(!register));
    document.getElementById("pw-tab-register").setAttribute("aria-selected", String(register));
    document.getElementById("pw-name-field").hidden = !register;
    document.getElementById("pw-help").hidden = register || forgotAvailable;
    document.getElementById("forgot-area").hidden = register || !forgotAvailable;
    pwPassword.setAttribute("autocomplete", register ? "new-password" : "current-password");
    pwPassword.placeholder = register ? "อย่างน้อย 8 ตัวอักษร" : "";
    pwSubmit.textContent = register ? "สมัครสมาชิก" : "เข้าสู่ระบบ";
    clearError();
  }
  document.getElementById("pw-tab-login").addEventListener("click", function () { setPasswordMode("login"); });
  document.getElementById("pw-tab-register").addEventListener("click", function () { setPasswordMode("register"); });
  passwordForm.addEventListener("submit", async function (event) {
    event.preventDefault();
    clearError();
    var email = document.getElementById("pw-email").value.trim();
    var password = pwPassword.value;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showError("กรุณากรอกอีเมลให้ถูกต้อง");
    if (pwMode === "register" && password.length < 8) return showError("รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร");
    if (!password) return showError("กรุณากรอกรหัสผ่าน");
    if (bot.siteKey && !bot.token) return showError("กรุณายืนยันว่าไม่ใช่บอตก่อน");
    if (auth.mockMode()) { auth.signIn(auth.MOCK_GOOGLE_USER, { provider: "password" }); location.assign(nextTarget); return; }
    var label = pwSubmit.textContent;
    setBusy(pwSubmit, true, pwMode === "register" ? "กำลังสมัคร…" : "กำลังเข้าสู่ระบบ…");
    try {
      var body = { email: email, password: password, turnstileToken: bot.token || undefined };
      if (pwMode === "register") body.name = document.getElementById("pw-name").value.trim() || undefined;
      var response = await fetch("/api/auth/password/" + pwMode, {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      var data = await response.json().catch(function () { return {}; });
      if (!response.ok) throw new Error(data.error || "ทำรายการไม่สำเร็จ กรุณาลองใหม่");
      location.assign(nextTarget);
    } catch (error) {
      showError(error.message);
      pwPassword.value = "";
      setBusy(pwSubmit, false, label);
      resetBotCheck();
    }
  });

  // Phase 9B: self-service reset link (docs/phase9-password-reset.md). 9A answers
  // { ok: true } the same way whether or not the email has an account — so the UI
  // shows a neutral message only, never confirms or denies an account existing.
  async function requestResetLink() {
    clearError();
    var email = document.getElementById("pw-email").value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showError("กรอกอีเมลที่ใช้สมัครในช่องด้านบนก่อน แล้วกดรับลิงก์อีกครั้ง");
      document.getElementById("pw-email").focus();
      return;
    }
    if (bot.siteKey && !bot.token) {
      showError("กรุณายืนยันว่าไม่ใช่บอตก่อน");
      return;
    }
    if (auth.mockMode()) { showForgotSent(); return; }
    setBusy(forgotButton, true, "กำลังส่งลิงก์…");
    try {
      var payload = { email: email };
      if (bot.token) payload.turnstileToken = bot.token;
      var res = await fetch("/api/auth/password/forgot", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      var body = await res.json().catch(function () { return null; });
      if (res.ok) { showForgotSent(); resetBotCheck(); return; }
      showError((body && body.error) || "ส่งลิงก์ไม่สำเร็จ ลองอีกครั้งในภายหลัง");
      resetBotCheck();
    } catch (err) {
      showError("ส่งลิงก์ไม่สำเร็จ ลองอีกครั้งในภายหลัง");
      resetBotCheck();
    } finally {
      setBusy(forgotButton, false, "ลืมรหัสผ่าน? รับลิงก์ตั้งรหัสใหม่ทางอีเมล");
    }
  }
  function showForgotSent() {
    clearError();
    forgotSent = true;
    forgotButton.hidden = true;
    forgotStatus.textContent = "ถ้าอีเมลนี้มีบัญชี NAKA-AI เราได้ส่งลิงก์ตั้งรหัสผ่านใหม่ไปแล้ว (ลิงก์ใช้ได้ 30 นาที) ตรวจกล่องจดหมายและโฟลเดอร์สแปมด้วย";
  }
  forgotButton.addEventListener("click", requestResetLink);

  function showError(message) {
    errorEl.textContent = message;
    // the message sits above the tabs; after scrolling down to a submit button it would be off-screen
    // or tucked under the sticky header
    if (!message || typeof errorEl.getBoundingClientRect !== "function" || typeof errorEl.scrollIntoView !== "function") return;
    var header = document.querySelector && document.querySelector("header");
    var top = header && header.getBoundingClientRect ? header.getBoundingClientRect().bottom : 0;
    var box = errorEl.getBoundingClientRect();
    if (box.top < top || box.bottom > window.innerHeight) errorEl.scrollIntoView({ block: "center", behavior: "smooth" });
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
