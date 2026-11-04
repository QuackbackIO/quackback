/**
 * `EMAIL_RETURN_PATH_DOMAIN`: optional domain the operator serves bounce
 * records under. The app validates it here and the identity module reads it
 * itself, so the two must agree: blank is unset in both, and a value the
 * module would ignore stops boot instead.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { sesReturnPathDomain } from '@quackback/email/ses-identity'

const logged = vi.hoisted(() => ({ issues: [] as Array<{ path: string; code: string }> }))
vi.mock('@/lib/server/logger', () => ({
  logger: {
    child: () => ({
      error: (ctx: { issues?: Array<{ path: string; code: string }> }) => {
        if (ctx?.issues) logged.issues = ctx.issues
      },
      warn: () => {},
      info: () => {},
      debug: () => {},
    }),
  },
}))

let saved: NodeJS.ProcessEnv

beforeEach(() => {
  saved = { ...process.env }
  for (const key of ['QUACKBACK_TENANCY', 'EMAIL_RETURN_PATH_DOMAIN']) delete process.env[key]
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

async function load(): Promise<
  { ok: true; value: string | undefined } | { ok: false; paths: string[] }
> {
  const { resetConfig, config } = await import('../config')
  resetConfig()
  try {
    return { ok: true, value: config.emailReturnPathDomain }
  } catch {
    return { ok: false, paths: logged.issues.map((i) => i.path) }
  }
}

describe('EMAIL_RETURN_PATH_DOMAIN', () => {
  it('is unset when absent, empty or whitespace', async () => {
    for (const value of [undefined, '', '   ']) {
      if (value === undefined) delete process.env.EMAIL_RETURN_PATH_DOMAIN
      else process.env.EMAIL_RETURN_PATH_DOMAIN = value
      expect(await load(), JSON.stringify(value)).toEqual({ ok: true, value: undefined })
      expect(sesReturnPathDomain(), JSON.stringify(value)).toBeNull()
    }
  })

  it('accepts a domain name the identity module reads the same way', async () => {
    process.env.EMAIL_RETURN_PATH_DOMAIN = ' Bounces.Example.net '
    expect(await load()).toEqual({ ok: true, value: 'bounces.example.net' })
    expect(sesReturnPathDomain()).toBe('bounces.example.net')
  })

  it('refuses a value that is not a domain name', async () => {
    for (const value of ['bounces', 'https://bounces.example.net', '*.bounces.example.net']) {
      process.env.EMAIL_RETURN_PATH_DOMAIN = value
      const result = await load()
      expect(result.ok, value).toBe(false)
      if (!result.ok) expect(result.paths, value).toContain('emailReturnPathDomain')
      expect(sesReturnPathDomain(), value).toBeNull()
    }
  })
})
