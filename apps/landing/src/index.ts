import { AFFILIATE_JOB_KIND, handleAffiliateApi, makeAffiliateHandler } from "./affiliate";
import { runSalesAgent } from "./agent";
import { handleBilling, handlePublicPlans, handleStripeWebhook, runBillingCron } from "./billing";
import { backfillReceipts, handleReceipts } from "./receipts";
import { handleOnboarding } from "./onboarding";
import { checkAdmin } from "./admin/auth";
import { handleAdminCustomers } from "./admin/customers";
import { handleWorks } from "./works";
import { handleMemberCredits } from "./me/credits";
import { handleMemberWorks } from "./me/works";
import { handleAuth, requireUser } from "./auth";
import { handleStudioSso } from "./auth/studio";
import { handleStudioLinks } from "./studio-links";
import { readBodyBytes } from "./auth/common";
import { getBalance, getPlan, grantCredits, ledgerFor } from "./credits";
import { getConversation, saveConversation } from "./db";
import { drainInbox, handleInbox, handleMetaWebhook, INBOX_JOB_KIND, makeInboxHandler } from "./inbox";
import { runQueue, errorSummary, type JobHandler } from "./jobs";
import { getDisplayName, pushText, replyOrPush, startLoading, verifySignature } from "./line";
import { handleSocial, publishDuePosts } from "./social";
import { handleStudio } from "./studio";
import { handleMarketer, makeMarketerHandlers, refreshTrendingCovers, syncTrendingApi } from "./marketer";
import { handleAdminMarketer } from "./marketer/admin";
import { AI_VIDEO_JOB_KIND, makeAiVideoHandler } from "./video";
import { handleAdminSystem } from "./system/admin";
import { handleAdminStudioSystem } from "./admin/studio-system";
import { handleAdminInsights } from "./admin/insights";
import { handleAdminAlerts, handleAlertCommand, runAdminAlerts } from "./admin/alerts";
import { handleAdminAudit } from "./admin/audit";
import { featureOn, withSettings } from "./system/store";
import { featureRefusal, hasFeature } from "./entitlements";
import type { Env } from "./types";

interface LineEvent {
  type: string;
  replyToken?: string;
  source: { type: string; userId?: string };
  message?: { type: string; text?: string };
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });

