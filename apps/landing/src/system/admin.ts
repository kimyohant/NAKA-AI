// /api/admin/system/* — the system control panel's API. The router checks ADMIN_TOKEN first and passes
// the Worker's own env (before withSettings), so "where does this value come from" can be answered.
import type { Env } from '../types';
import type { AdminActor } from '../admin/auth';
import { constantTimeEqual, readBodyBytes } from '../auth/common';
import { LOCKED, normalizeSetting, secretHint, SETTING_BY_KEY, SETTINGS, type SettingDef } from './registry';
import { FeatureAdminError, featureCatalog, planFeatureMap, setPlanFeatures } from '../admin/features';
import { decryptSetting, encryptSetting, invalidateSettings, settingsKeyReady, type StoredRow } from './store';

const BASE = '/api/admin/system';
const now = () => Math.floor(Date.now() / 1000);
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});
class SystemError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

async function body(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new SystemError(400, 'กรุณาส่งข้อมูลเป็น JSON');
  const bytes = await readBodyBytes(request, 8192);
  if (bytes === null) throw new SystemError(413, 'ข้อมูลต้องไม่เกิน 8 KB');
  try {
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch { throw new SystemError(400, 'ข้อมูลไม่ถูกต้อง'); }
}

function note(input: Record<string, unknown>): string {
  if (input.note === undefined || input.note === null) return '';
  if (typeof input.note !== 'string' || input.note.trim().length > 200) throw new SystemError(400, 'หมายเหตุต้องไม่เกิน 200 ตัวอักษร');
  return input.note.trim();
}

const audit = (env: Env, who: string, area: 'setting' | 'plan', target: string, action: string, detail: unknown, text: string) =>
  env.DB.prepare('INSERT INTO system_audit (id, area, target, action, detail, note, actor, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), area, target, action, JSON.stringify(detail), text, who, now());

function workerValue(env: Env, key: string): string {
  const value = (env as unknown as Record<string, unknown>)[key];
  return typeof value === 'string' ? value.trim() : '';
}

// ---------- settings ----------

async function storedRows(env: Env): Promise<Map<string, StoredRow>> {
  const { results } = await env.DB.prepare('SELECT key, value, secret, hint, updated_at FROM system_settings').all<StoredRow>();
  return new Map(results.map(row => [row.key, row]));
}

/** What the panel shows for one key. Secret values never leave the Worker, only whether one is set and its hint. */
async function view(env: Env, def: SettingDef, row: StoredRow | undefined) {
  const fromWorker = workerValue(env, def.key);
  const source = row ? 'panel' : fromWorker ? 'cloudflare' : def.default !== undefined ? 'default' : 'unset';
  const base = { key: def.key, group: def.group, kind: def.kind, label: def.label, help: def.help ?? null,
    options: def.options ?? null, source, updatedAt: row?.updated_at ?? null };
  if (def.kind !== 'secret') return { ...base, value: row?.value ?? (fromWorker || def.default || '') };
  let readable = true;
  if (row) { try { await decryptSetting(env, def.key, row.value); } catch { readable = false; } }
  return { ...base, set: !!row || !!fromWorker, hint: row ? row.hint : fromWorker ? secretHint(fromWorker) : null, readable };
}

async function settingsResponse(env: Env): Promise<Response> {
  const rows = await storedRows(env);
  return json({
    keyReady: settingsKeyReady(env),
    settings: await Promise.all(SETTINGS.map(def => view(env, def, rows.get(def.key)))),
    locked: LOCKED.map(item => ({ key: item.key, label: item.label,
      set: item.binding ? !!(env as unknown as Record<string, unknown>)[item.key] : item.key === 'SETTINGS_KEY' ? settingsKeyReady(env) : !!workerValue(env, item.key) })),
  });
}

async function storedValue(env: Env, def: SettingDef, value: string): Promise<{ value: string; secret: number; hint: string | null }> {
  if (def.kind !== 'secret') return { value, secret: 0, hint: null };
  if (!settingsKeyReady(env)) throw new SystemError(503, 'ยังไม่ได้ตั้ง SETTINGS_KEY จึงยังบันทึกค่าลับไม่ได้ (ดูวิธีตั้งด้านบนของหน้า)');
  return { value: await encryptSetting(env, def.key, value), secret: 1, hint: secretHint(value) };
}
// Audit detail: the value itself for plain settings, only a hint for secrets.
const shown = (def: SettingDef, value: string | null, hint: string | null) =>
  def.kind === 'secret' ? (value === null ? null : { hint }) : value;

async function setSetting(request: Request, env: Env, def: SettingDef, who: string): Promise<Response> {
  const input = await body(request);
  const normalized = normalizeSetting(def, input.value);
  if ('error' in normalized) throw new SystemError(400, normalized.error);
  const text = note(input);
  const before = (await storedRows(env)).get(def.key);
  const stored = await storedValue(env, def, normalized.value);
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO system_settings (key, value, secret, hint, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, secret = excluded.secret, hint = excluded.hint, updated_at = excluded.updated_at`)
      .bind(def.key, stored.value, stored.secret, stored.hint, now()),
    audit(env, who, 'setting', def.key, 'set', { before: before ? shown(def, before.value, before.hint) : null,
      after: shown(def, normalized.value, stored.hint) }, text),
  ]);
  invalidateSettings(env.DB);
  return settingsResponse(env);
}

async function clearSetting(env: Env, def: SettingDef, who: string): Promise<Response> {
  const before = (await storedRows(env)).get(def.key);
  if (!before) throw new SystemError(404, 'ค่านี้ไม่ได้ตั้งจากหลังร้าน');
  const [deleted] = await env.DB.batch([
    env.DB.prepare('DELETE FROM system_settings WHERE key = ? AND updated_at = ?').bind(def.key, before.updated_at),
    audit(env, who, 'setting', def.key, 'clear', { before: shown(def, before.value, before.hint) }, ''),
  ]);
  if (!deleted.meta.changes) throw new SystemError(409, 'ค่านี้เพิ่งถูกแก้ กรุณาโหลดหน้าใหม่');
  invalidateSettings(env.DB);
  return settingsResponse(env);
}

/** Copy every value the Worker has from wrangler vars/secrets into the panel, so wrangler no longer needs it. */
async function importSettings(env: Env, who: string): Promise<Response> {
  const rows = await storedRows(env);
  const imported: string[] = [];
  const skipped: { key: string; reason: string }[] = [];
  const statements: D1PreparedStatement[] = [];
  for (const def of SETTINGS) {
    const fromWorker = workerValue(env, def.key);
    if (rows.has(def.key) || !fromWorker) continue;
    const normalized = normalizeSetting(def, fromWorker);
    if ('error' in normalized) { skipped.push({ key: def.key, reason: normalized.error }); continue; }
    if (def.kind === 'secret' && !settingsKeyReady(env)) { skipped.push({ key: def.key, reason: 'ยังไม่ได้ตั้ง SETTINGS_KEY' }); continue; }
    const stored = await storedValue(env, def, normalized.value);
    // DO NOTHING keeps a value saved from the panel between our read and this write.
    statements.push(env.DB.prepare('INSERT INTO system_settings (key, value, secret, hint, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(key) DO NOTHING')
      .bind(def.key, stored.value, stored.secret, stored.hint, now()));
    statements.push(audit(env, who, 'setting', def.key, 'import', { after: shown(def, normalized.value, stored.hint) }, 'ย้ายจาก Cloudflare'));
    imported.push(def.key);
  }
  if (statements.length) await env.DB.batch(statements);
  invalidateSettings(env.DB);
  const response = await (await settingsResponse(env)).json() as Record<string, unknown>;
  return json({ ...response, imported, skipped });
}

// ---------- plans ----------

interface PlanRow { id: string; name: string; monthly_credits: number; max_parallel_jobs: number; price_thb: number; on_sale: number }

async function plansResponse(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(`SELECT p.id, p.name, p.monthly_credits AS monthlyCredits, p.max_parallel_jobs AS parallelJobs,
    p.price_thb AS price, p.on_sale AS onSale,
    (SELECT COUNT(*) FROM subscriptions s WHERE s.plan_id = p.id AND s.status = 'active' AND (s.expires_at IS NULL OR s.expires_at > ?)) AS subscribers
    FROM plans p ORDER BY p.price_thb, p.id`).bind(now()).all<{ id: string; onSale: number }>();
  // what each plan includes (docs/entitlements.md): feature key → monthly limit, null = unlimited
  const [features, included] = await Promise.all([featureCatalog(env), planFeatureMap(env)]);
  return json({ plans: results.map(p => ({ ...p, onSale: p.onSale === 1, features: included[p.id] ?? {} })), features });
}

function int(input: Record<string, unknown>, field: string, label: string, min: number, max: number): number {
  const value = input[field];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw new SystemError(400, `${label}ต้องเป็นจำนวนเต็ม ${min} ถึง ${max}`);
  return value;
}

/** Plan fields from the request; a missing field keeps the current value. The free plan always costs 0. */
function planFields(input: Record<string, unknown>, current: PlanRow | null, id: string): Omit<PlanRow, 'id'> {
  const pick = <T>(field: string, read: () => T, fallback: T | undefined): T => {
    if (input[field] === undefined && fallback !== undefined) return fallback;
    return read();
  };
  const name = pick('name', () => {
    if (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 40) throw new SystemError(400, 'ชื่อแพ็กเกจต้องยาว 1 ถึง 40 ตัวอักษร');
    return input.name.trim();
  }, current?.name);
  const free = id === 'free';
  return {
    name,
    // Stripe charges at least 10 baht.
    price_thb: free ? 0 : pick('price', () => int(input, 'price', 'ราคา', 10, 100_000), current?.price_thb),
    monthly_credits: pick('monthlyCredits', () => int(input, 'monthlyCredits', 'เครดิตต่อเดือน', 0, 100_000), current?.monthly_credits),
    max_parallel_jobs: pick('parallelJobs', () => int(input, 'parallelJobs', 'จำนวนงานพร้อมกัน', 1, 20), current?.max_parallel_jobs),
    on_sale: free ? 1 : pick('onSale', () => {
      if (typeof input.onSale !== 'boolean') throw new SystemError(400, 'สถานะการขายต้องเป็น true หรือ false');
      return input.onSale ? 1 : 0;
    }, current?.on_sale),
  };
}

async function createPlan(request: Request, env: Env, who: string): Promise<Response> {
  const input = await body(request);
  if (typeof input.id !== 'string' || !/^[a-z][a-z0-9_-]{1,30}$/.test(input.id)) {
    throw new SystemError(400, 'รหัสแพ็กเกจใช้ a-z 0-9 _ - ยาว 2 ถึง 31 ตัว และขึ้นต้นด้วยตัวอักษร');
  }
  if (input.id === 'free') throw new SystemError(409, 'มีแพ็กเกจนี้แล้ว');
  const plan = planFields(input, null, input.id);
  // One statement: the audit row exists exactly when the plan row was created.
  const inserted = await env.DB.prepare(`WITH created AS (
      INSERT INTO plans (id, name, monthly_credits, max_parallel_jobs, price_thb, on_sale)
      SELECT ?1, ?2, ?3, ?4, ?5, ?6 WHERE NOT EXISTS (SELECT 1 FROM plans WHERE id = ?1) RETURNING id)
    INSERT INTO system_audit (id, area, target, action, detail, note, actor, created_at)
      SELECT ?7, 'plan', ?1, 'create', ?8, ?9, ?10, ?11 FROM created`)
    .bind(input.id, plan.name, plan.monthly_credits, plan.max_parallel_jobs, plan.price_thb, plan.on_sale,
      crypto.randomUUID(), JSON.stringify({ after: plan }), note(input), who, now())
    .run();
  if (!inserted.meta.changes) throw new SystemError(409, 'มีแพ็กเกจรหัสนี้แล้ว');
  return plansResponse(env);
}

async function updatePlan(request: Request, env: Env, id: string, who: string): Promise<Response> {
  const input = await body(request);
  const current = await env.DB.prepare('SELECT id, name, monthly_credits, max_parallel_jobs, price_thb, on_sale FROM plans WHERE id = ?').bind(id).first<PlanRow>();
  if (!current) throw new SystemError(404, 'ไม่พบแพ็กเกจนี้');
  const plan = planFields(input, current, id);
  const { id: _, ...before } = current;
  // Compare-and-set on every field: two admins editing at once cannot silently overwrite each other.
  const updated = await env.DB.prepare(`WITH changed AS (
      UPDATE plans SET name = ?1, monthly_credits = ?2, max_parallel_jobs = ?3, price_thb = ?4, on_sale = ?5
      WHERE id = ?6 AND name = ?7 AND monthly_credits = ?8 AND max_parallel_jobs = ?9 AND price_thb = ?10 AND on_sale = ?11
      RETURNING id)
    INSERT INTO system_audit (id, area, target, action, detail, note, actor, created_at)
      SELECT ?12, 'plan', ?6, 'update', ?13, ?14, ?15, ?16 FROM changed`)
    .bind(plan.name, plan.monthly_credits, plan.max_parallel_jobs, plan.price_thb, plan.on_sale,
      id, current.name, current.monthly_credits, current.max_parallel_jobs, current.price_thb, current.on_sale,
      crypto.randomUUID(), JSON.stringify({ before, after: plan }), note(input), who, now())
    .run();
  if (!updated.meta.changes) throw new SystemError(409, 'แพ็กเกจนี้เพิ่งถูกแก้ กรุณาโหลดหน้าใหม่');
  return plansResponse(env);
}

// ---------- router ----------

async function auditResponse(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(`SELECT id, area, target, action, detail, note, actor, created_at AS createdAt
    FROM system_audit ORDER BY created_at DESC, rowid DESC LIMIT 100`).all<{ detail: string }>();
  return json({ audit: results.map(row => ({ ...row, detail: JSON.parse(row.detail) })) });
}

/** `actor` comes from the shared router's checkAdmin(); mounted without it, only ADMIN_TOKEN gets in. */
export async function handleAdminSystem(request: Request, env: Env, url: URL, actor?: AdminActor): Promise<Response | null> {
  if (url.pathname !== BASE && !url.pathname.startsWith(BASE + '/')) return null;
  if (!actor) {
    if (!env.ADMIN_TOKEN || !constantTimeEqual(request.headers.get('Authorization') ?? '', `Bearer ${env.ADMIN_TOKEN}`)) return json({ error: 'unauthorized' }, 401);
    actor = { kind: 'token', label: 'โทเคนฉุกเฉิน', userId: null, role: 'owner' };
  }
  const who = actor.label;
  const path = url.pathname.slice(BASE.length);
  const method = request.method;
  try {
    if (path === '/settings' && method === 'GET') return await settingsResponse(env);
    if (path === '/settings/import' && method === 'POST') return await importSettings(env, who);
    const setting = path.match(/^\/settings\/([A-Z0-9_]{1,64})$/);
    if (setting) {
      const def = SETTING_BY_KEY.get(setting[1]);
      if (!def) throw new SystemError(404, 'ค่านี้แก้จากหลังร้านไม่ได้');
      if (method === 'PUT') return await setSetting(request, env, def, who);
      if (method === 'DELETE') return await clearSetting(env, def, who);
    }
    if (path === '/plans' && method === 'GET') return await plansResponse(env);
    if (path === '/plans' && method === 'POST') return await createPlan(request, env, who);
    const plan = path.match(/^\/plans\/([a-z][a-z0-9_-]{0,30})$/);
    if (plan && method === 'PUT') return await updatePlan(request, env, plan[1], who);
    const planFeatures = path.match(/^\/plans\/([a-z][a-z0-9_-]{0,30})\/features$/);
    if (planFeatures && method === 'PUT') {
      const input = await body(request);
      await setPlanFeatures(env, planFeatures[1], input, note(input), who);
      return await plansResponse(env);
    }
    if (path === '/audit' && method === 'GET') return await auditResponse(env);
    return json({ error: 'not found' }, 404);
  } catch (error) {
    if (error instanceof SystemError || error instanceof FeatureAdminError) return json({ error: error.message }, error.status);
    console.error('system admin error'); // no detail: requests here carry secrets
    return json({ error: 'internal error' }, 500);
  }
}
