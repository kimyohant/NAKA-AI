// Account menu + lightweight auth helpers, shared by every page.
// Contract: docs/phase1-tasks.md (Phase 1 auth — Agent B).
//
// Pages opt in with one markup element (Claude adds this when wiring pages):
//   <div data-account-menu></div>
// The script injects its own stylesheet, resolves the signed-in state from
// GET /api/auth/me, and renders either a "เข้าสู่ระบบ" pill or the user menu.
//
// Mock mode (?mock=1) stubs the /api/auth/* endpoints so the UI can be tried
// before the auth backend lands. Mock data is used ONLY in mock mode — a real
// 401, server error, or network failure is never replaced with mock data, and
// me() reports the difference:
//   { status: "signed-in", user, credits, source: "server" | "local-mock" }
//   { status: "signed-out" }    — the API answered 401 (or mock without session)
//   { status: "unavailable" }   — network failure / 5xx / malformed response
(function () {
  var SESSION_KEY = "naka.mock-session";
  var MOCK_CREDITS = 120;

  var MOCK_GOOGLE_USER = { id: "mock-user", displayName: "ผู้ใช้ทดลอง", phone: null, email: "trial@naka-ai.com" };

  function mockMode() {
    if (typeof location === "undefined") return false;
    return new URLSearchParams(location.search).has("mock");
  }

  function readSession() {
    try {
      var raw = localStorage.getItem(SESSION_KEY);
      var parsed = raw ? JSON.parse(raw) : null;
      return parsed && parsed.user ? parsed : null;
    } catch (err) {
      return null;
    }
  }

  function writeSession(session) {
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } catch (err) {
      /* storage unavailable — mock session just won't persist */
    }
  }

  // Only in-site paths are accepted as ?next= targets: must start with "/",
  // must not be protocol-relative ("//host"), and must not carry control
  // characters (e.g. "/\t/evil.test").
  function safeNext(raw, fallback) {
    if (typeof raw !== "string" || raw.charAt(0) !== "/") return fallback;
    if (raw.charAt(1) === "/" || raw.indexOf("\\") !== -1) return fallback;
    if (/[\u0000-\u001f\u007f]/.test(raw)) return fallback;
    return raw;
  }

  function signIn(user, extra) {
    var options = extra || {};
    writeSession({
      user: user,
      credits: typeof options.credits === "number" ? options.credits : MOCK_CREDITS,
      provider: options.provider || "mock",
      signedInAt: Date.now(),
    });
  }

  // The server must confirm the logout (contract: 204). Only a confirmed
  // logout clears the mock store; callers decide what to tell the user.
  async function signOut() {
    var confirmed = false;
    try {
      var res = await fetch("/api/auth/logout", { method: "POST" });
      confirmed = res.ok;
    } catch (err) {
      confirmed = false;
    }
    if (confirmed) {
      try {
        localStorage.removeItem(SESSION_KEY);
      } catch (err) {
        /* ignore */
      }
    }
    return { confirmed: confirmed };
  }

  function mockUserFromPhone(phone) {
    var digits = String(phone || "").replace(/\D/g, "");
    return {
      id: "mock-user",
      displayName: "ผู้ใช้ทดลอง",
      phone: digits ? "+66" + digits.replace(/^0/, "") : null,
      email: null,
    };
  }

  function localSession() {
    var session = readSession();
    return session
      ? { status: "signed-in", user: session.user, credits: session.credits, source: "local-mock" }
      : { status: "signed-out" };
  }

  // Mock mode reads only the local mock session. Real mode trusts the API:
  // 401 means signed out (never swapped for mock data), anything else that
  // is not a valid session means the API is unavailable.
  async function me() {
    if (mockMode()) return localSession();
    var res;
    try {
      res = await fetch("/api/auth/me", { headers: { accept: "application/json" } });
    } catch (err) {
      return { status: "unavailable" };
    }
    if (res.status === 401) return { status: "signed-out" };
    if (res.ok) {
      var data = await res.json().catch(function () { return null; });
      if (data && data.user) {
        return {
          status: "signed-in",
          user: data.user,
          credits: typeof data.credits === "number" ? data.credits : 0,
          source: "server",
        };
      }
    }
    return { status: "unavailable" };
  }

  // ---- fetch stub for ?mock=1 (Agent B brief: mock ด้วย fetch stub) ----
  function installMockFetch() {
    if (typeof window === "undefined" || window.__nakaMockFetch) return;
    window.__nakaMockFetch = true;
    var original = window.fetch.bind(window);
    window.fetch = function (input, init) {
      var url = typeof input === "string" ? input : (input && input.url) || "";
      var method = String((init && init.method) || (input && input.method) || "GET").toUpperCase();
      var isAuth = url.indexOf("/api/auth/") !== -1;
      if (!isAuth) return original(input, init);

      function reply(body, status) {
        return Promise.resolve(
          new Response(JSON.stringify(body), { status: status, headers: { "Content-Type": "application/json; charset=utf-8" } }),
        );
      }
      if (method === "GET" && url.indexOf("/api/auth/me") !== -1) {
        var session = readSession();
        return session ? reply({ user: session.user, credits: session.credits }, 200) : reply({ error: "unauthorized" }, 401);
      }
      if (method === "POST" && url.indexOf("/api/auth/otp/request") !== -1) {
        return reply({ ok: true, retryAfter: 60 }, 200);
      }
      if (method === "POST" && url.indexOf("/api/auth/otp/verify") !== -1) {
        var payload = {};
        try {
          payload = JSON.parse((init && init.body) || "{}");
        } catch (err) {
          /* treat as bad code */
        }
        if (/^\d{6}$/.test(String(payload.code || ""))) return reply({ user: mockUserFromPhone(payload.phone) }, 200);
        return reply({ error: "bad code" }, 400);
      }
      if (method === "POST" && url.indexOf("/api/auth/logout") !== -1) {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return reply({ error: "not found" }, 404);
    };
  }

  // ---- rendering ----
  function injectStylesheet() {
    if (document.querySelector('link[rel="stylesheet"][href="/account-menu.css"]')) return;
    var link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/account-menu.css";
    document.head.appendChild(link);
  }

  function loginTarget() {
    var next = typeof location !== "undefined" ? location.pathname + location.search : "/";
    return "/login/?next=" + encodeURIComponent(next);
  }

  function renderLogin(container) {
    var link = document.createElement("a");
    link.className = "acct-login";
    link.href = loginTarget();
    link.textContent = "เข้าสู่ระบบ";
    container.appendChild(link);
  }

  function menuRow(className, text) {
    var span = document.createElement("span");
    span.className = className;
    span.textContent = text;
    return span;
  }

  function menuItem(label, onClick) {
    var item = document.createElement("button");
    item.type = "button";
    item.className = "acct-item";
    item.setAttribute("role", "menuitem");
    item.textContent = label;
    item.addEventListener("click", onClick);
    return item;
  }

  function renderUser(container, state) {
    var user = state.user;
    var contact = user.email || user.phone || "";

    var trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "acct-trigger";
    trigger.setAttribute("aria-haspopup", "menu");
    trigger.setAttribute("aria-expanded", "false");

    var avatar = document.createElement("span");
    avatar.className = "acct-avatar";
    avatar.setAttribute("aria-hidden", "true");
    avatar.textContent = (user.displayName || "?").trim().charAt(0).toUpperCase();
    trigger.appendChild(avatar);

    var name = document.createElement("span");
    name.className = "acct-name";
    name.textContent = user.displayName || "บัญชีของฉัน";
    trigger.appendChild(name);

    var chevron = document.createElement("span");
    chevron.className = "acct-chevron";
    chevron.setAttribute("aria-hidden", "true");
    chevron.textContent = "▾";
    trigger.appendChild(chevron);

    var menu = document.createElement("div");
    menu.className = "acct-menu";
    menu.setAttribute("role", "menu");
    menu.hidden = true;
    menu.appendChild(menuRow("acct-menu-name", user.displayName || "บัญชีของฉัน"));
    if (contact) menu.appendChild(menuRow("acct-menu-contact", contact));
    menu.appendChild(menuRow("acct-menu-credits", "เครดิตคงเหลือ " + state.credits));
    var signOutError = menuRow("acct-menu-error", "");
    signOutError.setAttribute("role", "status");
    signOutError.hidden = true;
    menu.appendChild(signOutError);

    var dashboard = document.createElement("a");
    dashboard.className = "acct-item";
    dashboard.href = "/app/";
    dashboard.setAttribute("role", "menuitem");
    dashboard.textContent = "แดชบอร์ดของฉัน";
    menu.appendChild(dashboard);

    var account = document.createElement("a");
    account.className = "acct-item";
    account.href = "/app/account/";
    account.setAttribute("role", "menuitem");
    account.textContent = "บัญชีของฉัน";
    menu.appendChild(account);

    menu.appendChild(
      menuItem("ออกจากระบบ", async function () {
        var result = await signOut();
        if (!result.confirmed) {
          // The server did not confirm — stay signed in on this page.
          signOutError.textContent = "ออกจากระบบไม่สำเร็จ ลองอีกครั้ง";
          signOutError.hidden = false;
          return;
        }
        closeMenus();
        if (typeof location !== "undefined" && location.pathname.indexOf("/app/") === 0) {
          location.assign("/");
          return;
        }
        renderAll(await me());
      }),
    );

    function toggle(force) {
      var open = typeof force === "boolean" ? force : menu.hidden;
      menu.hidden = !open;
      trigger.setAttribute("aria-expanded", String(open));
      if (!open) {
        signOutError.hidden = true;
        signOutError.textContent = "";
      }
    }
    trigger.addEventListener("click", function () {
      toggle();
      if (!menu.hidden) {
        var first = menu.querySelector(".acct-item");
        if (first) first.focus();
      }
    });
    trigger.addEventListener("keydown", function (event) {
      if (event.key === "ArrowDown" && menu.hidden) {
        event.preventDefault();
        toggle(true);
        var first = menu.querySelector(".acct-item");
        if (first) first.focus();
      }
    });
    menu.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        toggle(false);
        trigger.focus();
      }
    });

    container.appendChild(trigger);
    container.appendChild(menu);
  }

  function closeMenus() {
    document.querySelectorAll(".acct-menu").forEach(function (menu) {
      menu.hidden = true;
    });
    document.querySelectorAll(".acct-trigger").forEach(function (trigger) {
      trigger.setAttribute("aria-expanded", "false");
    });
  }

  function renderAll(state) {
    var signedIn = !!state && state.status === "signed-in";
    document.querySelectorAll("[data-account-menu]").forEach(function (container) {
      // .acct marks "inside the menu" for the outside-click handler (and positions the dropdown);
      // without it the click that opens the menu also closes it.
      container.classList.add("acct");
      container.textContent = "";
      if (signedIn) renderUser(container, state);
      else renderLogin(container);
    });
    document.body.classList.toggle("acct-signed-in", signedIn);
  }

  async function refresh() {
    renderAll(await me());
    return undefined;
  }

  function boot() {
    injectStylesheet();
    document.addEventListener("click", function (event) {
      if (!event.target.closest(".acct")) closeMenus();
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") closeMenus();
    });
    refresh();
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
    else boot();
  }

  var api = {
    me: me,
    signIn: signIn,
    signOut: signOut,
    refresh: refresh,
    safeNext: safeNext,
    mockMode: mockMode,
    readMockSession: readSession,
    installMockFetch: installMockFetch,
    MOCK_GOOGLE_USER: MOCK_GOOGLE_USER,
    MOCK_CREDITS: MOCK_CREDITS,
  };
  if (typeof window !== "undefined") window.NakaAuth = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
