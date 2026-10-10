/**
 * A misconfigured process must exit, not serve.
 *
 * The behaviour being pinned is not "it throws" — the previous version threw,
 * and that was the defect. A throw during ESM evaluation of the server entry is
 * cached by Node, so every route 500s permanently while the process stays up,
 * answers liveness, and keeps dialling every workspace database. What has to hold
 * is the exit **code**, and that the healthy case does not exit at all.
 */
import { describe, expect, it } from 'vitest'
import { assertBootConfigurationOrExit } from '../boot-config'

function run(
  env: NodeJS.ProcessEnv,
  validateRuntimeConfig: () => void = () => {}
): { exited: number | null } {
  let exited: number | null = null
  assertBootConfigurationOrExit({
    env,
    validateRuntimeConfig,
    exit: ((code: number) => {
      exited = code
      // The real `process.exit` never returns; returning here would let the
      // caller run on past the point where it has decided not to.
      return undefined as never
    }) as (code: number) => never,
  })
  return { exited }
}

describe('assertBootConfigurationOrExit', () => {
  it('exits 1 on an unresolvable MIN_SCHEMA_VERSION', () => {
    expect(run({ MIN_SCHEMA_VERSION: '9999' }).exited).toBe(1)
    expect(run({ MIN_SCHEMA_VERSION: 'nonsense' }).exited).toBe(1)
  })

  it('exits 1 on an unrecognised QUACKBACK_ROLE', () => {
    for (const role of ['banana', 'MIGRATOR', 'Migrator']) {
      expect(run({ QUACKBACK_ROLE: role }).exited, role).toBe(1)
    }
  })

  it('exits 1 when the runtime config fails validation', () => {
    // A config failure used to be thrown from the banner, which left the
    // process up and answering 500 on every route.
    const failing = () => {
      throw new Error('Configuration validation failed')
    }
    expect(run({}, failing).exited).toBe(1)
  })

  it('runs the runtime config validation it is given', () => {
    let called = 0
    run({}, () => {
      called++
    })
    expect(called).toBe(1)
  })

  it('exits 1 when more than one outbound email provider is configured', () => {
    const ses = { EMAIL_SES_ACCESS_KEY_ID: 'AKIA', EMAIL_SES_SECRET_ACCESS_KEY: 's' }
    expect(run({ ...ses, EMAIL_SMTP_HOST: 'smtp.test' }).exited).toBe(1)
    expect(run({ ...ses, EMAIL_RESEND_API_KEY: 're_x' }).exited).toBe(1)
    expect(run({ EMAIL_SMTP_HOST: 'smtp.test', RESEND_API_KEY: 're_x' }).exited).toBe(1)
  })

  it('does not exit for one email provider, or a Resend key declared inbound-only', () => {
    expect(run({ EMAIL_SMTP_HOST: 'smtp.test' }).exited).toBeNull()
    expect(run({ EMAIL_RESEND_API_KEY: 're_x' }).exited).toBeNull()
    expect(
      run({
        EMAIL_SMTP_HOST: 'smtp.test',
        EMAIL_RESEND_API_KEY: 're_x',
        EMAIL_INBOUND_PROVIDER: 'resend',
      }).exited
    ).toBeNull()
  })

  it('does not exit on a valid configuration — the control', () => {
    // Without this, every assertion above would be satisfied by a function that
    // exits unconditionally.
    expect(run({}).exited).toBeNull()
    expect(run({ MIN_SCHEMA_VERSION: '0248', QUACKBACK_ROLE: 'migrator' }).exited).toBeNull()
    expect(run({ QUACKBACK_ROLE: 'web' }).exited).toBeNull()
  })

  it('does not exit during a build, when the environment is not the serving one', () => {
    // The server entry is evaluated to generate the route manifest in an
    // environment that is not the one it will run in, so a build-time reading
    // of these variables says nothing about the deployment.
    expect(run({ QUACKBACK_BUILD: '1', MIN_SCHEMA_VERSION: '9999' }).exited).toBeNull()
    expect(
      run({ QUACKBACK_BUILD: '1' }, () => {
        throw new Error('Config not available during build')
      }).exited
    ).toBeNull()
  })

  it('does not throw past the exit — the caller must never continue', () => {
    // The failure mode this whole module exists to prevent is a process that
    // carries on after deciding it is unfit. A throw here would be caught by
    // the module system and become 500-everything-forever again.
    expect(() => run({ QUACKBACK_ROLE: 'banana' })).not.toThrow()
  })
})

describe('the server entry orders this first', () => {
  it('calls the assert above the warmup that opens sockets', async () => {
    // Ordering asserted on the source, because it is a property of statement
    // order that no unit test of either function can see. Previously the assert
    // ran inside logStartupBanner(), AFTER the warmup fired, and was correct
    // only because a synchronous throw beat a microtask by 115 ms.
    const { readFileSync } = await import('node:fs')
    const { join, dirname } = await import('node:path')
    const { fileURLToPath } = await import('node:url')
    const raw = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../../../server.ts'),
      'utf8'
    )
    // Comments are blanked before searching. The first draft of this test
    // matched `logStartupBanner()` inside the comment that explains why the
    // assert moved, and reported the ordering backwards — a test looking at
    // prose instead of code.
    const entry = raw.replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length))
    const assertAt = entry.indexOf('assertBootConfigurationOrExit()')
    const warmupAt = entry.indexOf("import('@/lib/server/db')")
    const bannerAt = entry.indexOf('logStartupBanner()')
    expect(assertAt).toBeGreaterThan(-1)
    expect(warmupAt).toBeGreaterThan(-1)
    expect(bannerAt).toBeGreaterThan(-1)
    expect(assertAt).toBeLessThan(warmupAt)
    expect(assertAt).toBeLessThan(bannerAt)
  })
})
