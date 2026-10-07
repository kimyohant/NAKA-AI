// /api/admin/marketer/* — curate the trending gallery. The shared router checks the admin first.
import type { AdminActor } from "../admin/auth";
import { readBodyBytes } from "../auth/common";
import type { Env } from "../types";
import { CATEGORIES, isCategory } from "./catalog";
import { normalizeTrending, parseMetric, publicVideo, syncTrendingApi, tiktokOembed, upsertTrending, type TrendingInput, type TrendingRow } from "./trending";

const BASE = "/api/admin/marketer/trending";
const MAX_IMPORT_ROWS = 1000;
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data),
  { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });

async function body(request: Request, max: number): Promise<Record<string, unknown>> {
  if (request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw new AdminInputError("กรุณาส่งข้อมูลเป็น JSON");
  const bytes = await readBodyBytes(request, max);
  if (bytes === null) throw new AdminInputError("ข้อมูลใหญ่เกินไป");
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch { throw new AdminInputError("ข้อมูลไม่ถูกต้อง"); }
}
class AdminInputError extends Error {}

async function list(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(`SELECT * FROM trending_videos ORDER BY active DESC, created_at DESC, id LIMIT 500`).all<TrendingRow>();
  const counts = await env.DB.prepare("SELECT source, COUNT(*) AS n FROM trending_videos GROUP BY source").all<{ source: string; n: number }>();
  return json({
    videos: results.map((r) => ({ ...publicVideo(r), source: r.source, active: r.active === 1, addedBy: r.added_by, updatedAt: r.updated_at })),
    counts: Object.fromEntries(counts.results.map((c) => [c.source, c.n])),
    apiConfigured: !!env.TRENDING_API_URL?.trim(),
    categories: CATEGORIES,
  });
}

/** Fill in title, author and cover from TikTok when the admin left them blank. */
async function enrich(row: TrendingInput): Promise<TrendingInput> {
  if (row.platform !== "tiktok" || (row.title && row.thumbnailUrl)) return row;
  const meta = await tiktokOembed(row.url);
  return meta ? { ...row, title: row.title || meta.title, author: row.author || meta.author, thumbnailUrl: row.thumbnailUrl ?? meta.thumbnail } : row;
}

async function add(request: Request, env: Env, who: string): Promise<Response> {
  const input = await body(request, 16 * 1024);
  const row = normalizeTrending(input);
  if ("error" in row) throw new AdminInputError(row.error);
  const enriched = await enrich(row);
  await upsertTrending(env, [enriched], "curated", who);
  // A re-added clip comes back into the gallery.
  await env.DB.prepare("UPDATE trending_videos SET active = 1 WHERE url = ?").bind(enriched.url).run();
  return list(env);
}

async function update(request: Request, env: Env, id: string): Promise<Response> {
  const input = await body(request, 8 * 1024);
  const sets: string[] = [];
  const binds: unknown[] = [];
  if (input.active !== undefined) {
    if (typeof input.active !== "boolean") throw new AdminInputError("สถานะต้องเป็น true หรือ false");
    sets.push("active = ?"); binds.push(input.active ? 1 : 0);
  }
  if (input.category !== undefined) {
    if (!isCategory(input.category)) throw new AdminInputError("หมวดไม่ถูกต้อง");
    sets.push("category = ?"); binds.push(input.category);
  }
  for (const [field, column] of [["views", "views"], ["likes", "likes"], ["revenueThb", "revenue_thb"]] as const) {
    if (input[field] === undefined) continue;
    const value = input[field] === null && field === "revenueThb" ? null : parseMetric(input[field]);
    if (value === null && field !== "revenueThb") throw new AdminInputError("ตัวเลขไม่ถูกต้อง");
    sets.push(`${column} = ?`); binds.push(value);
  }
  for (const [field, column, max] of [["productName", "product_name", 200], ["title", "title", 600]] as const) {
    if (input[field] === undefined) continue;
    if (typeof input[field] !== "string" || (input[field] as string).length > max) throw new AdminInputError("ข้อความไม่ถูกต้อง");
    sets.push(`${column} = ?`); binds.push((input[field] as string).trim());
  }
  if (!sets.length) throw new AdminInputError("ไม่มีข้อมูลที่จะแก้");
  const result = await env.DB.prepare(`UPDATE trending_videos SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`)
    .bind(...binds, Math.floor(Date.now() / 1000), id).run();
  if (!result.meta.changes) return json({ error: "ไม่พบคลิปนี้" }, 404);
  return list(env);
}

/** Rows parsed in the browser from a FastMoss/Kalodata CSV or JSON export. */
async function importRows(request: Request, env: Env, who: string): Promise<Response> {
  const input = await body(request, 3_000_000);
  if (!Array.isArray(input.rows) || !input.rows.length || input.rows.length > MAX_IMPORT_ROWS) throw new AdminInputError(`นำเข้าได้ครั้งละ 1–${MAX_IMPORT_ROWS} แถว`);
  let rate: number | undefined;
  if (input.currency === "USD") {
    rate = Number(input.usdRate);
    if (!Number.isFinite(rate) || rate <= 0 || rate > 1000) throw new AdminInputError("กรุณาใส่อัตราแลกเปลี่ยนดอลลาร์เป็นบาท");
  }
  const skipped: { row: number; reason: string }[] = [];
  const valid: TrendingInput[] = [];
  input.rows.forEach((raw, i) => {
    const row = normalizeTrending(raw, rate);
    if ("error" in row) skipped.push({ row: i + 1, reason: row.error }); else valid.push(row);
  });
  // The same clip twice in one file: keep the first.
  const byUrl = new Map<string, TrendingInput>();
  for (const row of valid) if (!byUrl.has(row.url)) byUrl.set(row.url, row);
  const unique = [...byUrl.values()];
  await upsertTrending(env, unique, "import", who);
  const response = await (await list(env)).json() as Record<string, unknown>;
  return json({ ...response, imported: unique.length, skipped: skipped.slice(0, 20), skippedCount: skipped.length });
}

export async function handleAdminMarketer(request: Request, env: Env, url: URL, actor: AdminActor): Promise<Response | null> {
  if (url.pathname !== BASE && !url.pathname.startsWith(BASE + "/")) return null;
  const path = url.pathname.slice(BASE.length);
  try {
    if (path === "" && request.method === "GET") return await list(env);
    if (path === "" && request.method === "POST") return await add(request, env, actor.label);
    if (path === "/import" && request.method === "POST") return await importRows(request, env, actor.label);
    if (path === "/sync" && request.method === "POST") {
      if (!env.TRENDING_API_URL?.trim()) throw new AdminInputError("ยังไม่ได้ตั้ง API คลิปมาแรงในแท็บ API และการเชื่อมต่อ");
      let result;
      try { result = await syncTrendingApi(env); } catch (error) {
        return json({ error: `ดึงจาก API ไม่สำเร็จ: ${error instanceof Error ? error.message : "ไม่ทราบสาเหตุ"}` }, 502);
      }
      const response = await (await list(env)).json() as Record<string, unknown>;
      return json({ ...response, ...result });
    }
    const one = path.match(/^\/([0-9a-f-]{36})$/);
    if (one && request.method === "PATCH") return await update(request, env, one[1]);
    if (one && request.method === "DELETE") {
      await env.DB.prepare("DELETE FROM trending_videos WHERE id = ?").bind(one[1]).run();
      return list(env);
    }
    return json({ error: "not found" }, 404);
  } catch (error) {
    if (error instanceof AdminInputError) return json({ error: error.message }, 400);
    console.error("admin marketer error", error instanceof Error ? error.name : typeof error);
    return json({ error: "internal error" }, 500);
  }
}
