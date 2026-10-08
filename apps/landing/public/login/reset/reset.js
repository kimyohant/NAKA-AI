// Phase 9B — /login/reset/ (docs/phase9-password-reset.md, 9A contract).
// Reads the reset token from the URL fragment (#token=…) — fragments never
// reach the server or logs — and strips it from the address bar immediately.
// Sends POST /api/auth/password/reset { token, newPassword, turnstileToken? }.
// Success answers { ok: true } with NO session cookie: the user then signs in
// with the new password from /login/.
(function () {
  var token = new URLSearchParams((location.hash || "").replace(/^#/, "")).get("token") || "";
  // The token must not linger in the address bar, history or referrers.
  if (location.hash) history.replaceState(null, "", location.pathname + location.search);

  var statusEl = document.getElementById("reset-status");
  var okEl = document.getElementById("reset-ok");
  var form = document.getElementById("reset-form");
  var newEl = document.getElementById("new-password");
  var confirmEl = document.getElementById("confirm-password");
  var button = document.getElementById("reset-button");
  var noToken = document.getElementById("no-token");
  var box = document.getElementById("turnstile-box");

  // Same Turnstile contract as the login page (src/auth/password.ts botCheck):
  // the widget is rendered only when the site key is configured; each token is
  // single-use so the widget resets after every attempt, successful or not.
  var bot = { siteKey: null, token: null, widgetId: null };
  function resetBotCheck() {
    bot.token = null;
    if (bot.widgetId !== null && window.turnstile) window.turnstile.reset(bot.widgetId);
  }
  function setupBotCheck() {
    fetch("/api/auth/config", { credentials: "same-origin" })
      .then(function (res) { return res.ok ? res.json() : {}; })
      .then(function (config) {
        if (!config || !config.turnstileSiteKey) return;
        bot.siteKey = config.turnstileSiteKey;
        box.hidden = false;
        var script = document.createElement("script");
        script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
        script.async = true;
        script.onload = function () {
          bot.widgetId = window.turnstile.render(box, {
            sitekey: bot.siteKey,
            action: "otp_request",
            language: "th",
            callback: function (t) { bot.token = t; },
            "expired-callback": function () { bot.token = null; },
            "error-callback": function () { bot.token = null; },
          });
        };
        script.onerror = function () { setStatus("โหลดระบบยืนยันว่าไม่ใช่บอทไม่สำเร็จ ลองรีเฟรชหน้านี้"); };
        document.head.appendChild(script);
      })
      .catch(function () { /* config unavailable: the server still decides */ });
  }

  function setStatus(message) {
    statusEl.textContent = message || "";
  }

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    setStatus("");
    var newPassword = newEl.value;
    if (newPassword.length < 8) {
      setStatus("รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร");
      newEl.focus();
      return;
    }
    if (newPassword !== confirmEl.value) {
      setStatus("รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน");
      confirmEl.focus();
      return;
    }
    if (bot.siteKey && !bot.token) {
      setStatus("กรุณายืนยันว่าไม่ใช่บอตก่อน");
      return;
    }
    button.disabled = true;
    try {
      var payload = { token: token, newPassword: newPassword };
      if (bot.token) payload.turnstileToken = bot.token;
      var response = await fetch("/api/auth/password/reset", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      var data = await response.json().catch(function () { return null; });
      if (response.ok && data && data.ok) {
        form.hidden = true;
        okEl.hidden = false;
        setStatus("");
        return;
      }
      if (response.status === 429) {
        setStatus((data && data.error) || "ลองผิดหลายครั้งเกินไป รอสักครู่แล้วลองใหม่อีกครั้ง");
        resetBotCheck();
        return;
      }
      // 400 covers a bad/expired/used link and a password that breaks the rules.
      setStatus((data && data.error) || "ลิงก์หมดอายุหรือถูกใช้ไปแล้ว กรุณาขอลิงก์ใหม่");
      newEl.value = "";
      confirmEl.value = "";
      resetBotCheck();
    } catch (err) {
      setStatus("ตั้งรหัสผ่านไม่สำเร็จ ลองอีกครั้งในภายหลัง");
      resetBotCheck();
    } finally {
      button.disabled = false;
    }
  });

  // Boot: with a token → show the form (and the bot check when configured);
  // without one → point the user back to /login/ to request a fresh link.
  if (!token) {
    noToken.hidden = false;
    return;
  }
  form.hidden = false;
  setupBotCheck();
})();
