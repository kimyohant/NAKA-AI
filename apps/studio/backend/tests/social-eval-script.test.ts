/**
 * Ticket 11 — the eval script runs the set 3 times and writes a dated
 * report naming the model, shown with a fake LLM (mastra getter swap).
 * Not part of `test:social` or CI (see package.json / ci.yml).
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

const dir = mkdtempSync(path.join(tmpdir(), 'naka-social-eval-'))
process.env.DATABASE_URL = 'pglite://memory'
process.env.STORAGE_PATH = path.join(dir, 'static')

const { mastra } = await import('../src/core/mastra/index.js')
const { runEval } = await import('../eval/verdict.js')

const seenPayloads: any[] = []
let generateCalls = 0
const realGetAgent = mastra.getAgent.bind(mastra)
;(mastra as any).getAgent = (type: string) => {
  if (type !== 'social_responder') return realGetAgent(type)
  return {
    generate: async (messages: Array<{ content: string }>) => {
      generateCalls++
      const payload = JSON.parse(messages[0].content)
      seenPayloads.push(payload)
      return { text: answerFor(payload) }
    },
  }
}

// A perfect fake judge: answers from the expected labels in the sample set.
const set = JSON.parse(readFileSync(new URL('../eval/verdict-set.sample.json', import.meta.url), 'utf8'))
const byComment = new Map<string, any>()
for (const c of set.cases) {
  const key = `${c.comment}|${c.replyToPraise}`
  if (c.expected === 'reply' && !c.fallback) {
    byComment.set(key, { verdict: 'reply', reason: 'test answer', reply: 'ราคา 99 บาทค่ะ', fallback: false })
  } else if (c.expected === 'reply') {
    byComment.set(key, { verdict: 'reply', reason: 'not in faq', reply: 'Please message our Page inbox.', fallback: true })
  } else if (c.expected === 'skipped') {
    byComment.set(key, { verdict: 'skip', reason: 'test skip' })
  } else {
    byComment.set(key, { verdict: 'human', reason: 'test human' })
  }
}
function answerFor(payload: any): string {
  const found = byComment.get(`${payload.comment}|${payload.replyToPraise}`)
  if (!found) throw new Error(`no fake answer for: ${payload.comment}`)
  return JSON.stringify(found)
}

test('runs the set 3 times and writes a dated report with the model name', async () => {
  const lines: string[] = []
  const reportDir = path.join(dir, 'reports')
  const before = generateCalls
  const result = await runEval({
    modelName: 'test/fake-model',
    reportDir,
    log: (line: string) => lines.push(line),
  })
  const total = set.cases.length * 3
  assert.equal(generateCalls - before, total)
  assert.equal(result.model, 'test/fake-model')
  assert.equal(result.summary.pass, true)
  assert.equal(result.summary.avgAccuracy, 1)

  const files = readdirSync(reportDir)
  assert.equal(files.length, 1)
  assert.match(files[0], /^verdict-\d{4}-\d{2}-\d{2}-test-fake-model\.md$/)
  assert.equal(result.reportPath, path.join(reportDir, files[0]))
  const report = readFileSync(result.reportPath, 'utf8')
  assert.ok(report.includes('test/fake-model'))

  const text = lines.join('\n')
  assert.ok(text.includes('run 1/3'))
  assert.ok(text.includes('run 3/3'))
  assert.ok(text.includes('PASS'))
  // fallback replies of the not-in-FAQ cases are printed for a person to read
  assert.ok(text.includes('fallback replies'))
  assert.equal(result.fallbackReplies.length, 2)
})

test('praise cases carry the switch value passed to the agent', async () => {
  const praise = seenPayloads.filter(p => p.comment === 'สบู่หอมมากค่ะ ❤️')
  assert.deepEqual([...new Set(praise.map(p => p.replyToPraise))].sort(), [false, true])
})
