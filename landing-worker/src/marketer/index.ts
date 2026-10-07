// /api/marketer/* — the AI marketer (studio workflow 05, public/studio/marketer/).
import type { Env, User } from "../types";
import { readBodyBytes } from "../auth/common";
import { enqueueJob, getJobForUser } from "../jobs";
import { CATEGORIES, EXPERTS, GROUPS, TEMPLATES } from "./catalog";
import { MARKETER_COST_CREDITS, MARKETER_JOB_KINDS, MarketerInputError, parseMarketerInput, type MarketerKind } from "./ai";
import { ProductUrlError, proxyImage, readProductPage } from "./product";
import { listTrending, VIEW_BANDS } from "./trending";
import { activeProvider, aiVideoCredits, createAiVideo, listAiVideos, serveMedia, uploadMedia, VideoError } from "../video";

export { makeMarketerHandlers } from "./ai";
export { refreshTrendingCovers, syncTrendingApi } from "./trending";

const BASE = "/api/marketer";
const MAX_SMALL_BODY = 16 * 1024;
const MAX_RECREATE_BODY = 1_900_000; // up to eight video frames
const json = (data: unknown, status = 200, cache = "no-store") => new Response(JSON.stringify(data),
  { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": cache } });

class MarketerError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

async function readJson(request: Request, max: number): Promise<unknown> {
  if (request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw new MarketerError(400, "กรุณาส่งข้อมูลเป็น JSON");
  const bytes = await readBodyBytes(request, max);
  if (bytes === null) throw new MarketerError(413, "ข้อมูลใหญ่เกินไป");
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new MarketerError(400, "ข้อมูลไม่ถูกต้อง"); }
}

/** Whether AI video is ready, and what it costs — the page hides or explains the video buttons. */
function videoConfig(env: Env) {
  try {
    const { provider } = activeProvider(env);
    if (!env.MEDIA) return { enabled: false, reason: "ยังไม่ได้เปิดที่เก็บไฟล์ (R2)" };
    return { enabled: true, credits: aiVideoCredits(env), provider: provider.label, limits: provider.limits };
  } catch (error) { return { enabled: false, reason: error instanceof VideoError ? error.message : "ยังไม่พร้อม" }; }
}

const KIND_BY_JOB = new Map<string, MarketerKind>(Object.entries(MARKETER_JOB_KINDS).map(([k, v]) => [v, k as MarketerKind]));
const JOB_KIND_LIST = Object.values(MARKETER_JOB_KINDS);

/** Errors stored by the queue are short codes; turn them into something a seller can act on. */
function failureMessage(error: string | null): string {
  if (error?.includes("ANTHROPIC_API_KEY")) return "ระบบ AI ยังไม่เปิดใช้งาน คืนเครดิตให้แล้ว";
  if (error === "marketer refused") return "AI ไม่สามารถทำงานนี้ได้ ลองปรับคำสั่งให้ชัดขึ้น คืนเครดิตให้แล้ว";
  return "ทำงานไม่สำเร็จ คืนเครดิตให้แล้ว ลองใหม่อีกครั้ง";
}

async function tasks(env: Env, userId: string): Promise<Response> {
  // json_extract keeps the (large) video frames out of the listing.
  const { results } = await env.DB.prepare(`SELECT id, kind, status, created_at AS createdAt,
      json_extract(input, '$.templateId') AS templateId, substr(json_extract(input, '$.prompt'), 1, 120) AS prompt,
      json_extract(input, '$.productName') AS productName, json_extract(input, '$.count') AS count
    FROM jobs WHERE user_id = ? AND kind IN (${JOB_KIND_LIST.map(() => "?").join(", ")}) ORDER BY created_at DESC, id LIMIT 20`)
    .bind(userId, ...JOB_KIND_LIST).all<{ id: string; kind: string; status: string; createdAt: string; templateId: string | null; prompt: string | null; productName: string | null; count: number | null }>();
  const template = new Map(TEMPLATES.map((t) => [t.id, t.title]));
  return json({ tasks: results.map((r) => {
    const kind = KIND_BY_JOB.get(r.kind)!;
    const title = kind === "insight" ? (r.templateId && template.get(r.templateId)) || r.prompt || "วิเคราะห์การตลาด"
      : kind === "bulk" ? `${r.count ?? ""} แผนโฆษณา · ${r.productName ?? ""}` : `ทำซ้ำคลิปไวรัล · ${r.productName ?? ""}`;
    return { id: r.id, kind, status: r.status, title, createdAt: r.createdAt };
  }) });
}

async function task(env: Env, userId: string, id: string): Promise<Response> {
  const found = await getJobForUser(env.DB, id, userId);
  const kind = found ? KIND_BY_JOB.get(found.job.kind) : undefined;
  if (!found || !kind) return json({ error: "ไม่พบงานนี้" }, 404);
  const { job, ahead } = found;
  let productName = "";
  try { productName = String((JSON.parse(job.input) as { productName?: unknown }).productName ?? "").slice(0, 160); } catch { /* stored by us; never broken */ }
  return json({ id: job.id, kind, status: job.status, ahead, productName,
    ...(job.status === "done" && job.output ? { output: JSON.parse(job.output) } : {}),
    ...(job.status === "failed" ? { error: failureMessage(job.error) } : {}) });
}

/**
 * Public: config, trending, signed images. Signed in: product lookup and tasks.
 * `kick` runs the queue now, so a task does not wait for the next cron minute.
 */
export async function handleMarketer(request: Request, env: Env, url: URL, user: User | null, kick: () => void): Promise<Response | null> {
  if (url.pathname !== BASE && !url.pathname.startsWith(BASE + "/")) return null;
  const path = url.pathname.slice(BASE.length);
  const method = request.method;
  try {
    if (env.FEATURE_MARKETER === "off") throw new MarketerError(503, "นักการตลาด AI ปิดให้บริการชั่วคราว");
    if (path === "/config" && method === "GET") {
      return json({ ai: !!env.ANTHROPIC_API_KEY?.trim(), cost: MARKETER_COST_CREDITS, categories: CATEGORIES, groups: GROUPS,
        experts: Object.fromEntries(Object.entries(EXPERTS).map(([k, v]) => [k, v.label])), templates: TEMPLATES,
        viewBands: Object.keys(VIEW_BANDS), signedIn: !!user, video: videoConfig(env) });
    }
    if (path === "/trending" && method === "GET") {
      const q = url.searchParams;
      return json({ videos: await listTrending(env, { category: q.get("category") ?? undefined, views: q.get("views") ?? undefined,
        days: q.get("days") ?? undefined, sort: q.get("sort") ?? undefined, region: q.get("region") ?? undefined }) }, 200, "public, max-age=120");
    }
    if (path === "/image" && method === "GET") return proxyImage(env, url);
    const media = path.match(/^\/media\/(.+)$/);
    if (media && method === "GET") {
      let key: string;
      try { key = decodeURIComponent(media[1]); } catch { return json({ error: "ลิงก์ไม่ถูกต้อง" }, 400); }
      return await serveMedia(request, env, url, key);
    }

    if (!user) throw new MarketerError(401, "กรุณาเข้าสู่ระบบก่อนใช้งาน");
    if (method !== "GET" && (request.headers.get("Origin") !== url.origin || request.headers.get("Sec-Fetch-Site") === "cross-site")) {
      throw new MarketerError(403, "คำขอไม่ถูกต้อง");
    }
    if (path === "/product" && method === "POST") {
      const body = await readJson(request, MAX_SMALL_BODY) as { url?: unknown };
      if (typeof body?.url !== "string" || body.url.length > 2000) throw new MarketerError(400, "กรุณาวางลิงก์หน้าสินค้า");
      return json(await readProductPage(env, body.url));
    }
    const create = path.match(/^\/tasks\/(insight|bulk|recreate)$/);
    if (create && method === "POST") {
      const kind = create[1] as MarketerKind;
      const input = parseMarketerInput(kind, await readJson(request, kind === "recreate" ? MAX_RECREATE_BODY : MAX_SMALL_BODY));
      const result = await enqueueJob(env.DB, { userId: user.id, kind: MARKETER_JOB_KINDS[kind], input, costCredits: MARKETER_COST_CREDITS, maxAttempts: 2 });
      if (!result.ok) {
        return result.reason === "insufficient_credits" ? json({ error: "เครดิตไม่พอ กรุณาเติมเครดิตก่อน", reason: "credits" }, 402)
          : json({ error: "มีงานที่กำลังทำอยู่ครบตามแพ็กเกจแล้ว รอให้เสร็จก่อนนะ", reason: "busy" }, 429);
      }
      kick();
      return json({ jobId: result.jobId, cost: MARKETER_COST_CREDITS }, 202);
    }
    if (path === "/tasks" && method === "GET") return await tasks(env, user.id);
    if (path === "/media" && method === "POST") return await uploadMedia(request, env, url, user.id);
    if (path === "/videos" && method === "POST") return await createAiVideo(request, env, user.id, kick);
    if (path === "/videos" && method === "GET") return json({ videos: await listAiVideos(env, user.id) });
    const one = path.match(/^\/tasks\/([0-9a-f-]{36})$/);
    if (one && method === "GET") return await task(env, user.id, one[1]);
    return json({ error: "ไม่พบเส้นทางนี้" }, 404);
  } catch (error) {
    if (error instanceof MarketerError || error instanceof VideoError) return json({ error: error.message }, error.status);
    if (error instanceof MarketerInputError || error instanceof ProductUrlError) return json({ error: error.message }, 400);
    console.error("marketer error", error instanceof Error ? error.name : typeof error); // no detail: bodies carry seller content
    return json({ error: "ระบบขัดข้อง กรุณาลองใหม่" }, 500);
  }
}
