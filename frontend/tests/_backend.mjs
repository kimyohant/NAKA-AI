// Cross-repo contract checks: the backend lives in kimyohant/naka-ai-backend.
// Found next to this repo (../naka-ai-backend/backend) or via NAKA_BACKEND_DIR; tests that compare against
// backend sources skip themselves when it is not checked out.
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const BACKEND_DIR = path.resolve(process.env.NAKA_BACKEND_DIR
  || fileURLToPath(new URL('../../../naka-ai-backend/backend/', import.meta.url)))
export const hasBackend = existsSync(path.join(BACKEND_DIR, 'src'))
export const backendUrl = (p) => pathToFileURL(path.join(BACKEND_DIR, p))
export const readBackend = (p) => readFileSync(path.join(BACKEND_DIR, p), 'utf8')
/** pass as `{ skip: backendSkip }` */
export const backendSkip = hasBackend ? false : `backend not found at ${BACKEND_DIR} (clone naka-ai-backend next to this repo or set NAKA_BACKEND_DIR)`