export default {
  async fetch(request, workerEnv, ctx): Promise<Response> {
    const url = new URL(request.url);
    // Settings saved in /admin/system/ override wrangler vars and secrets (src/system).
    const env = await withSettings(workerEnv);

    // www serves the same Worker, but sign-in, cookies and CSRF checks belong to APP_ORIGIN only:
    // send every www request to the main domain instead of failing its logins and logouts.
    const main = (() => { try { return new URL(env.APP_ORIGIN); } catch { return null; } })();
    if (main && url.hostname === `www.${main.hostname}`) {
      return Response.redirect(`${main.origin}${url.pathname}${url.search}`, request.method === "GET" || request.method === "HEAD" ? 301 : 308);
    }

    // "start" buttons and the retired /review/, /create/ pages lead into Naka Studio (src/studio-links.ts)
    const studioLink = handleStudioLinks(request, env, url);
    if (studioLink) return studioLink;

    const unavailable = closedFeature(env, url, request.method);
    if (unavailable) return unavailable;

    // naka-studio sign-in: the token exchange is server-to-server (no Origin), so it sits outside handleAuth's checks.
    const studioResponse = await handleStudioSso(request, env, url);
    if (studioResponse) return studioResponse;

    const authResponse = await handleAuth(request, env, url, ctx);
    if (authResponse) return authResponse;

    if (url.pathname.startsWith("/api/affiliate/")) {
      if (request.method !== "GET" && request.headers.get("Origin") !== url.origin) return json({ error: "คำขอไม่ถูกต้อง" }, 403);
      const user = await requireUser(request, env);
      if (!user) return json({ error: "กรุณาเข้าสู่ระบบ" }, 401);
      return (await handleAffiliateApi(request, env, url, user.id)) ?? json({ error: "not found" }, 404);
    }
    if (url.pathname === "/api/social" || url.pathname.startsWith("/api/social/")) {
      // Signed media links are fetched by Instagram without a session; every other route needs one.
      const userId = url.pathname.startsWith("/api/social/media/") ? null : (await requireUser(request, env))?.id ?? null;
      if (userId && !(await hasFeature(env, userId, "landing.social"))) return featureRefusal({ reason: "disabled" }, "โพสต์โซเชียลอัตโนมัติ");
      return (await handleSocial(request, env, url, userId)) ?? json({ error: "not found" }, 404);
    }
    if (url.pathname === "/api/marketer" || url.pathname.startsWith("/api/marketer/")) {
      // Config, trending and signed images are public; tasks and product lookups need a session.
      const user = /^\/api\/marketer\/(trending|image|media\/.+)$/.test(url.pathname) && request.method === "GET" ? null : await requireUser(request, env);
      const kick = () => ctx.waitUntil(runQueue(env.DB, jobHandlers(env), { maxJobs: 2, concurrency: 2 })
        .catch((err) => console.error("queue kick failed", errorSummary(err))));
      return (await handleMarketer(request, env, url, user, kick)) ?? json({ error: "not found" }, 404);
    }
    if (url.pathname === "/api/inbox" || url.pathname.startsWith("/api/inbox/")) {
      const user = await requireUser(request, env);
      if (!user) return json({ error: "กรุณาเข้าสู่ระบบ" }, 401);
      if (!(await hasFeature(env, user.id, "landing.inbox"))) return featureRefusal({ reason: "disabled" }, " AI Inbox");
      return (await handleInbox(request, env, url, user.id)) ?? json({ error: "not found" }, 404);
    }
    if (url.pathname.startsWith("/api/billing/")) {
      const user = await requireUser(request, env);
      if (!user) return json({ error: "กรุณาเข้าสู่ระบบ" }, 401);
      return (await handleBilling(request, env, url, user.id)) ?? json({ error: "not found" }, 404);
    }
    if (url.pathname === "/api/receipts" || url.pathname.startsWith("/api/receipts/")) {
      const user = await requireUser(request, env);
      if (!user) return json({ error: "กรุณาเข้าสู่ระบบ" }, 401);
      return (await handleReceipts(request, env, url, user.id)) ?? json({ error: "not found" }, 404);
    }
    if (url.pathname === "/api/works") {
      const user = await requireUser(request, env);
      if (!user) return json({ error: "กรุณาเข้าสู่ระบบ" }, 401);
      return (await handleWorks(request, env, url, user.id)) ?? json({ error: "not found" }, 404);
    }
    if (url.pathname === "/api/me/credits") {
      const user = await requireUser(request, env);
      if (!user) return json({ error: "กรุณาเข้าสู่ระบบ" }, 401);
      return (await handleMemberCredits(request, env, url, user.id)) ?? json({ error: "not found" }, 404);
    }
    if (url.pathname === "/api/me/works") {
      const user = await requireUser(request, env);
      if (!user) return json({ error: "กรุณาเข้าสู่ระบบ" }, 401);
      return (await handleMemberWorks(request, env, url, user.id)) ?? json({ error: "not found" }, 404);
    }
    if (url.pathname === "/api/onboarding") {
      const user = await requireUser(request, env);
      if (!user) return json({ error: "กรุณาเข้าสู่ระบบ" }, 401);
      return (await handleOnboarding(request, env, url, user.id)) ?? json({ error: "not found" }, 404);
    }
    // Stripe signs its webhook (Stripe-Signature); the session is re-read from Stripe before use.
    if (url.pathname === "/webhook/stripe") return handleStripeWebhook(request, env);
    // Meta authenticates with X-Hub-Signature-256, not a session.
    if (url.pathname === "/webhook/meta") return handleMetaWebhook(request, env, ctx);
    if (url.pathname === "/webhook/line" && request.method === "POST") return handleLineWebhook(request, env, ctx);
    if (url.pathname === "/api/health") return json({ ok: true });
    if (url.pathname === "/api/plans") return handlePublicPlans(request, env);
    if (url.pathname === "/world/index.wasm" && (request.method === "GET" || request.method === "HEAD")) {
      const compressedUrl = new URL("/world/index.wasm.gz", url.origin);
      const compressed = await env.ASSETS.fetch(new Request(compressedUrl, request));
      if (!compressed.ok) return compressed;
      const headers = new Headers(compressed.headers);
      headers.set("Content-Type", "application/wasm");
      headers.set("Content-Encoding", "gzip");
      headers.set("Cache-Control", "public, max-age=31536000, immutable");
      headers.append("Vary", "Accept-Encoding");
      return new Response(request.method === "HEAD" ? null : compressed.body, { status: compressed.status, headers });
    }
    if (url.pathname.startsWith("/api/admin/")) {
      // A Google account in ADMIN_EMAILS (signed in within 12 hours), or the ADMIN_TOKEN break-glass.
      const check = await checkAdmin(request, env);
      if (!("actor" in check)) return adminJson({ error: check.error, reason: check.reason }, check.status);
      const { actor } = check;
      if (url.pathname === "/api/admin/me") {
        return adminJson(request.method === "GET" ? { kind: actor.kind, label: actor.label } : { error: "not found" }, request.method === "GET" ? 200 : 405);
      }
      if (url.pathname === "/api/admin/studio") return handleStudio(request, env);
      // naka-studio's version, disk use and video queues, read server to server (src/admin/studio-system.ts)
      const studioSystemResponse = await handleAdminStudioSystem(request, env, url, actor);
      if (studioSystemResponse) return studioSystemResponse;
      // overview, all payments (+ CSV) and failed jobs across customers (src/admin/insights.ts)
      const insightResponse = await handleAdminInsights(request, env, url, actor);
      if (insightResponse) return insightResponse;
      // LINE alerts for admins and the history of every admin action (src/admin/alerts.ts, src/admin/audit.ts)
      const alertResponse = await handleAdminAlerts(request, env, url, actor);
      if (alertResponse) return alertResponse;
      const auditResponse = await handleAdminAudit(request, env, url);
      if (auditResponse) return auditResponse;
      // The panel is given the Worker's own env so it can tell saved values from wrangler ones.
      const systemResponse = await handleAdminSystem(request, workerEnv, url, actor);
      if (systemResponse) return systemResponse;
      const marketerResponse = await handleAdminMarketer(request, env, url, actor);
      if (marketerResponse) return marketerResponse;
      try {
        const customerResponse = await handleAdminCustomers(request, env, url, actor);
        if (customerResponse) return customerResponse;
        return await handleAdmin(request, env, url);
      } catch (err) {
        console.error("admin error", errorSummary(err));
        return json({ error: "internal error" }, 500);
      }
    }
    return env.ASSETS.fetch(request);
  },

  // Cron (wrangler.jsonc): drain the AI job queue once a minute, a few jobs at a time.
  async scheduled(controller, workerEnv, ctx): Promise<void> {
    const env = await withSettings(workerEnv);
    ctx.waitUntil(runQueue(env.DB, jobHandlers(env), { maxJobs: 30, concurrency: 5 }).then(
      (result) => { if (result.ran || result.recovered) console.log("queue", result); },
      (err) => console.error("queue run failed", errorSummary(err)),
    ));
    // Separate from the job queue so missing social config never stops AI jobs.
    if (featureOn(env, "FEATURE_SOCIAL")) ctx.waitUntil(publishDuePosts(env, { maxPosts: 2 }).then(
      (result) => { if (result.published || result.failed) console.log("social posts", result.published, result.failed); },
      () => console.error("social publish run failed"),
    ));
    // End expired packages and give monthly credits to active ones.
    ctx.waitUntil(runBillingCron(env).then(
      (result) => { if (result.expired || result.toppedUp) console.log("billing", result.expired, result.toppedUp); },
      () => console.error("billing cron failed"),
    ));
    // Receipts the payment path could not issue, or all of them once RECEIPT_SELLER_NAME is set.
    ctx.waitUntil(backfillReceipts(env, { max: 20 }).then(
      (issued) => { if (issued) console.log("receipts", issued); },
      () => console.error("receipt backfill failed"),
    ));
    // AI marketer: pull the trending API once an hour, and keep TikTok covers fresh.
    if (featureOn(env, "FEATURE_MARKETER")) {
      if (new Date(controller.scheduledTime).getUTCMinutes() === 7 && env.TRENDING_API_URL?.trim()) {
        ctx.waitUntil(syncTrendingApi(env).then(
          (result) => { if (result) console.log("trending sync", result.imported, result.skipped); },
          (err) => console.error("trending sync failed", errorSummary(err)),
        ));
      }
      ctx.waitUntil(refreshTrendingCovers(env, 3).catch(() => console.error("trending cover refresh failed")));
    }
    // LINE alerts for admins: every five minutes, one message with whatever is new (src/admin/alerts.ts)
    if (new Date(controller.scheduledTime).getUTCMinutes() % 5 === 0) ctx.waitUntil(runAdminAlerts(env).catch(() => console.error("admin alerts failed")));
    // Pick up stored webhooks and queue inbox replies; the replies themselves run in runQueue.
    if (featureOn(env, "FEATURE_INBOX")) ctx.waitUntil(drainInbox(env, { maxReceipts: 5, maxMessages: 20 }).then(
      (result) => { if (result.receipts || result.enqueued) console.log("inbox", result.receipts, result.enqueued); },
      () => console.error("inbox drain failed"),
    ));
  },
} satisfies ExportedHandler<Env>;

