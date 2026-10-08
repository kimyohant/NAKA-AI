/**
 * Viral Clone (reference clip to blueprint to rendered variants) — the menu's single entry point. Other menus import from this file only
 * (never from ./routes or ./services directly); see docs/adr/0003-studio-modules-level2.md.
 */
import type { StudioModule } from '../../core/module.js'
import clone from './routes/clone.js'
import { failStaleCloneAnalyzes, resumeStaleCloneRenders } from './services/clone.js'

export const viralClone: StudioModule = {
  name: 'viral-clone',
  mount: (api) => {
    api.route('/clone', clone)
  },
  failStale: failStaleCloneAnalyzes,
  resume: resumeStaleCloneRenders,
}
