import { beforeEach, describe, expect, it, vi } from 'vitest'

beforeEach(() => {
  vi.resetModules()
  vi.stubEnv('NODE_ENV', 'test')
  vi.stubEnv('BASE_URL', 'http://localhost:3000')
  vi.stubEnv('DATABASE_URL', 'postgres://user:pass@localhost:5432/test')
  vi.stubEnv('REDIS_URL', 'redis://localhost:6379')
  vi.stubEnv('SECRET_KEY', 'test-secret-key-that-is-at-least-32-characters-long')
})

describe('widget context origin validation', () => {
  it('allows exact, wildcard subdomain, and local port wildcard origins', async () => {
    const { isOriginAllowed } = await import('../context')

    expect(isOriginAllowed(['https://app.example.com'], 'https://app.example.com')).toBe(true)
    expect(isOriginAllowed(['https://*.example.com'], 'https://admin.example.com')).toBe(true)
    expect(isOriginAllowed(['http://localhost:*'], 'http://localhost:5173')).toBe(true)
    expect(isOriginAllowed(['localhost:*'], 'http://localhost:5173')).toBe(true)
  })

  it('rejects unrelated origins when an allowlist is configured', async () => {
    const { isOriginAllowed } = await import('../context')

    expect(isOriginAllowed(['https://*.example.com'], 'https://example.net')).toBe(false)
    expect(isOriginAllowed(['https://*.example.com'], 'https://example.com')).toBe(false)
  })
})

describe('widget context token', () => {
  it('round-trips signed claims and rejects malformed tokens', async () => {
    const { createWidgetContextToken, verifyWidgetContextToken } = await import('../context')

    const token = createWidgetContextToken({
      applicationKey: 'customer-dashboard',
      environment: 'production',
      allowedInboxIds: ['inbox_123'],
      ticketListScope: 'same_profile_allowed_inboxes',
    })

    expect(verifyWidgetContextToken(token)).toMatchObject({
      applicationKey: 'customer-dashboard',
      environment: 'production',
      allowedInboxIds: ['inbox_123'],
      ticketListScope: 'same_profile_allowed_inboxes',
    })
    expect(verifyWidgetContextToken(`${token.slice(0, -2)}xx`)).toBeNull()
  })
})