const CLOSED = "ฟีเจอร์นี้ปิดให้บริการชั่วคราว";
const adminJson = (data: unknown, status = 200) => new Response(JSON.stringify(data),
  { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });

/** Answers requests for a feature switched off in /admin/system/; null lets the request through. */
function closedFeature(env: Env, url: URL, method: string): Response | null {
  const path = url.pathname;
  const under = (base: string) => path === base || path.startsWith(base + "/");
  // Maintenance closes the customer API. The panel, Google sign-in (admins use it), health and webhooks keep working.
  if (featureOn(env, "FEATURE_MAINTENANCE") && path.startsWith("/api/") && !under("/api/admin") &&
      path !== "/api/health" && path !== "/api/auth/config" && path !== "/api/auth/logout" && !under("/api/auth/google")) {
    return json({ error: "ระบบปิดปรับปรุงชั่วคราว กรุณากลับมาใหม่ภายหลัง", maintenance: true }, 503);
  }
  if (!featureOn(env, "FEATURE_CLIPS") && method === "POST" && /^\/api\/affiliate\/reviews\/?$/.test(path)) return json({ error: CLOSED }, 503);
  // Signed media links stay open: Instagram may still be fetching a clip for a post already sent.
  if (!featureOn(env, "FEATURE_SOCIAL") && under("/api/social") && !path.startsWith("/api/social/media/")) return json({ error: CLOSED }, 503);
  if (!featureOn(env, "FEATURE_INBOX") && under("/api/inbox")) return json({ error: CLOSED }, 503);
  return null;
}

