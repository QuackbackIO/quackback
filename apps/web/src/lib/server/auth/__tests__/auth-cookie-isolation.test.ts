// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { betterAuth } from 'better-auth'
import { memoryAdapter } from 'better-auth/adapters/memory'
import { sessionCookieNames } from '@/lib/shared/auth-cookies'

vi.mock('@/lib/server/logger', () => ({
  logger: { child: () => ({ error: () => {}, warn: () => {}, info: () => {} }) },
}))

afterEach(() => vi.unstubAllEnvs())

function app(baseURL: string, secret: string, cookiePrefix?: string, parentDomain = false) {
  return betterAuth({
    baseURL,
    secret,
    database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
    emailAndPassword: { enabled: true },
    advanced: {
      cookiePrefix,
      ...(parentDomain ? { crossSubDomainCookies: { enabled: true, domain: 'example.com' } } : {}),
    },
  })
}

async function signup(auth: ReturnType<typeof app>, origin: string, email: string) {
  const response = await auth.handler(
    new Request(`${origin}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Cookie regression', email, password: 'test-password-1234' }),
    })
  )
  expect(response.status).toBe(200)
  const header = response.headers
    .getSetCookie()
    .find((cookie) => cookie.includes('.session_token='))
  expect(header).toBeDefined()
  return { header: header!, pair: header!.split(';')[0] }
}

async function session(auth: ReturnType<typeof app>, origin: string, cookie: string) {
  const response = await auth.handler(
    new Request(`${origin}/api/auth/get-session`, {
      headers: { cookie },
    })
  )
  expect(response.status).toBe(200)
  return response.json() as Promise<{ user: { email: string } } | null>
}

describe('auth cookie isolation through real Better Auth handlers', () => {
  it('keeps existing defaults and isolates a configured deployment from a parent-domain session', async () => {
    const origin = 'https://feedback.example.com'
    const parent = app(
      'https://example.com',
      'parent-app-secret-longer-than-32-characters',
      undefined,
      true
    )
    const parentCookie = await signup(parent, 'https://example.com', 'parent@example.com')
    expect(parentCookie.header).toContain('Domain=example.com')

    const legacy = app(origin, 'feedback-app-secret-longer-than-32-characters')
    const legacyCookie = await signup(legacy, origin, 'legacy@example.com')
    expect(legacyCookie.pair).toMatch(/^__Secure-better-auth\.session_token=/)
    expect((await session(legacy, origin, legacyCookie.pair))?.user.email).toBe(
      'legacy@example.com'
    )
    // A browser sends both same-name cookies; Better Auth consumes the first.
    expect(await session(legacy, origin, `${parentCookie.pair}; ${legacyCookie.pair}`)).toBeNull()

    vi.stubEnv('BASE_URL', origin)
    vi.stubEnv('SECRET_KEY', 'feedback-app-secret-longer-than-32-characters')
    vi.stubEnv('DATABASE_URL', 'postgresql://test@localhost/quackback')
    vi.stubEnv('QUACKBACK_TENANCY', 'single')
    vi.stubEnv('AUTH_COOKIE_PREFIX', 'feedback')
    const { config, resetConfig } = await import('@/lib/server/config')
    resetConfig()
    const isolated = app(origin, config.secretKey, config.authCookiePrefix)
    const isolatedCookie = await signup(isolated, origin, 'own@example.com')
    expect(
      isolatedCookie.pair.startsWith(`${sessionCookieNames(config.authCookiePrefix).secure}=`)
    ).toBe(true)
    expect(isolatedCookie.header).toContain('Secure')
    expect(isolatedCookie.header).toContain('HttpOnly')
    expect(isolatedCookie.header).toContain('Path=/')
    expect(isolatedCookie.header).not.toContain('Domain=')

    for (const cookie of [
      isolatedCookie.pair,
      `${parentCookie.pair}; ${isolatedCookie.pair}`,
      `${isolatedCookie.pair}; ${parentCookie.pair}`,
    ])
      expect((await session(isolated, origin, cookie))?.user.email).toBe('own@example.com')
    for (const cookie of [
      '',
      parentCookie.pair,
      '__Secure-feedback.session_token=unsigned.invalid',
    ]) {
      expect(await session(isolated, origin, cookie)).toBeNull()
    }
  })
})
