// Admin side of member features (docs/entitlements.md): which features each plan includes (with a monthly
// limit), and per-member overrides with a reason and an optional end date. Every change is audited in the
// same transaction: plans in system_audit (area 'plan'), members in admin_audit (action 'feature').
import type { Env } from '../types';
import { memberFeatures } from '../entitlements';

export class FeatureAdminError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

const DAY = 86400;
const MAX_LIMIT = 100_000;
const now = () => Math.floor(Date.now() / 1000);

export interface FeatureDef { key: string; app: 'landing' | 'studio'; label: string; quotaUnit: string | null }

export async function featureCatalog(env: Env): Promise<FeatureDef[]> {
  const { results } = await env.DB.prepare('SELECT key, app, label, quota_unit AS "quotaUnit" FROM features ORDER BY sort_order, key').all<FeatureDef>();
  return results;
}

function limitOf(value: unknown, def: FeatureDef): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (!def.quotaUnit) throw new FeatureAdminError(400, `${def.label} ไม่มีโควตารายเดือน`);
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > MAX_LIMIT) {
    throw new FeatureAdminError(400, `โควตาของ${def.label}ต้องเป็นจำนวนเต็ม 0 ถึง ${MAX_LIMIT} (ว่าง = ไม่จำกัด)`);
  }
  return value;
}

// ---------- plans ----------

/** plan id → { feature key → monthly limit (null = unlimited) }, for every plan that includes something. */
export async function planFeatureMap(env: Env): Promise<Record<string, Record<string, number | null>>> {
  const { results } = await env.DB.prepare('SELECT plan_id, feature_key, monthly_limit FROM plan_features ORDER BY plan_id, feature_key')
    .all<{ plan_id: string; feature_key: string; monthly_limit: number | null }>();
  const map: Record<string, Record<string, number | null>> = {};
  for (const r of results) (map[r.plan_id] ??= {})[r.feature_key] = r.monthly_limit;
  return map;
}

/**
 * Replace what a plan includes. `features` lists every included feature: { key: { limit: number | null } }.
 * Members on the plan see the change on their next request (the studio as well — it reads the same tables).
 */
