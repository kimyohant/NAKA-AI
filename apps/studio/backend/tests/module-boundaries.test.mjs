/**
 * Module boundaries (docs/adr/0003-studio-modules-level2.md §1.3, §2.2).
 *
 * - src/core/** never imports a menu (src/modules/**, src/modules.ts)
 * - a menu reaches another menu only through that menu's index.ts
 * - and only in the allowed direction (the table below); everything else goes through core
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const SRC = fileURLToPath(new URL('../src/', import.meta.url))

/** menu → menus it may import (through their index.ts) */
const ALLOWED = {
  'drama': [],
  'marketer': [],
  'product-studio': ['marketer'],
  'seller': ['marketer', 'product-studio'],
  'viral-clone': ['product-studio'],
  'live': [],
  'social': [],
}

function walk(dir) {
  return readdirSync(dir).flatMap(name => {
    const p = path.join(dir, name)
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : []
  })
}

/** every relative import / export-from / dynamic import of a file, resolved to a src-relative path */
function importsOf(file) {
  const text = readFileSync(file, 'utf8')
  const specs = [...text.matchAll(/(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)].map(m => m[1])
  return specs.map(spec => path.relative(SRC, path.resolve(path.dirname(file), spec)).split(path.sep).join('/'))
}

const rel = file => path.relative(SRC, file).split(path.sep).join('/')
const menuOf = p => p.match(/^modules\/([^/]+)\//)?.[1]

test('core never imports menu code', () => {
  const offenders = walk(path.join(SRC, 'core')).flatMap(file =>
    importsOf(file).filter(t => t.startsWith('modules/') || t === 'modules.js').map(t => `${rel(file)} → ${t}`))
  assert.deepEqual(offenders, [])
})

test('menus import each other only through index.ts, in the allowed direction', () => {
  const offenders = []
  for (const file of walk(path.join(SRC, 'modules'))) {
    const from = menuOf(rel(file))
    for (const target of importsOf(file)) {
      const to = menuOf(target)
      if (!to || to === from) continue
      if (!target.startsWith(`modules/${to}/index.`)) offenders.push(`${rel(file)} → ${target} (use modules/${to}/index.ts)`)
      else if (!ALLOWED[from]?.includes(to)) offenders.push(`${rel(file)} → ${target} (${from} may not depend on ${to})`)
    }
  }
  assert.deepEqual(offenders, [])
})

test('every menu folder is registered and exports a StudioModule', () => {
  const menus = readdirSync(path.join(SRC, 'modules')).filter(n => statSync(path.join(SRC, 'modules', n)).isDirectory())
  assert.deepEqual(menus.sort(), Object.keys(ALLOWED).sort())
  const registry = readFileSync(path.join(SRC, 'modules.ts'), 'utf8')
  for (const menu of menus) {
    const index = readFileSync(path.join(SRC, 'modules', menu, 'index.ts'), 'utf8')
    assert.match(index, new RegExp(`name: '${menu}'`), `${menu}/index.ts must export a StudioModule named '${menu}'`)
    assert.match(registry, new RegExp(`from './modules/${menu}/index\\.js'`), `${menu} missing from src/modules.ts`)
  }
})

test('no menu code left in the old flat folders', () => {
  for (const dir of ['routes', 'services']) {
    let left = []
    try { left = readdirSync(path.join(SRC, dir)) } catch { /* folder removed */ }
    assert.deepEqual(left, [], `src/${dir}/ should be empty: menu code lives in src/modules/<menu>/`)
  }
})
