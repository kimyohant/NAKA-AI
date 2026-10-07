/**
 * Desktop packaging — the backend lives in kimyohant/naka-ai-backend (sibling checkout or NAKA_BACKEND_DIR):
 * esbuild bundles its src, prepare-resources copies its workspace, caption fonts and the admin build,
 * and the main process points the backend at them (moved from the backend repo's studio2-structure test).
 */
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const root = new URL('..', import.meta.url)
const read = (p) => readFileSync(new URL(p, root), 'utf8')

test('backend comes from the naka-ai-backend checkout', () => {
  const dir = read('scripts/backend-dir.mjs')
  assert.match(dir, /process\.env\.NAKA_BACKEND_DIR \|\| path\.join\(REPO, '\.\.', 'naka-ai-backend', 'backend'\)/)
  assert.match(read('scripts/build-backend.mjs'), /entryPoints: \[path\.join\(requireBackendDir\(\), 'src', 'index\.ts'\)\]/)
  const main = read('src/main.ts')
  assert.match(main, /DEV_BACKEND_DIR = path\.resolve\(process\.env\.NAKA_BACKEND_DIR/)
  assert.match(main, /: path\.join\(DEV_BACKEND_DIR, 'workspace'\)/)
})

test('caption fonts are bundled and injected as CAPTION_FONT_DIR', () => {
  assert.match(read('electron-builder.yml'), /resources\/fonts, to: fonts/)
  assert.match(read('src/main.ts'), /CAPTION_FONT_DIR = path\.join\(resources, 'fonts'\)/)
  assert.match(read('scripts/prepare-resources.mjs'), /path\.join\(BACKEND, 'assets', 'fonts'\)/)
})

test('admin (system settings) is bundled and served at /admin without a token', () => {
  assert.match(read('electron-builder.yml'), /resources\/admin, to: admin/)
  const prepare = read('scripts/prepare-resources.mjs')
  assert.match(prepare, /fs\.cpSync\(ADMIN_BUILD_DIR, path\.join\(RES, 'admin'\)/)
  const main = read('src/main.ts')
  assert.match(main, /ADMIN_DIST: app\.isPackaged/)
  assert.doesNotMatch(main, /ADMIN_TOKEN\s*:/) // desktop never sets a token
  // "Open Admin" (target=_blank on the web) opens inside the app window
  assert.match(main, /if \(isAppUrl\(url\)\) void mainWindow\?\.loadURL\(url\)/)
})