export async function setPlanFeatures(env: Env, planId: string, input: Record<string, unknown>, note: string, who: string): Promise<void> {
  if (!await env.DB.prepare('SELECT id FROM plans WHERE id = ?').bind(planId).first()) throw new FeatureAdminError(404, 'ไม่พบแพ็กเกจนี้');
  const raw = input.features;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new FeatureAdminError(400, 'กรุณาส่งรายการฟีเจอร์ของแพ็กเกจ');
  const catalog = new Map((await featureCatalog(env)).map(f => [f.key, f]));
  const after: Record<string, number | null> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const def = catalog.get(key);
    if (!def) throw new FeatureAdminError(400, `ไม่รู้จักฟีเจอร์ ${key}`);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new FeatureAdminError(400, `ข้อมูลของ${def.label}ไม่ถูกต้อง`);
    after[key] = limitOf((value as Record<string, unknown>).limit, def);
  }
  const before = (await planFeatureMap(env))[planId] ?? {};
  const keys = Object.keys(after);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM plan_features WHERE plan_id = ?').bind(planId),
    ...keys.map(key => env.DB.prepare('INSERT INTO plan_features (plan_id, feature_key, monthly_limit) VALUES (?, ?, ?)').bind(planId, key, after[key])),
    env.DB.prepare(`INSERT INTO system_audit (id, area, target, action, detail, note, actor, created_at) VALUES (?, 'plan', ?, 'update', ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), planId, JSON.stringify({ features: { before, after } }), note, who, now()),
  ]);
}

// ---------- members ----------

export interface OverrideRow { featureKey: string; enabled: boolean; monthlyLimit: number | null; expiresAt: number | null; note: string; actor: string; updatedAt: number }

/** What the member may use now, plus the overrides an admin set (expired ones included, marked by expiresAt). */
export async function customerFeatures(env: Env, userId: string) {
  const [features, overrides] = await Promise.all([
    memberFeatures(env, userId),
    env.DB.prepare(`SELECT feature_key AS "featureKey", enabled, monthly_limit AS "monthlyLimit", expires_at AS "expiresAt",
      note, actor, updated_at AS "updatedAt" FROM user_features WHERE user_id = ? ORDER BY feature_key`).bind(userId).all<OverrideRow>(),
  ]);
  return { features, overrides: overrides.results.map(o => ({ ...o, enabled: !!o.enabled })) };
}

/**
 * One member, one feature. mode 'plan' removes the override (back to the plan); 'on'/'off' sets it, with an
 * optional monthly limit (on only; empty = the plan's limit) and an optional end in days (1–365).
 * The audit row carries the override before and after; the override is written only if the audit row was.
 */
export async function setCustomerFeature(env: Env, userId: string, input: Record<string, unknown>, note: string, who: string): Promise<string> {
  const key = typeof input.feature === 'string' ? input.feature : '';
  const def = (await featureCatalog(env)).find(f => f.key === key);
  if (!def) throw new FeatureAdminError(400, 'กรุณาเลือกฟีเจอร์');
  const mode = input.mode;
  if (mode !== 'plan' && mode !== 'on' && mode !== 'off') throw new FeatureAdminError(400, 'เลือก ตามแพ็กเกจ / เปิด / ปิด');
  const limit = mode === 'on' ? limitOf(input.monthlyLimit, def) : null;
  let expiresAt: number | null = null;
  if (mode !== 'plan' && input.days !== undefined && input.days !== null && input.days !== '') {
    if (typeof input.days !== 'number' || !Number.isInteger(input.days) || input.days < 1 || input.days > 365) {
      throw new FeatureAdminError(400, 'จำนวนวันต้องเป็น 1 ถึง 365 (ว่าง = ไม่มีวันหมดอายุ)');
    }
    expiresAt = now() + input.days * DAY;
  }
  if (!await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(userId).first()) throw new FeatureAdminError(404, 'ไม่พบลูกค้านี้');
  const id = crypto.randomUUID();
  const t = now();
  const after = mode === 'plan' ? null : { enabled: mode === 'on', monthlyLimit: limit, expiresAt };
  const audit = env.DB.prepare(`INSERT INTO admin_audit (id, user_id, action, detail, note, actor, created_at)
    SELECT ?1, ?2, 'feature', jsonb_build_object('feature', ?3::text, 'before',
      (SELECT jsonb_build_object('enabled', enabled, 'monthlyLimit', monthly_limit, 'expiresAt', expires_at)
         FROM user_features WHERE user_id = ?2 AND feature_key = ?3),
      'after', ?4::jsonb)::text, ?5, ?6, ?7`)
    .bind(id, userId, key, JSON.stringify(after), note, who, t);
  const write = after
    ? env.DB.prepare(`INSERT INTO user_features (user_id, feature_key, enabled, monthly_limit, expires_at, note, actor, updated_at)
        SELECT ?, ?, ? = 1, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM admin_audit WHERE id = ?)
        ON CONFLICT (user_id, feature_key) DO UPDATE SET enabled = excluded.enabled, monthly_limit = excluded.monthly_limit,
          expires_at = excluded.expires_at, note = excluded.note, actor = excluded.actor, updated_at = excluded.updated_at`)
        .bind(userId, key, after.enabled ? 1 : 0, limit, expiresAt, note, who, t, id)
    : env.DB.prepare('DELETE FROM user_features WHERE user_id = ? AND feature_key = ? AND EXISTS (SELECT 1 FROM admin_audit WHERE id = ?)')
        .bind(userId, key, id);
  const [written] = await env.DB.batch([audit, write]);
  if (written.meta.changes !== 1) throw new FeatureAdminError(409, 'ข้อมูลลูกค้าเปลี่ยนแล้ว กรุณาโหลดใหม่');
  return id;
}
