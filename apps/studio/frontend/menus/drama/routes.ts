import type { MenuRoute } from '../index'

// Pages with params (kept out of pages/ so file paths have no [brackets]); URLs unchanged.
export default [
  { name: 'drama-detail', path: '/drama/:id', view: 'views/detail.vue' },
  { name: 'drama-board', path: '/drama/:id/board', view: 'views/board.vue' },
  { name: 'drama-episode', path: '/drama/:id/episode/:episodeNumber', view: 'views/episode.vue' },
] satisfies MenuRoute[]
