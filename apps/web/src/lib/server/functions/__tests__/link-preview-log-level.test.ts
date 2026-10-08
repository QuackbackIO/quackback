/**
 * A caller the unfurl endpoint refuses (signed out, or a session it does not
 * serve) is expected traffic and logs at warn; a failure while unfurling is
 * still an error.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const hoisted = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  unfurlExternalUrl: vi.fn(),
  log: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({ requireAuth: hoisted.requireAuth }))
vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  isFeatureEnabled: vi.fn(async () => true),
}))
vi.mock('@/lib/server/content/unfurl', () => ({ unfurlExternalUrl: hoisted.unfurlExternalUrl }))
vi.mock('@/lib/server/cache', () => ({
  cacheGet: vi.fn(async () => null),
  cacheSet: vi.fn(async () => undefined),
}))
vi.mock('@/lib/server/utils/rate-bucket', () => ({ incrementBuckets: vi.fn(async () => [1, 1]) }))
vi.mock('@/lib/server/domains/api/rate-limit', () => ({ getClientIp: () => '203.0.113.7' }))
vi.mock('@tanstack/react-start/server', () => ({ getRequestHeaders: () => ({}) }))
vi.mock('@/lib/server/logger', () => ({ logger: { child: () => hoisted.log } }))
vi.mock('@tanstack/react-start', async (importOriginal) => {
  const { withServerFnsInProcess } = await import('@/test/server-fns-in-process')
  return withServerFnsInProcess(await importOriginal())
})

const { unfurlLinkFn } = await import('../link-preview')

const URL_IN = 'https://news.example/post'

beforeEach(() => vi.clearAllMocks())

describe('unfurlLinkFn log level', () => {
  it('logs an auth denial at warn, not error, and renders no card', async () => {
    hoisted.requireAuth.mockRejectedValue(
      new Error('Access denied: Widget sessions cannot access this resource')
    )

    await expect(unfurlLinkFn({ data: { url: URL_IN } })).resolves.toBeNull()

    expect(hoisted.log.error).not.toHaveBeenCalled()
    expect(hoisted.log.warn).toHaveBeenCalledTimes(1)
  })

  it('still logs an unexpected failure at error', async () => {
    hoisted.requireAuth.mockResolvedValue({
      principal: { id: 'principal_1', role: 'admin' },
      user: { id: 'user_1' },
    })
    hoisted.unfurlExternalUrl.mockRejectedValue(new TypeError('socket hang up'))

    await expect(unfurlLinkFn({ data: { url: URL_IN } })).resolves.toBeNull()

    expect(hoisted.log.error).toHaveBeenCalledTimes(1)
    expect(hoisted.log.warn).not.toHaveBeenCalled()
  })
})
