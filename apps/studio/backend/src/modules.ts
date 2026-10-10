/**
 * Studio menus as modules (docs/adr/0003-studio-modules-level2.md).
 *
 * Each product menu lives in src/modules/<menu>/ and exports one StudioModule from its index.ts:
 * the API routes it mounts under /api/v1 and the startup recovery it needs. index.ts mounts the
 * shared (core) routes, then every module in this list.
 *
 * Recovery runs in two passes over this list, after the core sweeps (generation tasks,
 * pipeline tasks): first every `failStale` (mark `*ing` states that cannot still be running
 * as failed), then every `resume` (continue pipelines whose provider tasks were recovered).
 * The list order is the recovery order — product-studio auto-render must resume before seller
 * videos, which wait on it.
 */
import type { StudioModule } from './core/module.js'
import { drama } from './modules/drama/index.js'
import { marketer } from './modules/marketer/index.js'
import { productStudio } from './modules/product-studio/index.js'
import { sellerModule } from './modules/seller/index.js'
import { viralClone } from './modules/viral-clone/index.js'
import { liveModule } from './modules/live/index.js'
import { socialModule } from './modules/social/index.js'

export type { StudioModule, StudioModuleName } from './core/module.js'

export const studioModules: StudioModule[] = [drama, marketer, productStudio, sellerModule, viralClone, liveModule, socialModule]

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
