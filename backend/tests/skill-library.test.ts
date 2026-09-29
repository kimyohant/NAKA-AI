import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

test('library installation is optional and scoped to its agent', { timeout: 60_000 }, async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'naka-skill-library-'))
  try {
    const backendDir = path.resolve(import.meta.dirname, '..')
    const child = spawn(process.execPath, [path.join(backendDir, 'node_modules/tsx/dist/cli.mjs'), 'tests/skill-library-scenario.ts'], {
      cwd: backendDir,
      env: { ...process.env, WORKSPACE_PATH: directory },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    child.stdout.on('data', chunk => { output += chunk.toString() })
    child.stderr.on('data', chunk => { output += chunk.toString() })
    const exitCode = await new Promise<number | null>(resolve => child.on('exit', resolve))
    assert.equal(exitCode, 0, output)
    assert.match(output, /skill library: passed/)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
