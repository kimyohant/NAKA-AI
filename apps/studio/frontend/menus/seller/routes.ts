import type { MenuRoute } from '../index'

// Pages with params (kept out of pages/ so file paths have no [brackets]); URLs unchanged.
export default [
  { name: 'seller-workspace', path: '/seller/:id', view: 'views/workspace.vue' },
] satisfies MenuRoute[]
