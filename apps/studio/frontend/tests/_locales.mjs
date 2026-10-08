// Merged UI messages, as the app sees them: app/locales/<lang>.json + every menus/<menu>/locales/<lang>.json
// (app/composables/i18n.ts does the same merge at runtime).
import { readdirSync, readFileSync, existsSync } from 'node:fs'

const root = new URL('../', import.meta.url)
const readJson = (p) => JSON.parse(readFileSync(new URL(p, root), 'utf8'))

export function loadLocale(lang) {
  const out = { ...readJson(`app/locales/${lang}.json`) }
  for (const menu of readdirSync(new URL('menus/', root))) {
    const file = `menus/${menu}/locales/${lang}.json`
    if (existsSync(new URL(file, root))) Object.assign(out, readJson(file))
  }
  return out
}
