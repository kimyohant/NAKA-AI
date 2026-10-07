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

  if (new URLSearchParams(location.search).has("mock")) auth.installMockFetch();

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