function jobHandlers(env: Env): Record<string, JobHandler> {
  return { [AFFILIATE_JOB_KIND]: makeAffiliateHandler(env), [INBOX_JOB_KIND]: makeInboxHandler(env), ...makeMarketerHandlers(env), [AI_VIDEO_JOB_KIND]: makeAiVideoHandler(env) };
}

const LINE_WEBHOOK_MAX_BYTES = 256 * 1024; // LINE payloads are small; anything larger is refused unread

async function handleLineWebhook(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const rawBytes = await readBodyBytes(request, LINE_WEBHOOK_MAX_BYTES);
  if (rawBytes === null) return new Response("payload too large", { status: 413 });
  const body = new TextDecoder().decode(rawBytes);
  if (!(await verifySignature(body, request.headers.get("x-line-signature"), env.LINE_CHANNEL_SECRET))) {
    return new Response("invalid signature", { status: 401 });
  }
  const botOn = featureOn(env, "FEATURE_LINE_BOT"); // switched off: acknowledge, the shop bot answers nothing
  const { events } = JSON.parse(body) as { events: LineEvent[] };
  // Acknowledge LINE immediately; the agent runs in the background. Admins pair or stop LINE alerts through
  // the same OA (src/admin/alerts.ts), also while the shop bot is off.
  ctx.waitUntil(Promise.all(events.map(async (e) => {
    try {
      if (await handleAlertCommand(env, e, (id) => getDisplayName(env, id))) return;
      if (botOn) await handleLineEvent(env, e);
    } catch (err) { console.error("event failed", errorSummary(err)); }
  })));
  return new Response("ok");
}

