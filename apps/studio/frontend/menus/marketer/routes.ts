import type { MenuRoute } from '../index'

// Pages with params (kept out of pages/ so file paths have no [brackets]); URLs unchanged.
export default [
  { name: 'marketer-gallery', path: '/marketer/gallery', view: 'views/gallery.vue' },
  { name: 'marketer-campaign', path: '/marketer/:id', view: 'views/campaign.vue' },
] satisfies MenuRoute[]
