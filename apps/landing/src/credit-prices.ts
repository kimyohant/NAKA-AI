// What each piece of work costs in credits (migrations/pg/0006_credit_prices.sql, docs/credit-pricing.md).
// The owner sets the prices in /admin/system/ (ราคาเครดิต); the landing reads them when it queues a job,
// and Naka Studio reads the same table for its image and video tasks.

export type PriceKey = "studio.video" | "studio.image" | "landing.ai_video" | "landing.clips" | "landing.marketer";

export interface CreditPrice {
  key: string;
  app: "landing" | "studio";
  label: string;
  unitLabel: string;
  credits: number;
  perSecond: boolean;
  allowPerSecond: boolean;
  updatedAt: number;
  actor: string;
}

export class PriceAdminError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

const MAX_CREDITS = 1000;
const now = () => Math.floor(Date.now() / 1000);

/** Whole credits for one piece of work: credits × seconds when priced per second, rounded up. 0 = free. */
export function creditsFor(price: Pick<CreditPrice, "credits" | "perSecond">, seconds?: number): number {
  const units = price.perSecond ? Math.max(1, Math.ceil(Number(seconds) || 0)) : 1;
  // round the product to cents first, so 0.1 × 30 is 3, not 3.0000000000000004 → 4
  return Math.ceil(Math.round(price.credits * units * 100) / 100);
}

export async function listPrices(db: D1Database): Promise<CreditPrice[]> {
  const { results } = await db.prepare(`SELECT key, app, label, unit_label AS "unitLabel", credits, per_second AS "perSecond",
      allow_per_second AS "allowPerSecond", updated_at AS "updatedAt", actor
    FROM credit_prices ORDER BY sort_order, key`).all<CreditPrice>();
  return results.map((p) => ({ ...p, credits: Number(p.credits), perSecond: !!p.perSecond, allowPerSecond: !!p.allowPerSecond }));
}

/**
 * The credits a landing job costs now. `fallback` is what the job cost before prices were editable, used
 * only when the row is missing (a database the migration has not reached).
 */
export async function priceOf(db: D1Database, key: PriceKey, fallback: number): Promise<number> {
  const row = await db.prepare("SELECT credits, per_second FROM credit_prices WHERE key = ?").bind(key)
    .first<{ credits: number; per_second: number }>();
  return row ? creditsFor({ credits: Number(row.credits), perSecond: !!row.per_second }) : fallback;
}

/**
 * Change one price: { credits, perSecond?, note }. Compare-and-set on the current values, with the audit row
 * (system_audit area 'price') written by the same statement, so two admins cannot silently overwrite each other.
 */
export async function setPrice(db: D1Database, key: string, input: Record<string, unknown>, note: string, who: string): Promise<void> {
  const current = (await listPrices(db)).find((p) => p.key === key);
  if (!current) throw new PriceAdminError(404, "ไม่พบรายการราคานี้");
  const credits = input.credits;
  if (typeof credits !== "number" || !Number.isFinite(credits) || credits < 0 || credits > MAX_CREDITS || Math.round(credits * 100) !== credits * 100) {
    throw new PriceAdminError(400, `เครดิตต้องเป็นตัวเลข 0 ถึง ${MAX_CREDITS} (ทศนิยมได้ 2 ตำแหน่ง)`);
  }
  const perSecond = input.perSecond === undefined ? current.perSecond : input.perSecond;
  if (typeof perSecond !== "boolean") throw new PriceAdminError(400, "รูปแบบการคิดเครดิตไม่ถูกต้อง");
  if (perSecond && !current.allowPerSecond) throw new PriceAdminError(400, `${current.label} คิดต่อวินาทีไม่ได้`);
  if (!perSecond && credits !== Math.floor(credits)) throw new PriceAdminError(400, "ราคาต่อชิ้นต้องเป็นจำนวนเต็ม (ทศนิยมใช้ได้เฉพาะแบบคิดต่อวินาที)");

  const before = { credits: current.credits, perSecond: current.perSecond };
  const after = { credits, perSecond };
  const t = now();
  const changed = await db.prepare(`WITH changed AS (
      UPDATE credit_prices SET credits = ?1, per_second = (?2 = 1), updated_at = ?3, actor = ?4
      WHERE key = ?5 AND credits = ?6 AND per_second = (?7 = 1) RETURNING key)
    INSERT INTO system_audit (id, area, target, action, detail, note, actor, created_at)
      SELECT ?8, 'price', ?5, 'update', ?9, ?10, ?4, ?3 FROM changed`)
    .bind(credits, perSecond ? 1 : 0, t, who, key, current.credits, current.perSecond ? 1 : 0, crypto.randomUUID(), JSON.stringify({ before, after }), note)
    .run();
  if (!changed.meta.changes) throw new PriceAdminError(409, "ราคานี้เพิ่งถูกแก้ กรุณาโหลดหน้าใหม่");
}