async function handleLineEvent(env: Env, event: LineEvent): Promise<void> {
  const userId = event.source.userId;
  if (event.type !== "message" || !userId || !event.replyToken || event.source.type !== "user") return;

  const conv = await getConversation(env.DB, userId);
  if (!conv.display_name) conv.display_name = await getDisplayName(env, userId);

  if (conv.human_mode) {
    // Admin is handling this chat; just log the message for the dashboard.
    conv.history.push({ role: "user", content: event.message?.text ?? `[${event.message?.type}]` });
    await saveConversation(env.DB, conv);
    return;
  }

  if (event.message?.type !== "text" || !event.message.text) {
    const isImage = event.message?.type === "image";
    await replyOrPush(
      env,
      event.replyToken,
      userId,
      isImage ? "ได้รับรูปแล้วค่ะ 🙏 แอดมินจะตรวจสอบและตอบกลับเร็ว ๆ นี้นะคะ" : "ตอนนี้นาคาอ่านได้เฉพาะข้อความตัวอักษรค่ะ รบกวนพิมพ์มาได้เลยนะคะ 😊",
    );
    if (isImage) {
      // Most images are payment slips — hand off so an admin verifies them.
      conv.human_mode = true;
      conv.handoff_reason = "ลูกค้าส่งรูปภาพ (อาจเป็นสลิป)";
      conv.history.push({ role: "user", content: "[ส่งรูปภาพ]" });
      await saveConversation(env.DB, conv);
    }
    return;
  }

  await startLoading(env, userId);
  const reply = await runSalesAgent(env, conv, event.message.text);
  await saveConversation(env.DB, conv);
  await replyOrPush(env, event.replyToken, userId, reply);
}

