// GET /api/me/works — the signed-in member's latest works in Naka Studio, for the /app/ dashboard.
// The studio is asked server to server (STUDIO_INTERNAL_URL + its ADMIN_TOKEN, as /admin/studio-system/ does) for
// this member only; the browser never sees the token or names the member. When the studio cannot answer, the
// dashboard still loads: { available: false } and the page keeps its "open Naka Studio" button.
import { studioConfig } from "../auth/studio";
import type { Env } from "../types";

const TIMEOUT_MS = 4_000;
const LIMIT = 5;

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
});

const KIND_LABELS: Record<string, string> = {
  drama: "ละครสั้น",
  product_video: "วิดีโอรีวิวสินค้า",
  seller: "โพสต์ขาย",
  viral_clone: "โคลนไวรัล",
  campaign: "แคมเปญการตลาด",
};

/** The studio's many statuses in three member words (and "ร่าง"). Exported for tests. */
export function statusLabel(status: string): string {
  const s = status.toLowerCase();
  if (s === "draft" || s === "") return "ร่าง";
  if (["completed", "done", "published", "ready", "rendered", "posted"].includes(s)) return "เสร็จแล้ว";
  if (["failed", "error", "cancelled"].includes(s)) return "ไม่สำเร็จ";
  return "กำลังทำ";
}

interface StudioWork { kind?: unknown; title?: unknown; status?: unknown; updatedAt?: unknown; path?: unknown }

export async function handleMemberWorks(request: Request, env: Env, url: URL, userId: string): Promise<Response | null> {
  if (url.pathname !== "/api/me/works") return null;
  if (request.method !== "GET") return json({ error: "วิธีเรียกใช้งานไม่ถูกต้อง" }, 405);

  const studio = studioConfig(env);
  const base = (env.STUDIO_INTERNAL_URL ?? "").trim().replace(/\/+$/, "");
  const token = (env.STUDIO_ADMIN_TOKEN ?? "").trim();
  if (!studio || !/^https?:\/\//i.test(base) || !token) return json({ available: false, works: [] });

  let works: StudioWork[];
  try {
    const response = await fetch(`${base}/api/v1/system/member-works?owner=${encodeURIComponent(userId)}&limit=${LIMIT}`, {
      // the token must never follow a redirect to another host
      redirect: "error",
      headers: { "X-Admin-Token": token, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      console.error("me/works: studio answered", response.status);
      return json({ available: false, works: [] });
    }
    const body = await response.json() as { data?: { works?: unknown } };
    works = Array.isArray(body?.data?.works) ? body.data.works as StudioWork[] : [];
  } catch {
    console.error("me/works: studio unreachable");
    return json({ available: false, works: [] });
  }

  return json({
    available: true,
    works: works
      // only links into the studio's own work pages
      .filter((w) => typeof w.kind === "string" && w.kind in KIND_LABELS && typeof w.path === "string" &&
        /^\/(drama|studio|seller|viral-clone|marketer)\/\d{1,15}$/.test(w.path))
      .slice(0, LIMIT)
      .map((w) => ({
        kind: w.kind as string,
        kindLabel: KIND_LABELS[w.kind as string],
        title: Array.from(String(w.title ?? "").trim() || KIND_LABELS[w.kind as string]).slice(0, 80).join(""),
        status: statusLabel(String(w.status ?? "")),
        updatedAt: typeof w.updatedAt === "string" ? w.updatedAt : null,
        href: studio.origin + (w.path as string),
      })),
  });
}
