// every page except /login needs a valid admin session (checked once per app load)
import { adminAPI } from '~/composables/useApi'
import { adminTokenValue, guardOff, signedIn } from '~/composables/useAdminAuth'

export default defineNuxtRouteMiddleware(async (to) => {
  if (to.path === '/login' || signedIn.value) return
  try {
    const s = await adminAPI.session(adminTokenValue())
    guardOff.value = !s.guard
    signedIn.value = true
  } catch {
    return navigateTo({ path: '/login', query: to.fullPath !== '/' ? { next: to.fullPath } : {} })
  }
})
