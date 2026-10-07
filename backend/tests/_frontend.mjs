// Cross-repo contract checks: the user-facing frontend lives in kimyohant/naka-drama-studio.
// Found next to this repo (../naka-drama-studio/frontend) or via NAKA_FRONTEND_DIR; when absent the
// frontend half of a contract assertion is skipped (the backend half still runs).
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const FRONTEND_DIR = path.resolve(process.env.NAKA_FRONTEND_DIR
  || fileURLToPath(new URL('../../../naka-drama-studio/frontend/', import.meta.url)))
export const hasFrontend = existsSync(path.join(FRONTEND_DIR, 'app'))
export const readFrontend = (p) => readFileSync(path.join(FRONTEND_DIR, p), 'utf8')
if (!hasFrontend) console.log(`# frontend contract checks skipped: ${FRONTEND_DIR} not found (set NAKA_FRONTEND_DIR)`)
