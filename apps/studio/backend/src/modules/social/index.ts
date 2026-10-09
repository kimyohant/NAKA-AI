/**
 * Social Auto Reply (read comments on a connected Page, judge them, draft or send replies) — the menu's
 * single entry point. Other menus import from this file only (never from ./routes or ./services directly);
 * see docs/adr/0003-studio-modules-level2.md. Spec: apps/studio/.scratch/social-auto-reply/spec.md.
 */
import type { StudioModule } from '../../core/module.js'
import social from './routes/social.js'
import { startSocialPoller } from './services/poller.js'
import './services/facebook.js' // registers the `facebook` adapter

export const socialModule: StudioModule = {
  name: 'social',
  mount: (api) => {
    api.route('/social', social)
  },
  // one timer, first round right after boot, no-op when no Social Account is connected and watching
  start: startSocialPoller,
}
