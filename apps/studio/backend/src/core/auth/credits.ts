/**
 * Naka Studio charges the member's naka-ai credits for image and video tasks (docs/credit-pricing.md at the repo root).
 *
 * The prices are not stored here: the owner sets them in naka-ai's /admin/system/ (account.credit_prices, granted to
 * studio_app). A task holds its credits in the same transaction that creates it (account.hold_credits, 0002_shared.sql),
 * so a refused hold leaves no task; the hold is committed when the task completes and refunded when it fails or is
 * cancelled. A task whose provider state is unknown keeps its hold until it resumes, is cancelled or is deleted.
 *
 * Charged only like the quotas (entitlements.ts): naka-ai members under SSO, never admins or single-user rows, and
 * off with NAKA_ENTITLEMENTS=off or NAKA_CREDITS=off (a studio not attached to the shared database).
 */
import { eq, sql } from 'drizzle-orm'
import { db, rawQuery, schema } from '../db/index.js'
import { AppError } from '../http/response.js'
import { entitlementsOn, isStudioAdmin } from './entitlements.js'
import { LOCAL_OWNER, ownerScope } from './owner-context.js'

const ACCOUNT_SCHEMA = (process.env.ACCOUNT_SCHEMA || 'account').replace(/"/g, '')
const CACHE_MS = 15_000

export type PricedTask = 'image' | 'video'
export interface Price { credits: number; perSecond: boolean }

export const creditsOn = (): boolean => entitlementsOn() && process.env.NAKA_CREDITS !== 'off'

let cache: { at: number; prices: Map<string, Price> } | null = null
/** forget cached prices (tests; a price change otherwise applies within CACHE_MS) */
export function clearPriceCache(): void { cache = null }

async function studioPrices(): Promise<Map<string, Price>> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.prices
  const rows = await rawQuery(`SELECT key, credits, per_second FROM "${ACCOUNT_SCHEMA}".credit_prices WHERE app = 'studio'`)
  const prices = new Map(rows.map(r => [String(r.key), { credits: Number(r.credits), perSecond: r.per_second === true || r.per_second === 't' }]))
  cache = { at: Date.now(), prices }
  return prices
}

/** Whole credits for one task: credits × seconds when priced per second (at least 1 s), rounded up. Same rule as the landing. */
export function creditsFor(price: Price, seconds?: number): number {
  const units = price.perSecond ? Math.max(1, Math.ceil(Number(seconds) || 0)) : 1
  return Math.ceil(Math.round(price.credits * units * 100) / 100)
}

let missingLogged = false

/**
 * What a new task costs its owner, 0 when nothing is held (free, credits off, single-user rows, admins).
 * Never call inside an open db.transaction: PGlite has one connection.
 */
export async function taskCredits(owner: string | null | undefined, type: PricedTask, durationSec?: number): Promise<number> {
  if (!creditsOn() || !owner || owner === LOCAL_OWNER) return 0
  if (ownerScope()?.admin || await isStudioAdmin(owner)) return 0
  let price: Price | undefined
  try {
    price = (await studioPrices()).get(type === 'video' ? 'studio.video' : 'studio.image')
  } catch (err: any) {
    // like the entitlement guard: no answer from the account side means no new paid work
    console.error('credits: account.credit_prices unavailable:', err?.message)
    throw new AppError('ตรวจเครดิตไม่ได้ชั่วคราว กรุณาลองใหม่', 'E_CREDITS_UNAVAILABLE')
  }
  if (!price) {
    if (!missingLogged) { console.error(`credits: no ${type} price in ${ACCOUNT_SCHEMA}.credit_prices; charging nothing`); missingLogged = true }
    return 0
  }
  return creditsFor(price, durationSec)
}

const rowsOf = (result: any): any[] => (Array.isArray(result) ? result : result?.rows ?? [])

/**
 * Hold `amount` credits for a task inside the transaction that creates it; returns the hold id (the ledger row).
 * Not enough credits → AppError E_CREDITS_INSUFFICIENT, and the caller's transaction (the task insert) rolls back.
 */
export async function holdTaskCredits(tx: { execute: (query: any) => Promise<any> }, owner: string, amount: number, ref: string): Promise<number> {
  const result = await tx.execute(sql`SELECT ok, hold_id, balance FROM ${sql.identifier(ACCOUNT_SCHEMA)}.hold_credits(${owner}, ${amount}, ${ref})`)
  const row = rowsOf(result)[0]
  if (row?.ok === true || row?.ok === 't') return Number(row.hold_id)
  throw new AppError(
    `เครดิตไม่พอ งานนี้ใช้ ${amount} เครดิต แต่เหลือ ${Number(row?.balance ?? 0)} เครดิต เติมเครดิตหรือต่อแพ็กเกจได้ที่ naka-ai.com`,
    'E_CREDITS_INSUFFICIENT',
  )
}

/**
 * Settle a task's hold: 'commit' when it produced its result, 'refund' when it failed, was cancelled or deleted.
 * Both are idempotent on the account side, and a task without a hold is a no-op. A failure is logged, never thrown:
 * the task's own state is already final, and the hold stays visible in account.credit_holds for an admin to settle.
 */
export async function settleTaskCredits(taskId: number, outcome: 'commit' | 'refund'): Promise<void> {
  try {
    const [task] = await db.select({ hold: schema.sysTask.creditHoldId }).from(schema.sysTask).where(eq(schema.sysTask.id, taskId))
    if (!task?.hold) return
    const fn = outcome === 'commit' ? 'commit_hold' : 'refund_hold'
    await rawQuery(`SELECT "${ACCOUNT_SCHEMA}".${fn}($1) AS status`, [task.hold])
  } catch (err: any) {
    console.error(`credits: ${outcome} for task ${taskId} failed:`, err?.message)
  }
}
