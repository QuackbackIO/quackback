import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/server/logger', () => ({
  logger: { child: () => ({ error: () => {}, warn: () => {}, info: () => {} }) },
}))

beforeEach(() => {
  vi.stubEnv('BASE_URL', 'https://feedback.example.com')
  vi.stubEnv('SECRET_KEY', 'cookie-namespace-test-secret-at-least-32-characters')
  vi.stubEnv('DATABASE_URL', 'postgresql://test@localhost/quackback')
  vi.stubEnv('QUACKBACK_TENANCY', 'single')
  vi.stubEnv('AUTH_COOKIE_PREFIX', '')
})

afterEach(() => vi.unstubAllEnvs())

async function prefix() {
  const { config, resetConfig } = await import('../config')
  resetConfig()
  return config.authCookiePrefix
}

describe('AUTH_COOKIE_PREFIX', () => {
  it('preserves the Better Auth default when unset or empty', async () => {
    expect(await prefix()).toBe('better-auth')
    vi.stubEnv('AUTH_COOKIE_PREFIX', undefined)
    expect(await prefix()).toBe('better-auth')
  })

  it('accepts a deployment-specific cookie namespace', async () => {
    vi.stubEnv('AUTH_COOKIE_PREFIX', 'feedback_1.app-v2')
    expect(await prefix()).toBe('feedback_1.app-v2')
  })

  it.each(['has space', 'bad;name', 'bad=name', 'bad\r\nname', 'é', 'x'.repeat(65)])(
    'refuses invalid cookie prefix %j',
    async (value) => {
      vi.stubEnv('AUTH_COOKIE_PREFIX', value)
      await expect(prefix()).rejects.toThrow('Configuration validation failed')
    }
  )
})
