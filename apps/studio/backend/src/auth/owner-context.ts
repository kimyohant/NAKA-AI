/**
 * Per-request owner context (unified system, step 2). Kept free of db imports so schema.ts can use it
 * as the insert-time default for owner_user_id.
 *
 * - Inside a request: the member who made it (set by the ownership middleware), so every row a service
 *   creates — including internal ones like Studio's drama/episode — belongs to that member.
 * - Outside a request (startup resumes, scripts): no store → rows default to 'local' and lists are unfiltered.
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import { inArray, type AnyColumn, type SQL } from 'drizzle-orm'

export const LOCAL_OWNER = 'local'

export interface OwnerScope { ownerId: string; admin: boolean }

const store = new AsyncLocalStorage<OwnerScope>()

export const ownerScope = (): OwnerScope | undefined => store.getStore()

export const runAsOwner = <T>(scope: OwnerScope, fn: () => T): T => store.run(scope, fn)

/** owner stamped on new rows */
export const currentOwnerId = (): string => store.getStore()?.ownerId ?? LOCAL_OWNER

/**
 * owners whose rows show up in lists: yourself; admins also see legacy single-user rows ('local').
 * undefined = no filter (no request scope, or single-user mode where everyone is 'local').
 */
export function visibleOwnerIds(): string[] | undefined {
  const scope = store.getStore()
  if (!scope || scope.ownerId === LOCAL_OWNER) return undefined
  return scope.admin ? [scope.ownerId, LOCAL_OWNER] : [scope.ownerId]
}

/** may the current scope touch a row owned by `owner`? (admins and out-of-request code: always) */
export function canAccessOwner(owner: string | null | undefined): boolean {
  const scope = store.getStore()
  if (!scope || scope.admin) return true
  return owner === scope.ownerId
}

/** WHERE fragment for list queries (undefined → no filter; drizzle's and() skips it) */
export function ownedBy(column: AnyColumn): SQL | undefined {
  const ids = visibleOwnerIds()
  return ids ? inArray(column, ids) : undefined
}
