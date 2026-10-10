// GET /api/me/credits — the signed-in member's own balance, package and credit history for the
// /app/ dashboard. Admin notes on grants are internal ("เหตุผล" in /admin/customers/), so rows are
// described by their reason only; studio refs and job inputs never leave the server.
import { AFFILIATE_JOB_KIND } from "../affiliate";
import { getBalance } from "../credits";
import { INBOX_JOB_KIND } from "../inbox";
import { AI_VIDEO_JOB_KIND } from "../video";
import type { Env } from "../types";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
});

export type EntryKind = "welcome" | "team" | "package" | "monthly" | "job" | "refund" | "studio" | "studio_refund";

interface LedgerRow {
  id: number;
  delta: number;
  reason: string;
  note: string | null;
  created_at: string;
  job_kind: string | null;
}

/** What the work was, from the job's kind (marketer kinds all start with "marketer"). */
function jobTitle(kind: string | null): string {
  if (kind === AFFILIATE_JOB_KIND) return "คลิปรีวิวสินค้า";
  if (kind === AI_VIDEO_JOB_KIND) return "วิดีโอ AI";
  if (kind === INBOX_JOB_KIND) return "ตอบข้อความลูกค้า";
  if (kind?.startsWith("marketer")) return "นักการตลาด AI";
  return "งาน AI";
}

/** A ledger row in member words. Exported for tests. */
export function describeEntry(row: Pick<LedgerRow, "reason" | "note" | "delta" | "job_kind">): { kind: EntryKind; title: string } {
  switch (row.reason) {
    case "grant":
      if (row.note === "signup_bonus") return { kind: "welcome", title: "เครดิตต้อนรับสมาชิกใหม่" };
      return { kind: "team", title: row.delta < 0 ? "ทีมงานปรับลดเครดิต" : "ทีมงานเพิ่มเครดิตให้" };
    case "purchase":
      if (row.note === "เครดิตประจำเดือน") return { kind: "monthly", title: "เครดิตประจำเดือนตามแพ็กเกจ" };
      return { kind: "package", title: "เติมเครดิตจากการซื้อแพ็กเกจ" };
    case "job_hold":
      return { kind: "job", title: jobTitle(row.job_kind) };
    case "job_refund":
      return { kind: "refund", title: "คืนเครดิต: " + jobTitle(row.job_kind) + " ไม่สำเร็จ" };
    case "studio_hold":
      return { kind: "studio", title: "ใช้งานใน Naka Studio" };
    case "studio_refund":
      return { kind: "studio_refund", title: "คืนเครดิต: งานใน Naka Studio ไม่สำเร็จ" };
    default:
      return { kind: "team", title: row.delta < 0 ? "หักเครดิต" : "เพิ่มเครดิต" };
  }
}

/** Called after requireUser; only the signed-in member's rows are read. */
export async function handleMemberCredits(request: Request, env: Env, url: URL, userId: string): Promise<Response | null> {
  if (url.pathname !== "/api/me/credits") return null;
  if (request.method !== "GET") return json({ error: "วิธีเรียกใช้งานไม่ถูกต้อง" }, 405);

  const beforeRaw = url.searchParams.get("before");
  const before = beforeRaw === null ? null : Number(beforeRaw);
  if (before !== null && (!/^\d{1,15}$/.test(beforeRaw ?? "") || !Number.isSafeInteger(before))) {
    return json({ error: "ตำแหน่งรายการไม่ถูกต้อง" }, 400);
  }
  const limitRaw = Number(url.searchParams.get("limit") ?? DEFAULT_LIMIT);
  const limit = Number.isInteger(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, MAX_LIMIT) : DEFAULT_LIMIT;

  try {
    const { results } = await env.DB.prepare(
      `SELECT l.id, l.delta, l.reason, l.note, l.created_at, j.kind AS job_kind
       FROM credit_ledger l
       LEFT JOIN jobs j ON j.id = l.job_id AND j.user_id = l.user_id AND l.reason IN ('job_hold', 'job_refund')
       WHERE l.user_id = ?1${before === null ? "" : " AND l.id < ?3"}
       ORDER BY l.id DESC LIMIT ?2`,
    ).bind(userId, limit + 1, ...(before === null ? [] : [before])).all<LedgerRow>();
    const rows = results.slice(0, limit);

    // Same "active" rule as /api/billing/me: an expired row the cron has not closed yet is not a package.
    const sub = await env.DB.prepare(
      `SELECT p.name, s.billing_period, s.expires_at, s.next_credit_at
       FROM subscriptions s JOIN plans p ON p.id = s.plan_id
       WHERE s.user_id = ? AND s.status = 'active' AND (s.expires_at IS NULL OR s.expires_at > ?)`,
    ).bind(userId, Math.floor(Date.now() / 1000))
      .first<{ name: string; billing_period: string | null; expires_at: number | null; next_credit_at: number | null }>();

    return json({
      balance: await getBalance(env.DB, userId),
      plan: sub ? {
        name: sub.name,
        period: sub.billing_period === "yearly" || sub.billing_period === "monthly" ? sub.billing_period : null,
        expiresAt: sub.expires_at,
        // A top-up after the package ends never happens, so it is not promised.
        nextCreditAt: sub.next_credit_at !== null && (sub.expires_at === null || sub.next_credit_at < sub.expires_at) ? sub.next_credit_at : null,
      } : null,
      entries: rows.map((row) => ({ id: row.id, delta: row.delta, ...describeEntry(row), createdAt: row.created_at })),
      next: results.length > limit ? rows[rows.length - 1].id : null,
    });
  } catch {
    return json({ error: "โหลดประวัติเครดิตไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }, 500);
  }
}
