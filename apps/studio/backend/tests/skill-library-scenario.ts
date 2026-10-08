import assert from 'node:assert/strict'
import { Hono } from 'hono'
import skillsRoute from '../src/core/routes/skills.js'
import { loadAgentSkills } from '../src/core/agents/skills.js'
import { skillLibrary } from '../src/core/agents/skill-library.js'

const app = new Hono()
app.route('/api/v1/skills', skillsRoute)

assert.equal(skillLibrary.length, 32)
assert.equal(new Set(skillLibrary.map(skill => skill.id)).size, skillLibrary.length)
assert.equal(await loadAgentSkills('script_rewriter', 'th'), '')

const listed = await app.request('/api/v1/skills/library?lang=th')
assert.equal(listed.status, 200)
const entries = (await listed.json()).data
assert.equal(entries.length, 32)
assert.ok(entries.every((item: { installed: boolean }) => !item.installed))

const id = 'script-rewriter/opening-hook'
const installed = await app.request(`/api/v1/skills/library/${id}`, { method: 'POST' })
assert.equal(installed.status, 200, await installed.text())
const instructions = await loadAgentSkills('script_rewriter', 'th')
assert.match(instructions, /concrete action, discovery, or contradiction/)
assert.equal(await loadAgentSkills('extractor', 'th'), '')

const nestedId = 'prompt-generator/video-prompt/camera-precision'
const nested = await app.request(`/api/v1/skills/library/${nestedId}`, { method: 'POST' })
assert.equal(nested.status, 200, await nested.text())
assert.match(await loadAgentSkills('prompt_generator', 'th'), /camera height, angle, subject placement/)
assert.doesNotMatch(await loadAgentSkills('script_rewriter', 'th'), /camera height, angle, subject placement/)

const listedAgain = await app.request('/api/v1/skills/library?lang=th')
const hook = (await listedAgain.json()).data.find((item: { id: string }) => item.id === id)
assert.equal(hook.installed, true)
const duplicate = await app.request(`/api/v1/skills/library/${id}`, { method: 'POST' })
assert.equal(duplicate.status, 400)
console.log('skill library: passed')
