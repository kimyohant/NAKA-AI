/**
 * Ticket 11 — `npm run eval:verdict`.
 * Runs the Verdict sample set through the same judging code the polling
 * round uses (`requestVerdict` on the active text config), 3 times, prints
 * a table per run plus a summary, and writes a dated report naming the model.
 *
 * Slow, costs money, results change between runs: NOT part of `test:social`
 * or CI. Do NOT run against a real LLM without a human approving the cost.
 *
 * Usage: `cd backend && npm run eval:verdict [set.json] [brand.json]`
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MAX_REPLY_CHARS, requestVerdict } from '../src/modules/social/services/responder.js'
import {
  REQUIRED_RUNS,
  scoreCase,
  scoreRun,
  summarizeEval,
  type ActualResult,
  type CaseScore,
  type EvalCase,
  type EvalSummary,
} from './verdict-score.js'

const here = dirname(fileURLToPath(import.meta.url))

export interface CaseResult {
  caseId: string
  actual?: ActualResult
  error?: string
  score: CaseScore
}

export interface RunEvalOpts {
  setPath?: string
  brandPath?: string
  reportDir?: string
  runs?: number
  /** Skips the DB-backed active-config lookup (tests pass a fake name). */
  modelName?: string
  log?: (line: string) => void
}

export interface RunEvalResult {
  model: string
  summary: EvalSummary
  reportPath: string
  /** Replies of the not-in-FAQ cases (last run) for a person to read for invented facts. */
  fallbackReplies: Array<{ id: string; comment: string; reply: string }>
}

interface BrandProfile {
  about: string
  tone: string
  faq: string
  forbidden: string
  defaultLanguage: string
}

async function resolveModelName(): Promise<string> {
  try {
    const { getTextConfig } = await import('../src/core/ai/ai.js')
    const c = await getTextConfig()
    return `${c.provider}/${c.model}`
  } catch {
    return 'unknown (no active text config)'
  }
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'unknown'
}

function tableRow(cols: string[], widths: number[]): string {
  return cols.map((c, i) => c.padEnd(widths[i])).join('  ')
}

export async function runEval(opts: RunEvalOpts = {}): Promise<RunEvalResult> {
  const log = opts.log ?? ((line: string) => console.log(line))
  const setPath = opts.setPath ?? join(here, 'verdict-set.sample.json')
  const brandPath = opts.brandPath ?? join(here, 'verdict-brand.sample.json')
  const reportDir = opts.reportDir ?? join(here, 'reports')
  const runs = opts.runs ?? REQUIRED_RUNS

  const brand = JSON.parse(readFileSync(brandPath, 'utf8')) as BrandProfile
  const set = JSON.parse(readFileSync(setPath, 'utf8')) as { post?: string; cases: EvalCase[] }
  const cases = set.cases
  const model = opts.modelName ?? (await resolveModelName())
  const date = new Date().toISOString().slice(0, 10)

  const out: string[] = []
  const emit = (line = '') => { out.push(line); log(line) }
  emit(`eval:verdict — model ${model}, ${cases.length} cases, ${runs} runs`)

  const allRuns: CaseResult[][] = []
  const scores: ReturnType<typeof scoreRun>[] = []
  for (let r = 0; r < runs; r++) {
    const results: CaseResult[] = []
    for (const c of cases) {
      try {
        const actual = await requestVerdict(
          {
            mode: 'judge',
            brand: {
              about: brand.about ?? '',
              tone: brand.tone ?? '',
              faq: brand.faq ?? '',
              forbidden: brand.forbidden ?? '',
              defaultLanguage: brand.defaultLanguage ?? 'th',
            },
            post: (c.post ?? set.post ?? '').slice(0, 1000),
            comment: c.comment,
            replyToPraise: c.replyToPraise,
          },
          MAX_REPLY_CHARS,
        )
        results.push({ caseId: c.id, actual, score: scoreCase(c, actual) })
      } catch (err) {
        const msg = (err as Error)?.message ?? String(err)
        results.push({ caseId: c.id, error: msg, score: { correct: false, dangerous: false, notes: [`llm error: ${msg}`] } })
      }
    }
    allRuns.push(results)
    // Recount from the per-case scores so LLM errors always count as wrong.
    const correct = results.filter(x => x.score.correct).length
    const dangerous = results.filter(x => x.score.dangerous).length
    const fixed: ReturnType<typeof scoreRun> = {
      total: cases.length, correct, dangerous,
      accuracy: cases.length ? correct / cases.length : 0,
    }
    scores.push(fixed)
    emit(`\nrun ${r + 1}/${runs} — accuracy ${fixed.correct}/${fixed.total} (${(fixed.accuracy * 100).toFixed(1)}%), dangerous ${fixed.dangerous}`)
    emit(tableRow(['case', 'expected', 'got', 'fallback', 'ok', 'notes'], [22, 12, 12, 10, 4, 40]))
    for (const x of results) {
      const c = cases.find(k => k.id === x.caseId)!
      emit(tableRow([
        x.caseId,
        c.expected,
        x.actual ? x.actual.verdict : 'ERROR',
        `${!!x.actual?.fallback}/${c.fallback}`,
        x.score.correct ? 'ok' : 'XX',
        x.score.notes.join('; ').slice(0, 60),
      ], [22, 12, 12, 10, 4, 40]))
    }
  }

  const summary = summarizeEval(scores)
  emit(`\nsummary — runs: ${runs}, cases: ${cases.length}`)
  scores.forEach((s, i) => emit(`run ${i + 1}: accuracy ${(s.accuracy * 100).toFixed(1)}%, dangerous ${s.dangerous}`))
  emit(`average accuracy ${(summary.avgAccuracy * 100).toFixed(1)}% — ${summary.pass ? 'PASS' : 'FAIL'}`)

  // Fallback replies of the not-in-FAQ cases (last run) for a person to read for invented facts.
  const last = allRuns[allRuns.length - 1]
  const fallbackReplies = cases
    .filter(c => c.tags.includes('not-in-faq'))
    .map(c => ({
      id: c.id,
      comment: c.comment,
      reply: last.find(x => x.caseId === c.id)?.actual?.reply ?? '(no reply)',
    }))
  emit('\nfallback replies (not-in-FAQ cases, last run) — a person reads these for invented facts:')
  for (const f of fallbackReplies) emit(`- ${f.id}: ${f.reply}`)

  mkdirSync(reportDir, { recursive: true })
  const reportPath = join(reportDir, `verdict-${date}-${slug(model)}.md`)
  writeFileSync(reportPath, `# eval:verdict report\n\n- date: ${date}\n- model: ${model}\n- set: ${setPath}\n- cases: ${cases.length}, runs: ${runs}\n\n${out.join('\n')}\n`)
  emit(`\nreport: ${reportPath}`)
  return { model, summary, reportPath, fallbackReplies }
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url)
if (isMain) {
  await runEval({ setPath: process.argv[2], brandPath: process.argv[3] })
  // the model config is read from PostgreSQL: close the pool so the script exits
  await (await import('../src/core/db/index.js')).closeDb()
}
