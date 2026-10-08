/**
 * Studio menus as modules (docs/adr/0003-studio-modules-level2.md).
 *
 * Every product menu is one entry: the API routes it mounts under /api/v1 and the startup
 * recovery it needs. index.ts mounts the shared (core) routes, then every module in this list.
 *
 * Recovery runs in two passes over this list, after the core sweeps (generation tasks,
 * pipeline tasks): first every `failStale` (mark `*ing` states that cannot still be running
 * as failed), then every `resume` (continue pipelines whose provider tasks were recovered).
 * The list order is the recovery order — product-studio auto-render must resume before seller
 * videos, which wait on it.
 */
import type { Hono } from 'hono'

import dramas from './routes/dramas.js'
import episodes from './routes/episodes.js'
import storyboards from './routes/storyboards.js'
import scenes from './routes/scenes.js'
import characters from './routes/characters.js'
import props from './routes/props.js'
import merge from './routes/merge.js'
import campaigns from './routes/campaigns.js'
import trending from './routes/trending.js'
import gallery from './routes/gallery.js'
import studio from './routes/studio.js'
import seller from './routes/seller.js'
import clone from './routes/clone.js'
import live from './routes/live.js'
import { failStaleCampaigns } from './services/marketer.js'
import { failStaleStudioProjects } from './services/studio.js'
import { resumeStaleAutoRenders } from './services/studio-autorender.js'
import { resumeSellerVideos } from './services/seller.js'
import { failStaleCloneAnalyzes, resumeStaleCloneRenders } from './services/clone.js'

export type StudioModuleName = 'drama' | 'marketer' | 'product-studio' | 'seller' | 'viral-clone' | 'live'

export interface StudioModule {
  name: StudioModuleName
  /** Mount this menu's routers on the /api/v1 sub-app. */
  mount: (api: Hono) => void
  /** Startup: fail work left in a running state by a restart. Returns the number of rows touched. */
  failStale?: () => Promise<number>
  /** Startup: continue pipelines interrupted by a restart. Returns the number resumed. */
  resume?: () => Promise<number>
}

export const studioModules: StudioModule[] = [
  {
    name: 'drama',
    mount: (api) => {
      api.route('/dramas', dramas)
      api.route('/episodes', episodes)
      api.route('/storyboards', storyboards)
      api.route('/scenes', scenes)
      api.route('/characters', characters)
      api.route('/props', props)
      api.route('/merge', merge)
    },
  },
  {
    name: 'marketer',
    mount: (api) => {
      api.route('/campaigns', campaigns)
      api.route('/trending-videos', trending)
      api.route('/gallery', gallery)
    },
    failStale: failStaleCampaigns,
  },
  {
    name: 'product-studio',
    mount: (api) => {
      api.route('/studio', studio)
    },
    failStale: failStaleStudioProjects,
    resume: resumeStaleAutoRenders,
  },
  {
    name: 'seller',
    mount: (api) => {
      api.route('/seller', seller)
    },
    resume: resumeSellerVideos,
  },
  {
    name: 'viral-clone',
    mount: (api) => {
      api.route('/clone', clone)
    },
    failStale: failStaleCloneAnalyzes,
    resume: resumeStaleCloneRenders,
  },
  {
    name: 'live',
    mount: (api) => {
      api.route('/live', live)
    },
  },
]

/** Run one recovery pass over the modules in order; one module failing never blocks the next. */
export async function recoverModules(pass: 'failStale' | 'resume'): Promise<void> {
  for (const m of studioModules) {
    const step = m[pass]
    if (!step) continue
    try {
      const n = await step()
      if (n > 0) console.log(`🔁 ${m.name}: ${pass} ${n}`)
    } catch (err: any) {
      console.error(`${m.name}: ${pass} failed:`, err?.message)
    }
  }
}
