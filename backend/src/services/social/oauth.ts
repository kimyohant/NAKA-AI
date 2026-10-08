/**
 * Account connection — OAuth `state` + pending Page list (ticket 10).
 *
 * In-memory only: a server restart drops both stores, so the user logs in
 * again. One login = one pending list; a second login never touches the
 * first login's list. No route built on this module ever returns a token.
 */
import { randomBytes } from 'node:crypto'
import { getSocialAdapter } from './registry.js'
import type { ConnectableAccount } from './types.js'

export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000
export const OAUTH_PENDING_TTL_MS = 10 * 60 * 1000

interface StateEntry {
  platform: string
  redirectUri: string
  expiresAt: number
}

interface PendingEntry {
  platform: string
  items: ConnectableAccount[]
  expiresAt: number
}

const states = new Map<string, StateEntry>()
const pendings = new Map<string, PendingEntry>()

const REQUIRED_ENV: Record<string, string[]> = {
  facebook: ['FACEBOOK_APP_ID', 'FACEBOOK_APP_SECRET'],
}

/** Hosted callback: PUBLIC_BASE_URL + /api/v1/social/oauth/<platform>/callback. */
export function callbackUrl(platform: string): string {
  const base = (process.env.PUBLIC_BASE_URL ?? '').replace(/\/+$/, '')
  return `${base}/api/v1/social/oauth/${platform.toLowerCase()}/callback`
}

/** "Can I Connect, and if not why" — no PUBLIC_BASE_URL or missing app credentials. */
export function canConnect(platform: string): { can: boolean; reason?: string } {
  if (!process.env.PUBLIC_BASE_URL) return { can: false, reason: 'PUBLIC_BASE_URL is not set' }
  for (const name of REQUIRED_ENV[platform.toLowerCase()] ?? []) {
    if (!process.env[name]) return { can: false, reason: `${name} is not set` }
  }
  return { can: true }
}

/** Start: random single-use 10-minute state, login URL from the adapter. */
export function startLogin(platform: string): { url: string; state: string } {
  const check = canConnect(platform)
  if (!check.can) throw new Error(`Cannot connect: ${check.reason}`)
  const adapter = getSocialAdapter(platform)
  const redirectUri = callbackUrl(platform)
  const state = randomBytes(16).toString('hex')
  states.set(state, { platform: platform.toLowerCase(), redirectUri, expiresAt: Date.now() + OAUTH_STATE_TTL_MS })
  return { url: adapter.getAuthUrl(redirectUri, state), state }
}

/** Consume one state (single use): wrong, used, or expired is refused. Returns the redirect URI. */
function takeState(state: string, platform: string): string {
  const entry = states.get(state)
  states.delete(state)
  if (!entry || entry.platform !== platform.toLowerCase()) {
    throw new Error('Invalid login state. Please start login again.')
  }
  if (entry.expiresAt < Date.now()) throw new Error('Login expired. Please start login again.')
  return entry.redirectUri
}

/**
 * Callback: validate the state, trade the code via the adapter, stash the
 * connectable Pages server-side for 10 minutes. Returns the login id the
 * Accounts page uses to fetch and save the ticked Pages.
 */
export async function finishLogin(platform: string, code: string, state: string): Promise<{ loginId: string; count: number }> {
  if (!code) throw new Error('Missing code. Please start login again.')
  const redirectUri = takeState(state, platform)
  const adapter = getSocialAdapter(platform)
  const items = await adapter.exchangeCode(code, redirectUri)
  const loginId = randomBytes(16).toString('hex')
  pendings.set(loginId, { platform: platform.toLowerCase(), items, expiresAt: Date.now() + OAUTH_PENDING_TTL_MS })
  return { loginId, count: items.length }
}

/** Pending Page shape for the browser: name + avatar only, never tokens. */
export interface PendingPage {
  platformAccountId: string
  name: string
  avatarUrl?: string
}

function getPending(platform: string, loginId: string): PendingEntry {
  const entry = pendings.get(loginId)
  if (!entry || entry.platform !== platform.toLowerCase()) {
    throw new Error('Login session not found. Please log in again.')
  }
  if (entry.expiresAt < Date.now()) {
    pendings.delete(loginId)
    throw new Error('Page list expired. Please log in again.')
  }
  return entry
}

/** List the Pages waiting to be ticked (this login only). */
export function pendingPages(platform: string, loginId: string): PendingPage[] {
  return getPending(platform, loginId).items.map(({ platformAccountId, name, avatarUrl }) => ({
    platformAccountId,
    name,
    avatarUrl,
  }))
}

/**
 * Consume one login: return the ticked Pages with their tokens (server side
 * only — the route saves them, never sends them back) and drop the list.
 */
export function takePending(platform: string, loginId: string, ids: string[]): ConnectableAccount[] {
  const entry = getPending(platform, loginId)
  const picked = entry.items.filter(i => ids.includes(i.platformAccountId))
  pendings.delete(loginId)
  return picked
}

/** Test hooks: drop both stores, or force one entry to expire. */
export function __clearOAuthStores(): void {
  states.clear()
  pendings.clear()
}

export function __expireOAuthState(state: string): void {
  const entry = states.get(state)
  if (entry) entry.expiresAt = Date.now() - 1
}

export function __expireOAuthPending(loginId: string): void {
  const entry = pendings.get(loginId)
  if (entry) entry.expiresAt = Date.now() - 1
}
