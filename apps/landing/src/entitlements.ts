// What a member may use (docs/entitlements.md). The rules live in SQL (migrations/pg/0003_entitlements.sql:
// member_features / use_feature / release_feature) so the studio, which calls the same functions, gets the
// same answer. This module adds the landing's system-wide switches on top: a FEATURE_* switched off in
// /admin/system/ closes that area for everyone, whatever the member's plan says.
import type { Env } from "./types";
import { featureOn } from "./system/store";

export type FeatureKey =
  | "landing.clips" | "landing.marketer" | "landing.ai_video" | "landing.social" | "landing.inbox"
  | "studio.drama" | "studio.marketer" | "studio.seller" | "studio.product_studio" | "studio.viral_clone"
  | "studio.live" | "studio.video";

/** The /admin/system/ switch that closes a landing feature for every member. */
const SYSTEM_SWITCH: Partial<Record<FeatureKey, `FEATURE_${string}`>> = {
  "landing.clips": "FEATURE_CLIPS",
  "landing.marketer": "FEATURE_MARKETER",
  "landing.ai_video": "FEATURE_MARKETER", // AI video lives inside the marketer menu
  "landing.social": "FEATURE_SOCIAL",
  "landing.inbox": "FEATURE_INBOX",
};

export interface MemberFeature {
  key: FeatureKey;
  app: "landing" | "studio";
  label: string;
  quotaUnit: string | null;
  enabled: boolean;
  /** null = unlimited (or a feature without a quota) */
  monthlyLimit: number | null;
  used: number;
  /** where `enabled` came from; 'system' when a system-wide switch closed it */
  source: "override" | "plan" | "none" | "system";
}

interface Row {
  feature_key: FeatureKey; app: "landing" | "studio"; label: string; quota_unit: string | null;
  enabled: number | boolean; monthly_limit: number | null; used: number; source: "override" | "plan" | "none";
}

function systemClosed(env: Env, key: FeatureKey): boolean {
  const flag = SYSTEM_SWITCH[key];
  return !!flag && !featureOn(env, flag);
}

export async function memberFeatures(env: Env, userId: string): Promise<MemberFeature[]> {
  const { results } = await env.DB.prepare(
    "SELECT feature_key, app, label, quota_unit, enabled, monthly_limit, used, source FROM member_features(?)",
  ).bind(userId).all<Row>();
  return results.map((r) => {
    const closed = !!r.enabled && systemClosed(env, r.feature_key);
    return {
      key: r.feature_key, app: r.app, label: r.label, quotaUnit: r.quota_unit,
      enabled: !!r.enabled && !closed, monthlyLimit: r.monthly_limit, used: r.used,
      source: closed ? "system" : r.source,
    };
  });
}

export async function hasFeature(env: Env, userId: string, key: FeatureKey): Promise<boolean> {
  if (systemClosed(env, key)) return false;
  const row = await env.DB.prepare("SELECT enabled FROM member_features(?) WHERE feature_key = ?")
    .bind(userId, key).first<{ enabled: number | boolean }>();
  return !!row?.enabled;
}

export type UseResult =
  | { ok: true; used: number; monthlyLimit: number | null; period: string }
  | { ok: false; reason: "disabled" | "quota"; used: number | null; monthlyLimit: number | null; period: string };

/**
 * Count `amount` uses of a feature this month, or refuse without counting. Call it before the work starts;
 * if the work then cannot start (no credits, too many jobs), give the use back with releaseFeature.
 */
export async function useFeature(env: Env, userId: string, key: FeatureKey, amount = 1): Promise<UseResult> {
  // never count a feature that is closed for everyone
  if (systemClosed(env, key)) return { ok: false, reason: "disabled", used: null, monthlyLimit: null, period: "" };
  const row = await env.DB.prepare("SELECT ok, reason, used, monthly_limit, period FROM use_feature(?, ?, ?)")
    .bind(userId, key, amount)
    .first<{ ok: number | boolean; reason: "disabled" | "quota" | null; used: number | null; monthly_limit: number | null; period: string }>();
  if (!row) throw new Error("use_feature returned no row");
  return row.ok
    ? { ok: true, used: row.used ?? 0, monthlyLimit: row.monthly_limit, period: row.period }
    : { ok: false, reason: row.reason ?? "disabled", used: row.used, monthlyLimit: row.monthly_limit, period: row.period };
}

export async function releaseFeature(env: Env, userId: string, key: FeatureKey, amount: number, period: string): Promise<void> {
  await env.DB.prepare("SELECT release_feature(?, ?, ?, ?) AS used").bind(userId, key, amount, period).first();
}

/** The customer-facing answer for a refused use: 403 when the plan does not include it, 429 when the month is used up. */
export function featureRefusal(result: { reason: "disabled" | "quota"; used?: number | null; monthlyLimit?: number | null }, label: string): Response {
  const body = result.reason === "quota"
    ? { error: `ใช้${label}ครบ ${result.monthlyLimit} ครั้งของเดือนนี้แล้ว อัปเกรดแพ็กเกจหรือรอเดือนหน้า`, reason: "feature_quota",
        used: result.used, limit: result.monthlyLimit }
    : { error: `แพ็กเกจของคุณยังไม่รวม${label} อัปเกรดแพ็กเกจเพื่อใช้งาน`, reason: "feature_disabled" };
  return new Response(JSON.stringify(body), {
    status: result.reason === "quota" ? 429 : 403,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}
