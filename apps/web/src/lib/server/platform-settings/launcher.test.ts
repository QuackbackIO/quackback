import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { it, expect } from 'vitest'
function run(
  cloud: boolean,
  status = 200
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const dir = mkdtempSync(join(tmpdir(), 'cloud-settings-launch-'))
  const preload = join(dir, 'fetch.ts')
  const entrypoint = join(dir, 'start.sh')
  writeFileSync(
    preload,
    `globalThis.fetch = async () => ${cloud ? `new Response(JSON.stringify({ settings: { BOOT_TEST_VALUE: 'from-cp' }, revision: 1 }), { status: ${status} })` : `Promise.reject(new Error('Self-host must never call CP'))`};`
  )
  writeFileSync(entrypoint, '#!/bin/sh\nprintf "application:%s" "$BOOT_TEST_VALUE"\nexit 17\n')
  return new Promise((resolveResult, reject) => {
    const child = spawn(
      'bun',
      ['--preload', preload, 'apps/web/scripts/container-start.ts', entrypoint],
      {
        cwd: resolve('.'),
        env: {
          ...process.env,
          QUACKBACK_TENANCY: cloud ? 'pooled' : 'single',
          QUACKBACK_CONTROL_PLANE_URL: 'https://cp.example.com',
          QUACKBACK_CP_SETTINGS_TOKEN: 'k'.repeat(32),
          BOOT_TEST_VALUE: 'from-env',
        },
      }
    )
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (data) => {
      stdout += data
    })
    child.stderr.on('data', (data) => {
      stderr += data
    })
    const timeout = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error('Launcher timed out'))
    }, 5000)
    child.on('error', reject)
    child.on('exit', (code) => {
      clearTimeout(timeout)
      resolveResult({ code, stdout, stderr })
    })
  })
}
it('starts the application only after CP overrides are in its environment, and preserves exit status', async () => {
  const result = await run(true)
  expect(result).toMatchObject({ code: 17, stdout: 'application:from-cp', stderr: '' })
})
it('leaves self-hosted environment unchanged without contacting CP', async () => {
  expect(await run(false)).toMatchObject({ code: 17, stdout: 'application:from-env', stderr: '' })
})
it('never starts the application when Cloud settings authentication fails', async () => {
  const result = await run(true, 401)
  expect(result.code).toBe(1)
  expect(result.stdout).toBe('')
  expect(result.stderr).toContain('HTTP 401')
})
it('ships the bootstrap launcher as the container entrypoint', () => {
  const dockerfile = readFileSync('apps/web/Dockerfile', 'utf8')
  expect(dockerfile).toContain('apps/web/scripts/container-start.ts')
  expect(dockerfile).toContain('/tmp/container-start.mjs ./container-start.mjs')
  expect(dockerfile).toContain('ENTRYPOINT ["bun", "./container-start.mjs"]')
})
