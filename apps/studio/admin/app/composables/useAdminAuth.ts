/**
 * Admin sign-in — the token is the backend's ADMIN_TOKEN. Kept in sessionStorage (closing the browser
 * signs out) unless "remember me" puts it in localStorage. Never sent anywhere except the backend API.
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
/** backend runs without ADMIN_TOKEN → no sign-in needed (dev / desktop) */
export const guardOff = ref(false)
export const signedIn = ref(false)

export function adminTokenValue(): string {
  return token.value
}

export function saveAdminToken(value: string, remember: boolean) {
  token.value = value
  try {
    sessionStorage.removeItem(KEY)
    localStorage.removeItem(KEY)
    if (value) (remember ? localStorage : sessionStorage).setItem(KEY, value)
  } catch { /* private mode: token stays in memory for this tab */ }
}

export function signOut() {
  saveAdminToken('', false)
  signedIn.value = false
  navigateTo('/login')
}

/** API answered 401 E_ADMIN_REQUIRED (token changed on the server / expired session) */
export function onAdminUnauthorized() {
  if (!signedIn.value) return
  saveAdminToken('', false)
  signedIn.value = false
  navigateTo({ path: '/login', query: { expired: '1' } })
}
