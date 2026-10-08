// Frontend/backend contract checks: the user-facing frontend is frontend/ in this repo (NAKA_FRONTEND_DIR overrides);
// when absent the frontend half of a contract assertion is skipped (the backend half still runs).
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const FRONTEND_DIR = path.resolve(process.env.NAKA_FRONTEND_DIR
  || fileURLToPath(new URL('../../frontend/', import.meta.url)))
export const hasFrontend = existsSync(path.join(FRONTEND_DIR, 'app'))
export const readFrontend = (p) => readFileSync(path.join(FRONTEND_DIR, p), 'utf8')
if (!hasFrontend) console.log(`# frontend contract checks skipped: ${FRONTEND_DIR} not found (set NAKA_FRONTEND_DIR)`)
