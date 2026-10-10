/**
 * Wrapper — runs tests/video-task-lifecycle-scenario.ts in a child process on a throwaway database
 * (DATABASE_URL=pglite://memory) and data directory, like tests/unsloth-queue.test.ts.
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

test('video task lifecycle: fractional duration write-back, cancel, lost provider job, stalled queue', { timeout: 180_000 }, async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'naka-video-lifecycle-'))
  try {
    const backendDir = path.resolve(import.meta.dirname, '..')
    const child = spawn(process.execPath, [path.join(backendDir, 'node_modules/tsx/dist/cli.mjs'), 'tests/video-task-lifecycle-scenario.ts'], {
      cwd: backendDir,
      env: { ...process.env, DATABASE_URL: 'pglite://memory', NAKA_DATA_DIR: directory },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    child.stdout.on('data', chunk => { output += chunk.toString() })
    child.stderr.on('data', chunk => { output += chunk.toString() })
    const exitCode = await new Promise<number | null>(resolve => child.on('exit', resolve))
    assert.equal(exitCode, 0, output.slice(-4000))
    assert.match(output, /video task lifecycle: passed/)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
