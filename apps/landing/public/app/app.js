// /app/ dashboard — guarded by GET /api/auth/me per the Phase 1 contract
// (docs/phase1-tasks.md).
//   signed-in  → render the dashboard
//   signed-out → redirect to /login/?next=/app/
//   unavailable → show a Thai error with a retry button; never bounce the
//   user to login because of a transient server or network failure.
// With ?mock=1 the page runs on stubbed data and says so in the mode note —
// never presented as real data. Mock data is ignored outside mock mode.
(function () {
  var auth = window.NakaAuth;

  var mockMode = new URLSearchParams(location.search).has("mock");
  if (mockMode) auth.installMockFetch();

  var loading = document.getElementById("app-loading");
  var content = document.getElementById("app-content");
  var errorPanel = document.getElementById("app-error");
  var modeText = document.getElementById("mode-text");
  var greetingName = document.getElementById("greeting-name");
  var creditsValue = document.getElementById("credits-value");
  var signoutButton = document.getElementById("signout-button");
  var signoutStatus = document.getElementById("signout-status");

  // Back from naka-studio's sign-in without access (/api/sso/studio/authorize → /app/?studio=…)
  var studioNotice = document.getElementById("studio-notice");
  var studioReason = new URLSearchParams(location.search).get("studio");
  var STUDIO_NOTES = {
    denied: "บัญชีนี้ยังไม่ได้รับสิทธิ์เข้า Naka Studio ติดต่อทีมงานหากต้องการใช้งาน",
    off: "Naka Studio ยังไม่เปิดให้ใช้งานในตอนนี้",
  };

  auth.me().then(function (state) {
    loading.hidden = true;
    if (state.status === "signed-in") {
      if (studioNotice && STUDIO_NOTES[studioReason]) {
        studioNotice.textContent = STUDIO_NOTES[studioReason];
        studioNotice.hidden = false;
      }
      var user = state.user;
      var firstName = String(user.displayName || "").split(" ")[0] || "ผู้ใช้";
      greetingName.textContent = ", " + firstName;
      creditsValue.textContent = String(state.credits);
      renderQuotas(state.features);
      loadCredits(null);
      if (state.source === "server") {
        modeText.textContent = "เชื่อมต่อระบบแล้ว · ข้อมูลจากเซิร์ฟเวอร์";
      } else {
        modeText.textContent = "โหมดทดลอง · ข้อมูลตัวอย่างบนเครื่องนี้ (ยังไม่ได้เชื่อมระบบจริง)";
      }
      content.hidden = false;
      return;
    }
    if (state.status === "signed-out") {
      location.replace("/login/?next=" + encodeURIComponent("/app/"));
      return;
    }
    if (state.status === "unavailable") {
      // API unavailable — stay on the page and offer a retry.
      errorPanel.hidden = false;
    }
  });

  // Monthly quotas of the features this member's plan includes (docs/entitlements.md)
  function renderQuotas(features) {
    var panel = document.getElementById("quota-panel");
    var list = document.getElementById("quota-list");
    var rows = (features || []).filter(function (f) { return f.enabled && f.quotaUnit && f.app === "landing"; });
    list.textContent = "";
    rows.forEach(function (f) {
      var item = document.createElement("li");
      var name = document.createElement("span");
      name.textContent = f.label;
      var value = document.createElement("strong");
      value.textContent = f.monthlyLimit == null
        ? "ใช้แล้ว " + f.used + " " + f.quotaUnit + " · ไม่จำกัด"
        : f.used + " / " + f.monthlyLimit + " " + f.quotaUnit;
      if (f.monthlyLimit != null && f.used >= f.monthlyLimit) item.className = "quota-full";
      item.append(name, value);
      list.appendChild(item);
    });
    panel.hidden = !rows.length;
  }

  // ---- package + credit history (GET /api/me/credits, src/me/credits.ts) ----
  var DAY = 86400;
  var historyStatus = document.getElementById("history-status");
  var historyList = document.getElementById("history-list");
  var historyMore = document.getElementById("history-more");
  var historyNext = null;
  var historyRetry = null;

  // ?mock=1 only: sample rows so the layout can be reviewed; the mode note says it is sample data.
  function mockCredits() {
    var t = Math.floor(Date.now() / 1000);
    return {
      balance: 72,
      plan: { name: "โปร", period: "monthly", expiresAt: t + 5 * DAY, nextCreditAt: null },
      entries: [
        { id: 3, delta: -8, kind: "studio", title: "ใช้งานใน Naka Studio", createdAt: "2026-10-09 07:15:00" },
        { id: 2, delta: 70, kind: "package", title: "เติมเครดิตจากการซื้อแพ็กเกจ", createdAt: "2026-10-01 03:00:00" },
        { id: 1, delta: 10, kind: "welcome", title: "เครดิตต้อนรับสมาชิกใหม่", createdAt: "2026-09-28 12:40:00" },
      ],
      next: null,
    };
  }

  // unix seconds (packages) or "YYYY-MM-DD HH:MM:SS" in UTC (ledger), shown in Bangkok time
  function toDate(value) {
    var d = typeof value === "number" ? new Date(value * 1000) : new Date(String(value).replace(" ", "T") + "Z");
    return isNaN(d.getTime()) ? null : d;
  }
  function thaiDate(value, withTime) {
    var d = toDate(value);
    if (!d) return "";
    var options = { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Bangkok" };
    if (withTime) { options.hour = "2-digit"; options.minute = "2-digit"; }
    return d.toLocaleString("th-TH", options);
  }

  function renderPlan(plan) {
    var panel = document.getElementById("plan-panel");
    var warn = document.getElementById("plan-warn");
    var dates = [];
    warn.hidden = true;
    if (!plan) {
      document.getElementById("plan-name").textContent = "ยังไม่มีแพ็กเกจ";
      document.getElementById("plan-period").textContent = "";
      dates.push("ซื้อแพ็กเกจเพื่อรับเครดิตทุกเดือน");
    } else {
      document.getElementById("plan-name").textContent = "แพ็กเกจ" + plan.name;
      document.getElementById("plan-period").textContent = plan.period === "yearly" ? "รายปี" : plan.period === "monthly" ? "รายเดือน" : "";
      dates.push(plan.expiresAt ? "ใช้ได้ถึง " + thaiDate(plan.expiresAt) : "ไม่มีวันหมดอายุ");
      if (plan.nextCreditAt) dates.push("เครดิตรอบถัดไป " + thaiDate(plan.nextCreditAt));
      var left = plan.expiresAt ? (plan.expiresAt - Date.now() / 1000) / DAY : Infinity;
      if (left <= 7) {
        warn.textContent = (left < 1 ? "แพ็กเกจจะหมดอายุภายใน 1 วัน" : "แพ็กเกจจะหมดอายุในอีก " + Math.ceil(left) + " วัน") +
          " หลังหมดอายุจะไม่ได้รับเครดิตประจำเดือน ต่ออายุได้ที่หน้าแพ็กเกจ";
        warn.hidden = false;
      }
    }
    document.getElementById("plan-dates").textContent = dates.join(" · ");
    panel.hidden = false;
  }

  function renderEntries(entries) {
    entries.forEach(function (entry) {
      var item = document.createElement("li");
      item.className = "history-item " + (entry.delta < 0 ? "is-out" : "is-in");
      var main = document.createElement("span");
      main.className = "history-main";
      var title = document.createElement("strong");
      title.textContent = entry.title;
      var when = document.createElement("small");
      when.textContent = thaiDate(entry.createdAt, true);
      main.append(title, when);
      var delta = document.createElement("span");
      delta.className = "history-delta";
      // U+2212 minus: the same width as "+", so the column lines up
      delta.textContent = (entry.delta < 0 ? "\u2212" : "+") + Math.abs(entry.delta).toLocaleString("th-TH");
      item.append(main, delta);
      historyList.appendChild(item);
    });
  }

  async function fetchCredits(before) {
    if (mockMode) return mockCredits();
    var res = await fetch("/api/me/credits?limit=10" + (before ? "&before=" + encodeURIComponent(before) : ""), { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error("credits " + res.status);
    return res.json();
  }

  async function loadCredits(before) {
    historyMore.disabled = true;
    try {
      var data = await fetchCredits(before);
      if (!before) {
        if (typeof data.balance === "number") creditsValue.textContent = String(data.balance);
        renderPlan(data.plan);
      }
      renderEntries(data.entries || []);
      historyNext = data.next || null;
      historyRetry = null;
      historyList.hidden = !historyList.children.length;
      historyStatus.textContent = historyList.children.length ? "" : "ยังไม่มีรายการเครดิต เครดิตที่ได้รับและใช้ไปจะแสดงที่นี่";
      historyStatus.hidden = !!historyList.children.length;
      historyMore.textContent = "ดูรายการก่อนหน้า";
      historyMore.hidden = !historyNext;
    } catch (err) {
      // The rest of the dashboard stays usable; only this section offers a retry.
      historyRetry = before;
      historyStatus.textContent = "โหลดประวัติเครดิตไม่สำเร็จ ลองอีกครั้งได้";
      historyStatus.hidden = false;
      historyMore.textContent = "ลองอีกครั้ง";
      historyMore.hidden = false;
    }
    historyMore.disabled = false;
  }

  historyMore.addEventListener("click", function () {
    loadCredits(historyRetry !== null ? historyRetry : historyNext);
  });

  signoutButton.addEventListener("click", async function () {
    signoutStatus.textContent = "";
    signoutButton.disabled = true;
    var result = await auth.signOut();
    signoutButton.disabled = false;
    if (result.confirmed) {
      location.assign("/");
      return;
    }
    // The server did not confirm — keep the user on the dashboard.
    signoutStatus.textContent = "ออกจากระบบไม่สำเร็จ ลองอีกครั้ง";
  });

  document.getElementById("retry-button").addEventListener("click", function () {
    location.reload();
  });
})();
