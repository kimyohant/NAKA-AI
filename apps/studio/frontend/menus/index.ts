/**
 * Studio menus as Nuxt layers (docs/adr/0003-studio-modules-level2.md §3).
 *
 * Each menu folder is a Nuxt layer with its own pages/, views/, components/ and utils/, mirroring
 * backend/src/modules/<menu>/. MENUS is the one switch: nuxt.config.ts extends these layers and
 * registers their param routes; drop a menu here to build the app without it.
 * Shared UI (layouts, base components, composables, i18n, assets, public) stays in app/.
 */
import drama from './drama/routes'
import marketer from './marketer/routes'
import product_studio from './product-studio/routes'
import seller from './seller/routes'
import viral_clone from './viral-clone/routes'
import live from './live/routes'
import social from './social/routes'

export interface MenuRoute {
  name: string
  path: string
  /** file inside the menu folder, e.g. 'views/workspace.vue' */
  view: string
}

export const MENUS = ['drama', 'marketer', 'product-studio', 'seller', 'viral-clone', 'live', 'social'] as const
export type MenuName = typeof MENUS[number]

export const MENU_ROUTES: Record<MenuName, MenuRoute[]> = {
  'drama': drama,
  'marketer': marketer,
  'product-studio': product_studio,
  'seller': seller,
  'viral-clone': viral_clone,
  'live': live,
  'social': social,
}
