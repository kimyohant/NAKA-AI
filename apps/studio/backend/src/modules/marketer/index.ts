/**
 * AI Marketer (campaigns, trending, gallery) — the menu's single entry point. Other menus import from this file only
 * (never from ./routes or ./services directly); see docs/adr/0003-studio-modules-level2.md.
 * Used by: product-studio, seller (ingestUrl).
 */
import type { StudioModule } from '../../core/module.js'
import campaigns from './routes/campaigns.js'
import trending from './routes/trending.js'
import gallery from './routes/gallery.js'
import { failStaleCampaigns } from './services/marketer.js'

export const marketer: StudioModule = {
  name: 'marketer',
  mount: (api) => {
    api.route('/campaigns', campaigns)
    api.route('/trending-videos', trending)
    api.route('/gallery', gallery)
  },
  failStale: failStaleCampaigns,
}

// public API for other menus
export { ingestUrl } from './services/marketer.js'
