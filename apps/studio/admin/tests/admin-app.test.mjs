/**
 * Admin wiring — sign-in with the backend's ADMIN_TOKEN, every API call carries X-Admin-Token,
 * 401 E_ADMIN_REQUIRED sends the user back to /login, app served under /admin/, assets follow the base path.
 */
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { styleExample, skillArt, coverArt } from '../app/utils/studioArt.js'

const root = new URL('..', import.meta.url)
const read = (p) => readFileSync(new URL(p, root), 'utf8')

test('API client sends the admin token and handles 401 E_ADMIN_REQUIRED', () => {
  const api = read('app/composables/useApi.ts')
  assert.match(api, /'X-Admin-Token': token/)
  assert.match(api, /resp\.status === 401 && json\.errorCode === 'E_ADMIN_REQUIRED'\) onAdminUnauthorized\(\)/)
  assert.match(api, /`\$\{apiOrigin\(\)\}\/api\/v1`/)
  assert.match(api, /session: \(token: string\) => fetch\(`\$\{base\(\)\}\/admin\/session`/)
  // uploads carry the token too
  assert.match(api, /method: 'POST', body: fd, headers: authHeaders\(\)/)
  // only the settings APIs live here
  for (const name of ['aiConfigAPI', 'promptAPI', 'skillsAPI', 'stylePresetAPI', 'storageAPI', 'settingsAPI', 'serverUpdateAPI', 'taskAPI', 'uploadAPI']) {
    assert.match(api, new RegExp(`export const ${name} =`))
  }
  assert.doesNotMatch(api, /dramaAPI|sellerAPI|studioAPI/)
})

test('every page except /login requires a session; login stores the token', () => {
  const mw = read('app/middleware/auth.global.ts')
  assert.match(mw, /to\.path === '\/login'/)
  assert.match(mw, /adminAPI\.session\(adminTokenValue\(\)\)/)
  const login = read('app/pages/login.vue')
  assert.match(login, /definePageMeta\(\{ layout: false \}\)/)
  assert.match(login, /saveAdminToken\(value, remember\.value\)/)
  assert.match(login, /type="password"/)
  const auth = read('app/composables/useAdminAuth.ts')
  assert.match(auth, /sessionStorage/)
  assert.match(auth, /query: \{ expired: '1' \}/)
})

test('served under /admin/ with the settings menu in the sidebar', () => {
  const cfg = read('nuxt.config.ts')
  assert.match(cfg, /baseURL: '\/admin\/'/)
  assert.match(cfg, /apiOrigin: ''/)
  const layout = read('app/layouts/default.vue')
  assert.match(layout, /:to="\{ path: '\/', query: \{ tab: item\.tab \} \}"/)
  assert.match(layout, /:data-tab="item\.tab"/)
  assert.match(layout, /@click="signOut"/)
  assert.doesNotMatch(layout, /\/seller|\/drama|\/marketer/)
  // tour points at the sidebar item by data-tab (href now includes the base path)
  assert.match(read('app/pages/index.vue'), /\.side-link\[data-tab="ai"\]/)
})

test('static art paths are root-relative outside the browser (base path added at runtime)', () => {
  assert.equal(styleExample('ghibli'), '/studio-art/styles/ghibli.webp')
  assert.equal(skillArt('extractor/x').still, '/studio-art/skills/extractor/x/still.webp')
  assert.equal(coverArt('agent', 'extractor'), '/studio-art/covers/agent/extractor.webp')
  assert.match(read('app/utils/assetBase.js'), /window\.__NUXT__\?\.config\?\.app\?\.baseURL/)
  assert.match(read('app/composables/useProviderIcon.ts'), /\$\{assetBase\(\)\}\/icons\//)
})

test('every custom component tag used has a file (no silently-unresolved components)', async () => {
  const { readdirSync } = await import('node:fs')
  const files = ['app/app.vue', 'app/layouts/default.vue', ...readdirSync(new URL('app/pages/', root)).map(f => `app/pages/${f}`),
    ...readdirSync(new URL('app/components/', root)).map(f => `app/components/${f}`)]
  const components = new Set(readdirSync(new URL('app/components/', root)).map(f => f.replace(/\.vue$/, '')))
  const builtins = new Set(['NuxtLayout', 'NuxtPage', 'NuxtLink', 'Teleport', 'Transition', 'TransitionGroup', 'KeepAlive', 'Toaster', 'ClientOnly'])
  for (const f of files) {
    const src = read(f)
    const imported = new Set([...src.matchAll(/import\s*\{([^}]*)\}\s*from\s*'(lucide-vue-next|vue-sonner)'/g)].flatMap(m => m[1].split(',').map(s => s.trim())))
    const defaultImports = new Set([...src.matchAll(/import\s+([A-Z]\w*)\s+from/g)].map(m => m[1]))
    for (const [, tag] of src.matchAll(/<([A-Z][A-Za-z0-9]*)/g)) {
      assert.ok(components.has(tag) || builtins.has(tag) || imported.has(tag) || defaultImports.has(tag), `${f}: <${tag}> has no component`)
    }
  }
})
