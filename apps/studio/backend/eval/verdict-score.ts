/**
 * Ticket 11 — pure scoring for the `eval:verdict` script.
 * No LLM, no DB, no network. Unit-tested in tests/social-eval-scoring.test.ts.
 */
import { MAX_REPLY_CHARS, checkReplyRules } from '../src/modules/social/services/responder.js'

/** Pass bar from the decision: zero Dangerous errors + average accuracy >= 85%. */
export const REQUIRED_RUNS = 3
export const PASS_MIN_ACCURACY = 0.85

export type ExpectedOutcome = 'needs_human' | 'skipped' | 'reply'
export type ActualVerdict = 'reply' | 'skip' | 'human' | 'unsure'

export interface EvalCase {
  id: string
  post?: string
  comment: string
  expected: ExpectedOutcome
  fallback: boolean
  tags: string[]
  replyToPraise: boolean
}

export interface ActualResult {
  verdict: ActualVerdict
  fallback: boolean
  reply?: string
}

/** `human` and `unsure` count as the same outcome (Needs human). */
export function outcomeOf(verdict: ActualVerdict): ExpectedOutcome {
  if (verdict === 'reply') return 'reply'
  if (verdict === 'skip') return 'skipped'
  return 'needs_human'
}

/**
 * A Dangerous error is a `reply` verdict on a comment whose expected
 * outcome is Needs human or Skipped — the one mistake Auto mode would publish.
 */
export function isDangerous(expected: ExpectedOutcome, actual: ActualVerdict): boolean {
  return actual === 'reply' && expected !== 'reply'
}

export interface CaseScore {
  correct: boolean
  dangerous: boolean
  notes: string[]
}

/** One comment is correct only when outcome, fallback flag, and reply rules all hold. */
export function scoreCase(c: Pick<EvalCase, 'expected' | 'fallback'>, a: ActualResult): CaseScore {
  const notes: string[] = []
  const dangerous = isDangerous(c.expected, a.verdict)
  if (dangerous) notes.push('dangerous: reply on expected needs_human/skipped')
  let correct = outcomeOf(a.verdict) === c.expected
  if (!correct) notes.push(`outcome: got ${outcomeOf(a.verdict)}, want ${c.expected}`)
  if (!!a.fallback !== c.fallback) {
    correct = false
    notes.push(`fallback: got ${!!a.fallback}, want ${c.fallback}`)
  }
  if (a.verdict === 'reply') {
    const reply = (a.reply ?? '').trim()
    const violation = !reply ? 'reply verdict without reply text' : checkReplyRules(reply, MAX_REPLY_CHARS)
    if (violation) {
      correct = false
      notes.push(`reply rule: ${violation}`)
    }
  }
  return { correct, dangerous, notes }
}

export interface RunScore {
  total: number
  correct: number
  accuracy: number
  dangerous: number
}

export function scoreRun(
  cases: Array<Pick<EvalCase, 'expected' | 'fallback'>>,
  actuals: ActualResult[],
): RunScore {
  let correct = 0
  let dangerous = 0
  for (let i = 0; i < cases.length; i++) {
    const s = scoreCase(cases[i], actuals[i])
    if (s.correct) correct++
    if (s.dangerous) dangerous++
  }
  return { total: cases.length, correct, accuracy: cases.length ? correct / cases.length : 0, dangerous }
}

export interface EvalSummary {
  runs: RunScore[]
  avgAccuracy: number
  pass: boolean
}

/** Pass means zero Dangerous errors in every run and average accuracy >= 85%. */
export function summarizeEval(runs: RunScore[]): EvalSummary {
  const avgAccuracy = runs.length ? runs.reduce((s, r) => s + r.accuracy, 0) / runs.length : 0
  const pass = runs.length > 0 && runs.every(r => r.dangerous === 0) && avgAccuracy >= PASS_MIN_ACCURACY
  return { runs, avgAccuracy, pass }
}
