// Asset paths when the app is served under a base path (default /admin/).
// Nuxt SPA exposes the base on window.__NUXT__.config.app.baseURL; tests/node get '' (root).
export function assetBase() {
  const base = (typeof window !== 'undefined' && window.__NUXT__?.config?.app?.baseURL) || '/'
  return base.replace(/\/$/, '')
}
