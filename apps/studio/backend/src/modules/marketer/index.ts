/**
 * AI Marketer (campaigns, trending, gallery, quick start) — the menu's single entry point. Other menus import from this file only
 * (never from ./routes or ./services directly); see docs/adr/0003-studio-modules-level2.md.
 * Used by: product-studio, seller (ingestUrl).
 */
import type { StudioModule } from '../../core/module.js'
import campaigns from './routes/campaigns.js'
import trending from './routes/trending.js'
import gallery from './routes/gallery.js'
import marketerQuick from './routes/marketer-quick.js'
import { failStaleCampaigns } from './services/marketer.js'
import { failStaleInsights } from './services/marketer-quick.js'

export const marketer: StudioModule = {
  name: 'marketer',
  mount: (api) => {
    api.route('/campaigns', campaigns)
    api.route('/trending-videos', trending)
    api.route('/gallery', gallery)
    api.route('/marketer', marketerQuick)
  },
  // campaigns and quick-start analyses left running by a restart
  failStale: async () => (await failStaleCampaigns()) + (await failStaleInsights()),
}

// public API for other menus
export { ingestUrl } from './services/marketer.js'
