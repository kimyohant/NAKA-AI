/**
 * Contract every product menu implements (src/modules/<menu>/index.ts, listed in src/modules.ts).
 * docs/adr/0003-studio-modules-level2.md
 */
import type { Hono } from 'hono'

export type StudioModuleName = 'drama' | 'marketer' | 'product-studio' | 'seller' | 'viral-clone' | 'live'

export interface StudioModule {
  name: StudioModuleName
  /** Mount this menu's routers on the /api/v1 sub-app (paths unchanged from before the split). */
  mount: (api: Hono) => void
  /** Startup: fail work left in a running state by a restart. Returns the number of rows touched. */
  failStale?: () => Promise<number>
  /** Startup: continue pipelines interrupted by a restart. Returns the number resumed. */
  resume?: () => Promise<number>
}
