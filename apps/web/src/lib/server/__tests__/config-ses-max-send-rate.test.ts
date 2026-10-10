/**
 * `EMAIL_SES_MAX_SEND_RATE`: optional sends per second for this process. The
 * app validates it here and the SES transport reads it itself, so the two must
 * agree on what counts as unset: a blank or whitespace-only value is unset in
 * both (the transport's default applies), not a refused boot in one and the
 * default in the other.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { DEFAULT_SES_MAX_SEND_RATE, sesMaxSendRate } from '@quackback/email/ses'

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
  for (const key of ['QUACKBACK_TENANCY', 'EMAIL_SES_MAX_SEND_RATE']) delete process.env[key]
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
  { ok: true; value: number | undefined } | { ok: false; paths: string[] }
> {
  const { resetConfig, config } = await import('../config')
  resetConfig()
  try {
    return { ok: true, value: config.emailSesMaxSendRate }
  } catch {
    return { ok: false, paths: logged.issues.map((i) => i.path) }
  }
}

describe('EMAIL_SES_MAX_SEND_RATE', () => {
  it('is unset when absent, empty or whitespace, and the transport then uses its default', async () => {
    for (const value of [undefined, '', '   ', '\t']) {
      if (value === undefined) delete process.env.EMAIL_SES_MAX_SEND_RATE
      else process.env.EMAIL_SES_MAX_SEND_RATE = value
      expect(await load(), JSON.stringify(value)).toEqual({ ok: true, value: undefined })
      expect(sesMaxSendRate(), JSON.stringify(value)).toBe(DEFAULT_SES_MAX_SEND_RATE)
    }
  })

  it('reads the same rate the transport paces at, padding and all', async () => {
    process.env.EMAIL_SES_MAX_SEND_RATE = ' 4.5 '
    expect(await load()).toEqual({ ok: true, value: 4.5 })
    expect(sesMaxSendRate()).toBe(4.5)
  })

  it('refuses a value that is not a positive rate', async () => {
    for (const value of ['0', '-2', 'fast']) {
      process.env.EMAIL_SES_MAX_SEND_RATE = value
      const result = await load()
      expect(result.ok, value).toBe(false)
      if (!result.ok) expect(result.paths, value).toContain('emailSesMaxSendRate')
    }
  })
})
