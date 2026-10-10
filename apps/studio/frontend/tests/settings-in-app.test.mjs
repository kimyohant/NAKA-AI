/**
 * System settings live in the app at /settings (they were the separate admin/ back-office app).
 * Admins only: naka-ai admins through SSO, or the single user; with ADMIN_TOKEN set the page asks for it
 * once and every API call then carries X-Admin-Token. Old /admin links redirect to /settings.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const root = new URL('..', import.meta.url)
const read = (p) => readFileSync(new URL(p, root), 'utf8')

test('API client sends the admin token and flags 401 E_ADMIN_REQUIRED', () => {
  const api = read('app/composables/useApi.ts')
  assert.match(api, /'X-Admin-Token': token/)
  assert.match(api, /headers: withAdminToken\(\{ 'Content-Type': 'application\/json' \}\)/)
  // uploads carry the token too
  assert.match(api, /method: 'POST', body: fd, headers: withAdminToken\(\)/)
  assert.match(api, /resp\.status === 401 && json\.errorCode === 'E_ADMIN_REQUIRED'\) onAdminRequired\(\)/)
  assert.match(api, /fetch\(`\$\{BASE\}\/admin\/session`/)
  const token = read('app/composables/useAdminToken.ts')
  assert.match(token, /const KEY = 'naka-admin-token'/) // a token remembered by the old admin app still works
  assert.match(token, /sessionStorage/)
})

test('/settings is admins only and asks for ADMIN_TOKEN when the server needs it', () => {
  const page = read('app/pages/settings.vue')
  assert.match(page, /<div v-if="notAdmin" class="settings-denied"/)
  assert.match(page, /<AdminTokenGate v-else-if="adminTokenNeeded" @unlocked="reloadSettings" \/>/)
  assert.match(page, /session\?\.sso && !session\.user\?\.admin/)
  assert.match(page, /settingsRoute\.query\.tab/)
  const gate = read('app/components/AdminTokenGate.vue')
  assert.match(gate, /adminSessionAPI\.check\(value\)/)
  assert.match(gate, /saveAdminToken\(value, remember\.value\)/)
  assert.match(gate, /type="password"/)
})

test('the sidebar shows the settings sections to admins; no link leads to the old admin app', () => {
  const layout = read('app/layouts/default.vue')
  assert.match(layout, /<template v-if="session\?\.user\?\.admin">/)
  assert.match(layout, /:to="\{ path: '\/settings', query: \{ tab: item\.tab \} \}" :data-tab="item\.tab"/)
  for (const tab of ['ai', 'styles', 'agents', 'general']) assert.match(layout, new RegExp(`tab: '${tab}'`))
  // storage and about & update moved to the naka-ai back office (landing /admin/studio-system/)
  for (const tab of ['storage', 'about']) {
    assert.doesNotMatch(layout, new RegExp(`tab: '${tab}'`))
    assert.doesNotMatch(read('app/pages/settings.vue'), new RegExp(`tab === '${tab}'`))
  }
  // the settings tour points at the sidebar entry
  assert.match(read('app/pages/settings.vue'), /\.side-link\[data-tab="ai"\]/)
  assert.ok(!existsSync(new URL('app/composables/useAdminUrl.ts', root)))
  for (const f of ['app/layouts/default.vue', 'menus/drama/pages/index.vue', 'menus/product-studio/views/workspace.vue', 'nuxt.config.ts']) {
    assert.doesNotMatch(read(f), /adminUrl|openAdmin|\/admin\//, f)
  }
})

test('the backend sends old /admin links to /settings, section included', () => {
  const server = read('../backend/src/index.ts')
  assert.match(server, /app\.get\('\/admin', c => c\.redirect\(settingsPath\(c\.req\.query\('tab'\)\), 301\)\)/)
  assert.match(server, /app\.get\('\/admin\/\*', c => c\.redirect\(settingsPath\(c\.req\.query\('tab'\)\), 301\)\)/)
  assert.match(server, /\/settings\?tab=\$\{tab\}/)
  assert.doesNotMatch(server, /ADMIN_DIST|ADMIN_ORIGINS/)
  assert.doesNotMatch(read('../Dockerfile'), /admin-build|admin-dist|ADMIN_DIST/)
})

test('every custom component tag on the settings page has a file', () => {
  const components = new Set(readdirSync(new URL('app/components/', root)).map(f => f.replace(/\.vue$/, '')))
  const builtins = new Set(['NuxtLayout', 'NuxtPage', 'NuxtLink', 'Teleport', 'Transition', 'TransitionGroup', 'KeepAlive', 'Toaster', 'ClientOnly', 'component'])
  for (const f of ['app/pages/settings.vue', 'app/components/AdminTokenGate.vue']) {
    const src = read(f)
    const imported = new Set([...src.matchAll(/import\s*\{([^}]*)\}\s*from\s*'(lucide-vue-next|vue-sonner)'/g)].flatMap(m => m[1].split(',').map(s => s.trim())))
    const defaultImports = new Set([...src.matchAll(/import\s+([A-Z]\w*)\s+from/g)].map(m => m[1]))
    for (const [, tag] of src.matchAll(/<([A-Z][A-Za-z0-9]*)/g)) {
      assert.ok(components.has(tag) || builtins.has(tag) || imported.has(tag) || defaultImports.has(tag), `${f}: <${tag}> has no component`)
    }
  }
})

test('nothing loads behind the token gate or the admins-only notice', () => {
  const page = read('app/pages/settings.vue')
  assert.match(page, /if \(e\?\.status === 401\) onAdminRequired\(\)/)
  assert.match(page, /if \(!\(await adminAccess\(\)\)\) return\r?\n\s*loadCfgs\(\)/)
  assert.match(page, /if \(await adminAccess\(\)\) setTimeout\(\(\) => autoTour\('settings'/)
  assert.match(page, /if \(await adminAccess\(\)\) loadContentLanguage\(\)/)
  assert.doesNotMatch(page, /onMounted\(\(\) => \{ loadCfgs\(\)/)
})
