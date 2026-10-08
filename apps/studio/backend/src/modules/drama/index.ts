/**
 * Drama (AI short drama pipeline) — the menu's single entry point. Other menus import from this file only
 * (never from ./routes or ./services directly); see docs/adr/0003-studio-modules-level2.md.
 */
import type { StudioModule } from '../../core/module.js'
import dramas from './routes/dramas.js'
import episodes from './routes/episodes.js'
import storyboards from './routes/storyboards.js'
import scenes from './routes/scenes.js'
import characters from './routes/characters.js'
import props from './routes/props.js'
import merge from './routes/merge.js'

export const drama: StudioModule = {
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
}
