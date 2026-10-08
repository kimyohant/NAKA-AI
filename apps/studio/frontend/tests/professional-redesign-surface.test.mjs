import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const studioCss = readFileSync(new URL('../app/assets/studio.css', import.meta.url), 'utf8')
const indexPage = readFileSync(new URL('../menus/drama/pages/index.vue', import.meta.url), 'utf8')
const defaultLayout = readFileSync(new URL('../app/layouts/default.vue', import.meta.url), 'utf8')
const episodeWorkbench = readFileSync(new URL('../menus/drama/views/episode.vue', import.meta.url), 'utf8')
const dramaDetail = readFileSync(new URL('../menus/drama/views/detail.vue', import.meta.url), 'utf8')

function cssBlock(source, selector) {
  const start = source.indexOf(selector)
  assert.notEqual(start, -1, `missing selector ${selector}`)
  const open = source.indexOf('{', start)
  assert.notEqual(open, -1, `missing block for ${selector}`)

  let depth = 0
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1
    if (source[i] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, i + 1)
    }
  }

  throw new Error(`unterminated block for ${selector}`)
}

test('theme exposes the shipped light material tokens', () => {
  assert.match(studioCss, /--surface-base:\s*#f7f8fa/)
  assert.match(studioCss, /--surface-raised:\s*#ffffff/)
  assert.match(studioCss, /--surface-muted:\s*#f7f8fa/)
  assert.match(studioCss, /--surface-outline:\s*#e7e9ee/)
  assert.match(studioCss, /--accent:\s*#f97316/)
})

test('project entry is a poster card grid', () => {
  assert.match(indexPage, /class="project-grid"/)
  assert.match(indexPage, /class="project-card"/)
  assert.match(indexPage, /class="project-cover"/)
  assert.match(indexPage, /repeat\(auto-fill,\s*minmax\(250px,\s*1fr\)\)/)
  assert.match(indexPage, /aspect-ratio: 16 \/ 10/)
})

test('global header uses the translucent header token', () => {
  // token กึ่งโปร่งกลางอยู่ที่ studio.css แล้ว layout อ้างผ่าน var(--header-bg)
  assert.match(studioCss, /--header-bg:\s*rgba\(247,248,250,0\.75\)/)
  assert.match(defaultLayout, /background:\s*var\(--header-bg\)/)
  assert.match(defaultLayout, /border-bottom:\s*1px solid var\(--border\)/)
})

test('workbench removes legacy light panels from the main production surface', () => {
  assert.match(episodeWorkbench, /background:\s*var\(--surface-raised\)/)
  assert.match(episodeWorkbench, /background:\s*var\(--surface-muted\)/)
  assert.doesNotMatch(episodeWorkbench, /rgba\(246,\s*248,\s*252,\s*0\.92\)/)
  assert.doesNotMatch(episodeWorkbench, /rgba\(27,\s*41,\s*64,\s*0\.08\)/)
})

test('project episode dialog follows the light brand system', () => {
  assert.doesNotMatch(dramaDetail, /rgba\(122,167,255/)
  assert.doesNotMatch(dramaDetail, /rgba\(76,125,255/)
  assert.doesNotMatch(dramaDetail, /rgba\(242,247,255,0\.92\)/)
  assert.doesNotMatch(dramaDetail, /rgba\(244,248,255,0\.96\)/)
})

test('workbench active navigation uses the shared selection tokens', () => {
  const pipeActive = cssBlock(episodeWorkbench, '.pipe-item.active')
  const iconActive = cssBlock(episodeWorkbench, '.icon-active')

  assert.match(pipeActive, /background:\s*var\(--sel-bg\)/)
  assert.match(pipeActive, /color:\s*var\(--sel-text\)/)
  assert.doesNotMatch(pipeActive, /inset 3px 0 0 var\(--accent\)/)
  assert.match(iconActive, /background:\s*var\(--sel\)\s*!important/)
})

test('workbench completed navigation uses quiet success states', () => {
  const doneItem = cssBlock(episodeWorkbench, '.pipe-item.done')
  const doneIcon = cssBlock(episodeWorkbench, '.pipe-item.done .pipe-icon')
  const iconDone = cssBlock(episodeWorkbench, '.icon-done')
  const stageDoneDot = cssBlock(episodeWorkbench, '.stage-subnav-dot')

  assert.doesNotMatch(doneItem, /#9fcaa7/)
  assert.match(doneIcon, /background:\s*var\(--success-bg\)/)
  assert.match(doneIcon, /color:\s*var\(--success\)/)
  assert.match(iconDone, /background:\s*var\(--success-bg\)/)
  assert.doesNotMatch(stageDoneDot, /#9fcaa7/)
  assert.match(episodeWorkbench, /\.pipe-item\.active\.done \.pipe-icon\s*\{/)
})
