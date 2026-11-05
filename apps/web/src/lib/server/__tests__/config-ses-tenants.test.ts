/**
 * `EMAIL_SES_TENANTS`: off by default, and refused at boot when turned on
 * without the configuration set or the identity credential, which the package
 * names the same way (`sesTenantsConfigProblem`).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { sesTenantsConfigProblem } from '@quackback/email/ses-tenant'

const logged = vi.hoisted(() => ({ issues: [] as Array<{ path: string; message: string }> }))
vi.mock('@/lib/server/logger', () => ({
  logger: {
    child: () => ({
      error: (ctx: { issues?: Array<{ path: string; message: string }> }) => {
        if (ctx?.issues) logged.issues = ctx.issues
      },
      warn: () => {},
      info: () => {},
      debug: () => {},
    }),
  },
}))

const KEYS = [
  'QUACKBACK_TENANCY',
  'EMAIL_SES_TENANTS',
  'EMAIL_SES_CONFIGURATION_SET',
  'EMAIL_SES_IDENTITY_ACCESS_KEY_ID',
  'EMAIL_SES_IDENTITY_SECRET_ACCESS_KEY',
]

let saved: NodeJS.ProcessEnv

beforeEach(() => {
  saved = { ...process.env }
  for (const key of KEYS) delete process.env[key]
  Object.assign(process.env, {
    BASE_URL: 'https://app.example.com',
    SECRET_KEY: 'x'.repeat(48),
    DATABASE_URL: 'postgresql://app@localhost:5432/quackback',
  })
  logged.issues = []
})

afterEach(() => {
  process.env = saved
})

async function load(): Promise<{ ok: true; value: unknown } | { ok: false; paths: string[] }> {
  const { resetConfig, config } = await import('../config')
  resetConfig()
  try {
    return { ok: true, value: config.emailSesTenants }
  } catch {
    return { ok: false, paths: logged.issues.map((i) => i.path) }
  }
}

const FULL = {
  EMAIL_SES_TENANTS: 'true',
  EMAIL_SES_CONFIGURATION_SET: 'quackback',
  EMAIL_SES_IDENTITY_ACCESS_KEY_ID: 'AKIAIDENT',
  EMAIL_SES_IDENTITY_SECRET_ACCESS_KEY: 'ident-secret',
}

describe('EMAIL_SES_TENANTS', () => {
  it('is off when unset', async () => {
    expect(await load()).toEqual({ ok: true, value: undefined })
    expect(sesTenantsConfigProblem(process.env)).toBeNull()
  })

  it('boots with the configuration set and the identity credential', async () => {
    Object.assign(process.env, FULL)
    expect(await load()).toEqual({ ok: true, value: true })
    expect(sesTenantsConfigProblem(process.env)).toBeNull()
  })

  it('refuses to boot without the configuration set', async () => {
    Object.assign(process.env, FULL, { EMAIL_SES_CONFIGURATION_SET: '' })
    const result = await load()
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.paths).toContain('emailSesTenants')
    expect(sesTenantsConfigProblem(process.env)).toContain('EMAIL_SES_CONFIGURATION_SET')
  })

  it('refuses to boot without the identity credential', async () => {
    Object.assign(process.env, FULL)
    delete process.env.EMAIL_SES_IDENTITY_SECRET_ACCESS_KEY
    const result = await load()
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.paths).toContain('emailSesTenants')
    expect(sesTenantsConfigProblem(process.env)).toContain('EMAIL_SES_IDENTITY_ACCESS_KEY_ID')
  })
})
