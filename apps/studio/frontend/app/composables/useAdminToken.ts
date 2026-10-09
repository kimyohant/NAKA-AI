/**
 * System settings (/settings) are admin-only. A naka-ai admin signed in through SSO needs nothing more;
 * otherwise the backend's ADMIN_TOKEN unlocks them. The token is kept in sessionStorage (closing the
 * browser signs out) unless "remember" puts it in localStorage, under the key the old back-office app used,
 * and is only ever sent to this backend as X-Admin-Token.
 */
import { ref } from 'vue'

const KEY = 'naka-admin-token'

function read(): string {
  try {
    return sessionStorage.getItem(KEY) || localStorage.getItem(KEY) || ''
  } catch {
    return ''
  }
}

const token = ref(typeof window === 'undefined' ? '' : read())
/** set when the API answers 401 E_ADMIN_REQUIRED: the settings page then asks for the token */
export const adminTokenNeeded = ref(false)

export function adminTokenValue(): string {
  return token.value
}

export function saveAdminToken(value: string, remember: boolean) {
  token.value = value
  adminTokenNeeded.value = false
  try {
    sessionStorage.removeItem(KEY)
    localStorage.removeItem(KEY)
    ;(remember ? localStorage : sessionStorage).setItem(KEY, value)
  } catch { /* storage unavailable: the token lives until reload */ }
}

export function clearAdminToken() {
  token.value = ''
  try {
    sessionStorage.removeItem(KEY)
    localStorage.removeItem(KEY)
  } catch { /* storage unavailable */ }
}

/** the backend refused an admin-only call: forget a stale token and ask again */
export function onAdminRequired() {
  clearAdminToken()
  adminTokenNeeded.value = true
}
