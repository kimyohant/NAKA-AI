import { AFFILIATE_JOB_KIND } from "../affiliate";
import type { Env } from "../types";

const PAGE_SIZE = 20;
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
});

interface WorkRow {
  id: string;
  kind: string;
  input: string;
  status: "queued" | "running" | "done" | "failed";
  cost_credits: number;
  created_at: string;
  finished_at: string | null;
}

interface Cursor { createdAt: string; id: string }

function readCursor(raw: string): Cursor | null {
  try {
    if (raw.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(raw)) return null;
    const value: unknown = JSON.parse(atob(raw.replace(/-/g, "+").replace(/_/g, "/")));
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const cursor = value as Record<string, unknown>;
    if (typeof cursor.createdAt !== "string" || !cursor.createdAt ||
        typeof cursor.id !== "string" || !cursor.id || cursor.createdAt.length > 100 || cursor.id.length > 200) return null;
    return { createdAt: cursor.createdAt, id: cursor.id };
  } catch {
    return null;
  }
}

function makeCursor(row: WorkRow): string {
  return btoa(JSON.stringify({ createdAt: row.created_at, id: row.id }))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function titleFromInput(raw: string): string {
  try {
    const value: unknown = JSON.parse(raw);
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const name = (value as Record<string, unknown>).productName;
      if (typeof name === "string" && name.trim()) return Array.from(name.trim()).slice(0, 80).join("");
    }
  } catch {
    // Old or malformed jobs still need a readable title.
  }
  return "คลิปรีวิว";
}

/** Called after requireUser; only the signed-in user's review jobs are visible. */
export async function handleWorks(request: Request, env: Env, url: URL, userId: string): Promise<Response | null> {
  if (url.pathname !== "/api/works") return null;
  if (request.method !== "GET") return json({ error: "วิธีเรียกใช้งานไม่ถูกต้อง" }, 405);

  const before = url.searchParams.get("before");
  const cursor = before === null ? null : readCursor(before);
  if (before !== null && !cursor) return json({ error: "ตำแหน่งรายการไม่ถูกต้อง" }, 400);

  const query = `SELECT id, kind, input, status, cost_credits, created_at, finished_at
    FROM jobs WHERE user_id = ? AND kind = ?${cursor ? " AND (created_at < ? OR (created_at = ? AND id < ?))" : ""}
    ORDER BY created_at DESC, id DESC LIMIT ?`;
  const params: (string | number)[] = [userId, AFFILIATE_JOB_KIND];
  if (cursor) params.push(cursor.createdAt, cursor.createdAt, cursor.id);
  params.push(PAGE_SIZE + 1);
  try {
    const { results } = await env.DB.prepare(query).bind(...params).all<WorkRow>();
    const rows = results.slice(0, PAGE_SIZE);
    return json({
      works: rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        title: titleFromInput(row.input),
        status: row.status,
        costCredits: row.cost_credits,
        createdAt: row.created_at,
        finishedAt: row.finished_at,
        href: `/review/?job=${encodeURIComponent(row.id)}`,
      })),
      next: results.length > PAGE_SIZE ? makeCursor(rows[rows.length - 1]) : null,
    });
  } catch {
    return json({ error: "โหลดผลงานไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }, 500);
  }
}
