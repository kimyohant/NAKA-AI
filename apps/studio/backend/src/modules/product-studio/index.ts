/**
 * Product Studio (product video projects, auto-render, influencers) — the menu's single entry point. Other menus import from this file only
 * (never from ./routes or ./services directly); see docs/adr/0003-studio-modules-level2.md.
 * Used by: seller (projects, auto-render, templates), viral-clone (clearEpisodeStoryboards).
 */
import type { StudioModule } from '../../core/module.js'
import studio from './routes/studio.js'
import { failStaleStudioProjects } from './services/studio.js'
import { resumeStaleAutoRenders } from './services/studio-autorender.js'

export const productStudio: StudioModule = {
  name: 'product-studio',
  mount: (api) => {
    api.route('/studio', studio)
  },
  failStale: failStaleStudioProjects,
  resume: resumeStaleAutoRenders,
}

// public API for other menus
export {
  createProject, deleteProject, getProjectDetail, getProjectRow, listProjects, parseAutoRender, startStudioScript,
} from './services/studio.js'
export { cancelAutoRender, startAutoRender } from './services/studio-autorender.js'
export { getStudioTemplate, type StudioPlatform } from './services/studio-templates.js'
export { clearEpisodeStoryboards } from './services/studio-shots.js'
