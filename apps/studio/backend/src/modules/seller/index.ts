/**
 * AI Seller (product link to ready-to-post video + copy) — the menu's single entry point. Other menus import from this file only
 * (never from ./routes or ./services directly); see docs/adr/0003-studio-modules-level2.md.
 */
import type { StudioModule } from '../../core/module.js'
import seller from './routes/seller.js'
import { resumeSellerVideos } from './services/seller.js'

export const sellerModule: StudioModule = {
  name: 'seller',
  mount: (api) => {
    api.route('/seller', seller)
  },
  resume: resumeSellerVideos,
}