async function handleAdmin(request: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname.replace(/^\/api\/admin\//, "").split("/");
  const method = request.method;
  const db = env.DB;
  const body = async <T>() => (await request.json()) as T;

  // ---- products ----
  if (path[0] === "products") {
    const id = path[1] ? Number(path[1]) : null;
    if (method === "GET" && !id) return json((await db.prepare("SELECT * FROM products ORDER BY id DESC").all()).results);
    if (method === "POST" && !id) {
      const p = await body<{ name: string; description?: string; category?: string; price: number; stock?: number; image_url?: string }>();
      if (!p.name || !(p.price >= 0)) return json({ error: "ต้องมีชื่อและราคา" }, 400);
      const r = await db
        .prepare("INSERT INTO products (name, description, category, price, stock, image_url) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(p.name, p.description ?? "", p.category ?? "", p.price, p.stock ?? 0, p.image_url ?? "")
        .run();
      return json({ id: r.meta.last_row_id }, 201);
    }
    if (method === "PUT" && id) {
      const p = await body<Record<string, unknown>>();
      const fields = ["name", "description", "category", "price", "stock", "image_url", "active"].filter((f) => f in p);
      if (!fields.length) return json({ error: "no fields" }, 400);
      await db
        .prepare(`UPDATE products SET ${fields.map((f) => `${f} = ?`).join(", ")} WHERE id = ?`)
        .bind(...fields.map((f) => p[f] as string | number), id)
        .run();
      return json({ ok: true });
    }
    if (method === "DELETE" && id) {
      await db.prepare("DELETE FROM products WHERE id = ?").bind(id).run();
      return json({ ok: true });
    }
  }

  // ---- orders ----
  if (path[0] === "orders") {
    if (method === "GET" && !path[1]) {
      return json((await db.prepare("SELECT * FROM orders ORDER BY id DESC LIMIT 200").all()).results);
    }
    if (method === "PATCH" && path[1]) {
      const { status } = await body<{ status: string }>();
      if (!["pending", "paid", "shipped", "cancelled"].includes(status)) return json({ error: "bad status" }, 400);
      await db.prepare("UPDATE orders SET status = ? WHERE id = ?").bind(status, Number(path[1])).run();
      return json({ ok: true });
    }
  }

  // ---- settings ----
  if (path[0] === "settings") {
    if (method === "GET") return json((await db.prepare("SELECT key, value FROM settings").all()).results);
    if (method === "PUT") {
      const s = await body<Record<string, string>>();
      const allowed = ["shop_name", "shop_info"];
      await db.batch(
        Object.entries(s)
          .filter(([k]) => allowed.includes(k))
          .map(([k, v]) => db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(k, v)),
      );
      return json({ ok: true });
    }
  }

  // ---- conversations ----
  if (path[0] === "conversations") {
    if (method === "GET" && !path[1]) {
      const { results } = await db
        .prepare("SELECT line_user_id, display_name, human_mode, handoff_reason, updated_at, history FROM conversations ORDER BY updated_at DESC LIMIT 100")
        .all();
      return json(results.map((r) => ({ ...r, history: JSON.parse(r.history as string) })));
    }
    if (method === "PATCH" && path[1]) {
      const conv = await getConversation(db, decodeURIComponent(path[1]));
      const { human_mode } = await body<{ human_mode: boolean }>();
      conv.human_mode = human_mode;
      if (!human_mode) conv.handoff_reason = "";
      await saveConversation(db, conv);
      return json({ ok: true });
    }
    if (method === "POST" && path[2] === "reply") {
      // Admin sends a message to the customer on LINE.
      const userId = decodeURIComponent(path[1]);
      const { text } = await body<{ text: string }>();
      if (!(await pushText(env, userId, text))) return json({ error: "LINE push failed" }, 502);
      const conv = await getConversation(db, userId);
      conv.history.push({ role: "assistant", content: `[แอดมิน] ${text}` });
      await saveConversation(db, conv);
      return json({ ok: true });
    }
  }

  // ---- credits (manual grants until payments exist) ----
  if (path[0] === "credits" && path[1]) {
    const userId = decodeURIComponent(path[1]);
    if (method === "GET") {
      return json({ balance: await getBalance(db, userId), plan: await getPlan(db, userId), ledger: await ledgerFor(db, userId) });
    }
    if (method === "POST") {
      const { amount, note } = await body<{ amount: number; note?: string }>();
      if (!Number.isInteger(amount) || amount <= 0) return json({ error: "amount ต้องเป็นจำนวนเต็มบวก" }, 400);
      return json({ balance: await grantCredits(db, userId, amount, "grant", note ?? "") }, 201);
    }
  }

  // ---- test chat (try the agent without LINE) ----
  if (path[0] === "chat" && method === "POST") {
    const { message, reset } = await body<{ message?: string; reset?: boolean }>();
    const conv = await getConversation(db, "test:admin");
    if (reset) {
      conv.history = [];
      conv.human_mode = false;
      conv.handoff_reason = "";
    }
    conv.display_name = "ทดสอบจากหลังร้าน";
    if (!message?.trim()) {
      await saveConversation(db, conv);
      return json({ reply: "", human_mode: conv.human_mode });
    }
    const reply = await runSalesAgent(env, conv, message);
    await saveConversation(db, conv);
    return json({ reply, human_mode: conv.human_mode });
  }

  return json({ error: "not found" }, 404);
}
