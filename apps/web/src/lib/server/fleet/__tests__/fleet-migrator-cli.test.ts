/**
 * The fleet-migrator CLI's exit-2 contract: a missing control database is an
 * invocation error, not a workspace failure. Spawned rather than imported,
 * because the script calls `main()` at module load.
 */
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../../scripts/fleet-migrator.ts'
)

function runCli(
  args: string[],
  extraEnv: NodeJS.ProcessEnv = {}
): Promise<{
  code: number | null
  stderr: string
  stdout: string
}> {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extraEnv }
  delete env.QUACKBACK_CONTROL_DATABASE_URL
  return new Promise((resolve, reject) => {
    const child = spawn('bun', [SCRIPT, ...args], {
      env,
      cwd: join(dirname(SCRIPT), '..'),
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (c: Buffer) => {
      stdout += c.toString()
    })
    child.stderr.on('data', (c: Buffer) => {
      stderr += c.toString()
    })
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`fleet-migrator hung\nstdout:\n${stdout}\nstderr:\n${stderr}`))
    }, 25_000)
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })
}

describe('fleet-migrator CLI invocation', () => {
  it('exits 2 when enrol is invoked with no control database', async () => {
    const result = await runCli(['enrol'])
    expect(result.code).toBe(2)
    expect(result.stderr).toMatch(/no control database/)
  })

  it('exits 2 on a bad argument rather than starting work', async () => {
    const result = await runCli(['enrol', '--not-a-flag'])
    expect(result.code).toBe(2)
    expect(result.stderr).toMatch(/unknown argument/)
  })
})
