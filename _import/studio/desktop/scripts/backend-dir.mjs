/**
 * Where the desktop build finds the server code (same repo):
 *   backend/  ← API server (bundled into build/backend.mjs)
 *   admin/    ← back-office (system settings), copied to resources/admin
 * Override with NAKA_BACKEND_DIR=/path/to/backend.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(__dirname, '..', '..')

export const BACKEND_DIR = path.resolve(process.env.NAKA_BACKEND_DIR || path.join(REPO, 'backend'))
export const ADMIN_BUILD_DIR = path.resolve(BACKEND_DIR, '..', 'admin', '.output', 'public')

export function requireBackendDir() {
  if (!fs.existsSync(path.join(BACKEND_DIR, 'src', 'index.ts'))) {
    console.error(`Backend not found at ${BACKEND_DIR}\n` +
      'Run npm ci in backend/, or set NAKA_BACKEND_DIR=/path/to/backend')
    process.exit(1)
  }
  return BACKEND_DIR
}
