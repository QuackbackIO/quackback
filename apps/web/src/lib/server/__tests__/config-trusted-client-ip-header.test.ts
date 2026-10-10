/**
 * `TRUSTED_CLIENT_IP_HEADER`: an optional header name the operator's proxy sets
 * to the client address. It is normalised to lowercase and refused when it is
 * not a header name, is X-Forwarded-For, or is one of the app's own headers.
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
  for (const key of ['QUACKBACK_TENANCY', 'TRUSTED_CLIENT_IP_HEADER', 'TRUSTED_PROXY_HOPS']) {
    delete process.env[key]
  }
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
    return { ok: true, value: config.trustedClientIpHeader }
  } catch {
    return { ok: false, paths: logged.issues.map((i) => i.path) }
  }
}

describe('TRUSTED_CLIENT_IP_HEADER', () => {
  it('is unset by default and when blank', async () => {
    expect(await load()).toEqual({ ok: true, value: undefined })
    process.env.TRUSTED_CLIENT_IP_HEADER = '  '
    expect(await load()).toEqual({ ok: true, value: undefined })
  })

  it('is trimmed and lowercased', async () => {
    process.env.TRUSTED_CLIENT_IP_HEADER = ' X-Real-IP '
    expect(await load()).toEqual({ ok: true, value: 'x-real-ip' })
    process.env.TRUSTED_CLIENT_IP_HEADER = 'CF-Connecting-IP'
    expect(await load()).toEqual({ ok: true, value: 'cf-connecting-ip' })
  })

  it('refuses X-Forwarded-For, the app headers and invalid names', async () => {
    for (const value of [
      'X-Forwarded-For',
      'x-quackback-client-ip',
      'x-quackback-edge-client-ip',
      'X-Quackback-Edge-Client-IP-Sig',
      'x real ip',
      'x-real-ip:',
      'x-real-ip,cf-connecting-ip',
      '(x-real-ip)',
    ]) {
      process.env.TRUSTED_CLIENT_IP_HEADER = value
      expect(await load(), value).toEqual({ ok: false, paths: ['trustedClientIpHeader'] })
    }
  })
})
