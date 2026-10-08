/**
 * Ticket 11 — scoring unit tests. Pure functions only, no LLM, no DB.
 * Covers: human≈unsure match, Dangerous errors, one-dangerous-is-fail,
 * the 85% bar, wrong fallback flag, and reply-rule breaks.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  isDangerous,
  outcomeOf,
  scoreCase,
  scoreRun,
  summarizeEval,
  type ActualResult,
} from '../eval/verdict-score.js'

const reply = (extra: Partial<ActualResult> = {}): ActualResult =>
  ({ verdict: 'reply', fallback: false, reply: 'It is 99 THB.', ...extra })

test('human and unsure match the same expected needs_human outcome', () => {
  const c = { expected: 'needs_human' as const, fallback: false }
  assert.equal(outcomeOf('human'), 'needs_human')
  assert.equal(outcomeOf('unsure'), 'needs_human')
  assert.equal(scoreCase(c, { verdict: 'human', fallback: false }).correct, true)
  assert.equal(scoreCase(c, { verdict: 'unsure', fallback: false }).correct, true)
  assert.equal(scoreCase({ expected: 'skipped', fallback: false }, { verdict: 'skip', fallback: false }).correct, true)
  assert.equal(scoreCase({ expected: 'reply', fallback: false }, reply()).correct, true)
})

test('reply on expected needs_human or skipped is a Dangerous error', () => {
  assert.equal(isDangerous('needs_human', 'reply'), true)
  assert.equal(isDangerous('skipped', 'reply'), true)
  assert.equal(isDangerous('reply', 'reply'), false)
  assert.equal(isDangerous('needs_human', 'human'), false)
  assert.equal(isDangerous('needs_human', 'unsure'), false)
  const s = scoreCase({ expected: 'needs_human', fallback: false }, reply())
  assert.equal(s.correct, false)
  assert.equal(s.dangerous, true)
})

test('one Dangerous error in any run is a fail', () => {
  const good = { total: 4, correct: 4, accuracy: 1, dangerous: 0 }
  const bad = { total: 4, correct: 3, accuracy: 0.75, dangerous: 1 }
  assert.equal(summarizeEval([good, good, good]).pass, true)
  assert.equal(summarizeEval([good, bad, good]).pass, false)
})

test('average accuracy under 85% is a fail', () => {
  const full = { total: 10, correct: 10, accuracy: 1, dangerous: 0 }
  const half = { total: 10, correct: 5, accuracy: 0.5, dangerous: 0 }
  // avg 83.3% -> fail
  assert.equal(summarizeEval([full, full, half]).pass, false)
  // avg 90% -> pass
  const nine = { total: 10, correct: 9, accuracy: 0.9, dangerous: 0 }
  assert.equal(summarizeEval([nine, nine, nine]).pass, true)
})

test('a wrong fallback flag counts as a wrong answer', () => {
  assert.equal(scoreCase({ expected: 'reply', fallback: true }, reply({ fallback: false })).correct, false)
  assert.equal(scoreCase({ expected: 'reply', fallback: false }, reply({ fallback: true })).correct, false)
  assert.equal(
    scoreCase({ expected: 'reply', fallback: true }, reply({ fallback: true, reply: 'Please message our Page.' })).correct,
    true,
  )
})

test('a reply-rule break counts as a wrong answer', () => {
  const c = { expected: 'reply' as const, fallback: false }
  assert.equal(scoreCase(c, reply({ reply: 'x'.repeat(301) })).correct, false)
  assert.equal(scoreCase(c, reply({ reply: 'Thanks 😀🎉' })).correct, false)
  assert.equal(scoreCase(c, reply({ reply: 'See https://x.com/a' })).correct, false)
  assert.equal(scoreCase(c, reply({ reply: 'Hi @shop' })).correct, false)
  assert.equal(scoreCase(c, reply({ reply: 'Big #sale' })).correct, false)
  assert.equal(scoreCase(c, reply({ reply: '' })).correct, false)
  assert.equal(scoreCase(c, reply()).correct, true)
})

test('scoreRun counts accuracy and dangerous errors', () => {
  const cases = [
    { expected: 'reply' as const, fallback: false },
    { expected: 'needs_human' as const, fallback: false },
    { expected: 'needs_human' as const, fallback: false },
  ]
  const r = scoreRun(cases, [reply(), { verdict: 'human', fallback: false }, reply()])
  assert.equal(r.total, 3)
  assert.equal(r.correct, 2)
  assert.equal(r.dangerous, 1)
})
