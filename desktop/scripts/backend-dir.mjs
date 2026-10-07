/**
 * The backend lives in its own repo (kimyohant/naka-ai-backend) since it moved out of this one.
 * Desktop builds expect it checked out next to naka-drama-studio:
 *   work/naka-drama-studio/desktop   ← here
 *   work/naka-ai-backend/backend     ← API server (bundled into build/backend.mjs)
 *   work/naka-ai-backend/admin       ← back-office (system settings), copied to resources/admin
 * Override with NAKA_BACKEND_DIR=/path/to/naka-ai-backend/backend.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(__dirname, '..', '..')

export const BACKEND_DIR = path.resolve(process.env.NAKA_BACKEND_DIR || path.join(REPO, '..', 'naka-ai-backend', 'backend'))
export const ADMIN_BUILD_DIR = path.resolve(BACKEND_DIR, '..', 'admin', '.output', 'public')

export function requireBackendDir() {
  if (!fs.existsSync(path.join(BACKEND_DIR, 'src', 'index.ts'))) {
    console.error(`Backend not found at ${BACKEND_DIR}\n` +
      'Clone https://github.com/kimyohant/naka-ai-backend next to naka-drama-studio (and run npm ci in its backend/),\n' +
      'or set NAKA_BACKEND_DIR=/path/to/naka-ai-backend/backend')
    process.exit(1)
  }
  return BACKEND_DIR
}
