import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

test('project budget, source freshness and export health use isolated data', { timeout: 60_000 }, async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'naka-production-guards-'))
  try {
    const backendDir = path.resolve(import.meta.dirname, '..')
    const child = spawn(process.execPath, [path.join(backendDir, 'node_modules/tsx/dist/cli.mjs'), 'tests/production-guards-scenario.ts'], {
      cwd: backendDir,
      env: { ...process.env, DATABASE_URL: 'pglite://memory', SCRATCH_DIR: directory },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    child.stdout.on('data', chunk => { output += chunk.toString() })
    child.stderr.on('data', chunk => { output += chunk.toString() })
    const exitCode = await new Promise<number | null>(resolve => child.on('exit', resolve))
    assert.equal(exitCode, 0, output)
    assert.match(output, /production guards: passed/)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
