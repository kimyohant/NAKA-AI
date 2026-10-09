/**
 * Social read limits, pause backoff, reconnect-needed, and token refresh
 * (ticket 08). Shared by the poller (reads) and the send paths in actions.ts
 * (a `rate_limited` send pauses the same way). Pause state lives on the
 * social_accounts row (`paused_until`, `backoff_step`) — no Redis.
 */
import { eq } from 'drizzle-orm'
import { db, schema } from '../../../core/db/index.js'
import { now } from '../../../core/http/response.js'
import type { SocialAccountAuth, SocialPlatformAdapter, SocialTokens } from './types.js'

export const MAX_READ_CALLS_PER_ACCOUNT = 30
export const MAX_COMMENT_PAGES_PER_POST = 10
/** The post list is fetched once per hour, not every round. */
export const POSTS_CACHE_TTL_MS = 3600_000
/** Refresh a token expiring within this long before an adapter call. */
export const TOKEN_REFRESH_BEFORE_MS = 10 * 60_000
const BASE_PAUSE_MS = 15 * 60_000
const MAX_PAUSE_MS = 3600_000

type AccountRow = typeof schema.socialAccounts.$inferSelect

export function toAuth(account: AccountRow): SocialAccountAuth {
  return {
    platformAccountId: account.platformAccountId,
    accessToken: account.accessToken ?? '',
    refreshToken: account.refreshToken ?? undefined,
  }
}

export function isPaused(
  account: Pick<AccountRow, 'pausedUntil'>,
  nowMs: number = Date.now(),
): boolean {
  if (!account.pausedUntil) return false
  return Date.parse(account.pausedUntil) > nowMs
}

/**
 * Pause duration for a step: `retryAfterSec` wins when the Platform gives it,
 * otherwise 15 minutes doubling each step, capped at 1 hour.
 */
export function backoffDelayMs(step: number, retryAfterSec?: number): number {
  if (retryAfterSec != null && Number.isFinite(retryAfterSec) && retryAfterSec >= 0) {
    return Math.round(retryAfterSec * 1000)
  }
  return Math.min(BASE_PAUSE_MS * 2 ** Math.max(0, step), MAX_PAUSE_MS)
}

/** Pause one account only; the others keep working. Returns the new `paused_until`. */
export async function pauseAccount(accountId: number, retryAfterSec?: number, nowMs: number = Date.now()): Promise<string> {
  const [account] = await db.select({ backoffStep: schema.socialAccounts.backoffStep })
    .from(schema.socialAccounts).where(eq(schema.socialAccounts.id, accountId))
  const step = account?.backoffStep ?? 0
  const pausedUntil = new Date(nowMs + backoffDelayMs(step, retryAfterSec)).toISOString()
  await db.update(schema.socialAccounts)
    .set({ pausedUntil, backoffStep: step + 1, updatedAt: now() })
    .where(eq(schema.socialAccounts.id, accountId))
  return pausedUntil
}

/** The permission is gone: later rounds skip this account until reconnect. */
export async function markReconnectNeeded(accountId: number): Promise<void> {
  await db.update(schema.socialAccounts)
    .set({ status: 'reconnect_needed', updatedAt: now() })
    .where(eq(schema.socialAccounts.id, accountId))
}

/** A round that finishes without a rate-limit error resets the step. */
export async function resetBackoff(accountId: number): Promise<void> {
  await db.update(schema.socialAccounts)
    .set({ backoffStep: 0, updatedAt: now() })
    .where(eq(schema.socialAccounts.id, accountId))
}

export async function setLastPolled(accountId: number): Promise<void> {
  const ts = now()
  await db.update(schema.socialAccounts)
    .set({ lastPolledAt: ts, updatedAt: ts })
    .where(eq(schema.socialAccounts.id, accountId))
}

/**
 * Before an adapter call: when the stored token expires within 10 minutes and
 * the adapter has `refreshToken`, refresh first and store the new tokens.
 * (Facebook has none; the rule is for later Platforms.) A failed refresh
 * marks reconnect-needed and returns `{ ok: false }` — skip the account.
 */
export async function ensureFreshToken(
  account: AccountRow,
  adapter: Pick<SocialPlatformAdapter, 'refreshToken'>,
  nowMs: number = Date.now(),
): Promise<{ ok: true; auth: SocialAccountAuth } | { ok: false }> {
  const expires = account.tokenExpiresAt ? Date.parse(account.tokenExpiresAt) : NaN
  if (!adapter.refreshToken || !Number.isFinite(expires) || expires - nowMs >= TOKEN_REFRESH_BEFORE_MS) {
    return { ok: true, auth: toAuth(account) }
  }
  let tokens: SocialTokens
  try {
    tokens = await adapter.refreshToken(toAuth(account))
  } catch {
    await markReconnectNeeded(account.id)
    return { ok: false }
  }
  const ts = now()
  await db.update(schema.socialAccounts).set({
    accessToken: tokens.accessToken,
    ...(tokens.refreshToken !== undefined ? { refreshToken: tokens.refreshToken } : {}),
    ...(tokens.expiresAt ? { tokenExpiresAt: tokens.expiresAt.toISOString() } : {}),
    updatedAt: ts,
  } as Partial<AccountRow>).where(eq(schema.socialAccounts.id, account.id))
  const [fresh] = await db.select().from(schema.socialAccounts)
    .where(eq(schema.socialAccounts.id, account.id))
  return { ok: true, auth: toAuth(fresh ?? account) }
}
