// views/episode.vue keeps the workbench state; its big parts (views/episode/*.vue) are lazy chunks that
// inject that state, and the styles are plain CSS under the page's root class.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

const dir = new URL('../menus/drama/views/episode/', import.meta.url)
const page = readFileSync(new URL('../menus/drama/views/episode.vue', import.meta.url), 'utf8')
const parts = readdirSync(dir).filter(f => f.endsWith('.vue')).map(f => [f, readFileSync(new URL(f, dir), 'utf8')])
const css = readFileSync(new URL('workbench.css', dir), 'utf8')
const names = text => text.split(',').map(n => n.trim()).filter(Boolean)

test('every part is loaded lazily, never imported into the page chunk', () => {
  assert.ok(parts.length >= 6)
  for (const [file] of parts) {
    const name = file.replace('.vue', '')
    assert.match(page, new RegExp(`const load${name} = \\(\\) => import\\('\\./episode/${name}\\.vue'\\)`))
    assert.match(page, new RegExp(`const Episode${name} = defineAsyncComponent\\(load${name}\\)`))
    assert.match(page, new RegExp(`<Episode${name} [^>]*/>`), `${name} is rendered by the page`)
  }
  assert.doesNotMatch(page, /^import .* from '\.\/episode\//m)
})

test('every name a part injects is provided by the page', () => {
  const provided = new Set(names(page.match(/provide\(EPISODE_WORKBENCH, \{([^}]*)\}\)/)[1]))
  for (const [file, src] of parts) {
    const injected = src.match(/const \{([^}]*)\} = inject\(EPISODE_WORKBENCH\)/)
    assert.ok(injected, `${file} injects the workbench`)
    const missing = names(injected[1]).filter(n => !provided.has(n))
    assert.deepEqual(missing, [], `${file} uses names the page does not provide`)
  }
})

test('styles: one plain stylesheet, every rule under the page root .ep-workbench', () => {
  assert.match(page, /<div class="studio ep-workbench" v-if="drama">/)
  assert.doesNotMatch(page, /<style scoped/)
  assert.match(page, /<style src="\.\/episode\/workbench\.css"><\/style>/)
  for (const [file, src] of parts) assert.doesNotMatch(src, /<style/, `${file} has no styles of its own`)
  const body = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@keyframes[^{]*\{(?:[^{}]*\{[^}]*\})*[^}]*\}/g, '')
  const selectors = [...body.matchAll(/(?:^|[}{])\s*([^{}@]+?)\s*\{/g)].flatMap(m => m[1].split(',').map(s => s.trim()))
  assert.ok(selectors.length > 500)
  const loose = selectors.filter(s => !/^\.ep-workbench /.test(s) && !/^\.studio\.ep-workbench(?![\w-])/.test(s) && s !== 'body.is-video-col-dragging')
  assert.deepEqual(loose, [], 'a rule outside .ep-workbench would style other pages too')
  for (const m of css.matchAll(/@keyframes ([\w-]+)/g)) assert.match(m[1], /^ep-/)
})
