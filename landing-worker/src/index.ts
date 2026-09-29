import { AFFILIATE_JOB_KIND, handleAffiliateApi, makeAffiliateHandler } from "./affiliate";
import { runSalesAgent } from "./agent";
import { handleAuth, requireUser } from "./auth";
import { getBalance, getPlan, grantCredits, ledgerFor } from "./credits";
import { getConversation, saveConversation } from "./db";
import { drainInbox, handleInbox, handleMetaWebhook, INBOX_JOB_KIND, makeInboxHandler } from "./inbox";
import { runQueue, type JobHandler } from "./jobs";
import { getDisplayName, pushText, replyOrPush, startLoading, verifySignature } from "./line";
import { handleSocial, publishDuePosts } from "./social";
import { handleStudio } from "./studio";
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
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);

    const authResponse = await handleAuth(request, env, url);
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
      return (await handleSocial(request, env, url, userId)) ?? json({ error: "not found" }, 404);
    }
    if (url.pathname === "/api/inbox" || url.pathname.startsWith("/api/inbox/")) {
      const user = await requireUser(request, env);
      if (!user) return json({ error: "กรุณาเข้าสู่ระบบ" }, 401);
      return (await handleInbox(request, env, url, user.id)) ?? json({ error: "not found" }, 404);
    }
    // Meta authenticates with X-Hub-Signature-256, not a session.
    if (url.pathname === "/webhook/meta") return handleMetaWebhook(request, env, ctx);
    if (url.pathname === "/webhook/line" && request.method === "POST") return handleLineWebhook(request, env, ctx);
    if (url.pathname === "/api/health") return json({ ok: true });
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
      const auth = request.headers.get("Authorization");
      if (!env.ADMIN_TOKEN || auth !== `Bearer ${env.ADMIN_TOKEN}`) return json({ error: "unauthorized" }, 401);
      if (url.pathname === "/api/admin/studio") return handleStudio(request, env);
      try {
        return await handleAdmin(request, env, url);
      } catch (err) {
        console.error("admin error", err);
        return json({ error: String(err) }, 500);
      }
    }
    return env.ASSETS.fetch(request);
  },

  // Cron (wrangler.jsonc): drain the AI job queue once a minute, a few jobs at a time.
  async scheduled(_controller, env, ctx): Promise<void> {
    ctx.waitUntil(runQueue(env.DB, jobHandlers(env), { maxJobs: 30, concurrency: 5 }).then(
      (result) => { if (result.ran || result.recovered) console.log("queue", result); },
      (err) => console.error("queue run failed", err),
    ));
    // Separate from the job queue so missing social config never stops AI jobs.
    ctx.waitUntil(publishDuePosts(env, { maxPosts: 2 }).then(
      (result) => { if (result.published || result.failed) console.log("social posts", result.published, result.failed); },
      () => console.error("social publish run failed"),
    ));
    // Pick up stored webhooks and queue inbox replies; the replies themselves run in runQueue.
    ctx.waitUntil(drainInbox(env, { maxReceipts: 5, maxMessages: 20 }).then(
      (result) => { if (result.receipts || result.enqueued) console.log("inbox", result.receipts, result.enqueued); },
      () => console.error("inbox drain failed"),
    ));
  },
} satisfies ExportedHandler<Env>;

function jobHandlers(env: Env): Record<string, JobHandler> {
  return { [AFFILIATE_JOB_KIND]: makeAffiliateHandler(env), [INBOX_JOB_KIND]: makeInboxHandler(env) };
}

async function handleLineWebhook(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const body = await request.text();
  if (!(await verifySignature(body, request.headers.get("x-line-signature"), env.LINE_CHANNEL_SECRET))) {
    return new Response("invalid signature", { status: 401 });
  }
  const { events } = JSON.parse(body) as { events: LineEvent[] };
  // Acknowledge LINE immediately; the agent runs in the background.
  ctx.waitUntil(Promise.all(events.map((e) => handleLineEvent(env, e).catch((err) => console.error("event failed", err)))));
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
