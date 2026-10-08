/**
 * AI Live (live host / responder, TikTok Live, avatars) — the menu's single entry point. Other menus import from this file only
 * (never from ./routes or ./services directly); see docs/adr/0003-studio-modules-level2.md.
 */
import type { StudioModule } from '../../core/module.js'
import live from './routes/live.js'

export const liveModule: StudioModule = {
  name: 'live',
  mount: (api) => {
    api.route('/live', live)
  },
}
