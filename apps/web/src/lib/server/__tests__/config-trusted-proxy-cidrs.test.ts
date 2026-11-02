/**
 * `TRUSTED_PROXY_CIDRS`: an optional comma-separated list of the proxies that
 * may supply client-IP headers. Unset or blank is no list; a list with an
 * unusable entry stops the app from starting rather than being half applied.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

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
  for (const key of ['QUACKBACK_TENANCY', 'TRUSTED_PROXY_CIDRS']) delete process.env[key]
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

async function load(): Promise<{ ok: true; value: string[] } | { ok: false; paths: string[] }> {
  const { resetConfig, config } = await import('../config')
  resetConfig()
  try {
    return { ok: true, value: config.trustedProxyCidrs }
  } catch {
    return { ok: false, paths: logged.issues.map((i) => i.path) }
  }
}

describe('TRUSTED_PROXY_CIDRS', () => {
  it('is an empty list by default and when blank', async () => {
    expect(await load()).toEqual({ ok: true, value: [] })
    process.env.TRUSTED_PROXY_CIDRS = '  '
    expect(await load()).toEqual({ ok: true, value: [] })
  })

  it('is read as a trimmed list', async () => {
    process.env.TRUSTED_PROXY_CIDRS = ' 10.0.0.0/8 , 2001:db8::/32 '
    expect(await load()).toEqual({ ok: true, value: ['10.0.0.0/8', '2001:db8::/32'] })
  })

  it('refuses a list with an unusable entry', async () => {
    for (const value of [
      '10.0.0.0/33',
      'proxy.internal',
      '10.0.0.0/8,',
      '10.0.0.0/8 172.16.0.0/12',
      'fe80::1%eth0/64',
    ]) {
      process.env.TRUSTED_PROXY_CIDRS = value
      expect(await load(), value).toEqual({ ok: false, paths: ['trustedProxyCidrs'] })
    }
  })
})
