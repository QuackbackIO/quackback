/**
 * Link previews on each surface. The site endpoint is cookie-authenticated and
 * denies widget Bearers by design, so the widget needs its own entry that
 * authenticates the widget session; otherwise every widget preview is a denial
 * logged at error and the card never renders.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const hoisted = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  requireWidgetAuth: vi.fn(),
  isFeatureEnabled: vi.fn(),
  unfurlExternalUrl: vi.fn(),
  resolvePortalAccessForRequest: vi.fn(),
  log: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({ requireAuth: hoisted.requireAuth }))
vi.mock('@/lib/server/functions/widget-auth', () => ({
  requireWidgetAuth: hoisted.requireWidgetAuth,
}))
vi.mock('@/lib/server/functions/portal-access', () => ({
  resolvePortalAccessForRequest: hoisted.resolvePortalAccessForRequest,
}))
vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  isFeatureEnabled: hoisted.isFeatureEnabled,
}))
vi.mock('@/lib/server/content/unfurl', () => ({
  unfurlExternalUrl: hoisted.unfurlExternalUrl,
}))
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
const { widgetUnfurlLinkFn } = await import('../widget/conversation')

const URL_IN = 'https://news.example/post'
const PREVIEW = { url: URL_IN, title: 'A post' }
const VISITOR = { principal: { id: 'principal_v', role: 'user' }, user: { id: 'user_v' } }

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.isFeatureEnabled.mockResolvedValue(true)
  hoisted.resolvePortalAccessForRequest.mockResolvedValue({ granted: true })
  hoisted.unfurlExternalUrl.mockResolvedValue(PREVIEW)
})

describe('widgetUnfurlLinkFn', () => {
  it('unfurls for a widget session without consulting the site auth', async () => {
    hoisted.requireWidgetAuth.mockResolvedValue(VISITOR)

    await expect(widgetUnfurlLinkFn({ data: { url: URL_IN } })).resolves.toEqual(PREVIEW)

    expect(hoisted.requireWidgetAuth).toHaveBeenCalledTimes(1)
    expect(hoisted.requireAuth).not.toHaveBeenCalled()
    expect(hoisted.unfurlExternalUrl).toHaveBeenCalledWith(URL_IN)
  })

  it('keeps the portal access gate for widget visitors', async () => {
    hoisted.requireWidgetAuth.mockResolvedValue(VISITOR)
    hoisted.resolvePortalAccessForRequest.mockResolvedValue({ granted: false })

    await expect(widgetUnfurlLinkFn({ data: { url: URL_IN } })).resolves.toBeNull()
    expect(hoisted.unfurlExternalUrl).not.toHaveBeenCalled()
  })
})

describe('unfurlLinkFn', () => {
  it('logs an auth denial at warn, not error, and renders no card', async () => {
    hoisted.requireAuth.mockRejectedValue(
      new Error('Access denied: Widget sessions cannot access this resource')
    )

    await expect(unfurlLinkFn({ data: { url: URL_IN } })).resolves.toBeNull()

    expect(hoisted.log.error).not.toHaveBeenCalled()
    expect(hoisted.log.warn).toHaveBeenCalledTimes(1)
  })

  it('still logs an unexpected failure at error', async () => {
    hoisted.requireAuth.mockResolvedValue(VISITOR)
    hoisted.unfurlExternalUrl.mockRejectedValue(new TypeError('socket hang up'))

    await expect(unfurlLinkFn({ data: { url: URL_IN } })).resolves.toBeNull()

    expect(hoisted.log.error).toHaveBeenCalledTimes(1)
    expect(hoisted.log.warn).not.toHaveBeenCalled()
  })
})
