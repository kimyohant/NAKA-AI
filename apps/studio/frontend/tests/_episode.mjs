// The episode workbench is views/episode.vue plus its lazy parts and styles in views/episode/:
// structure tests read them as one text.
import { readFileSync, readdirSync } from 'node:fs'

export function readEpisodeWorkbench() {
  const dir = new URL('../menus/drama/views/episode/', import.meta.url)
  const parts = readdirSync(dir).filter(f => /\.(vue|css)$/.test(f)).sort()
  return [new URL('../menus/drama/views/episode.vue', import.meta.url), ...parts.map(f => new URL(f, dir))]
    .map(file => readFileSync(file, 'utf8')).join('\n')
}
