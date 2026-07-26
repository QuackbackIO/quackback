import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

type Handler = () => Promise<unknown>

const hoisted = vi.hoisted(() => ({
  handlers: [] as Handler[],
  headers: new Headers(),
  setResponseHeader: vi.fn(),
  varySentinel: 'test-document-cache-vary-sentinel',
}))

let bootstrapHandler: Handler | undefined
let actualDocumentCacheVary: string

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({
    handler(fn: Handler) {
      hoisted.handlers.push(fn)
      return fn
    },
  }),
  createServerOnlyFn: <T>(fn: T) => fn,
}))

vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () => hoisted.headers,
  setResponseHeader: hoisted.setResponseHeader,
}))

vi.mock('@/lib/server/functions/public-cache', () => ({
  DOCUMENT_CACHE_VARY: hoisted.varySentinel,
}))

vi.mock('@/lib/shared/theme', () => ({
  getThemeCookie: () => 'system',
  parsePrefersColorScheme: () => null,
}))

vi.mock('@/lib/shared/update-banner-cookie', () => ({
  getUpdateBannerDismissedVersionCookie: () => null,
}))

vi.mock('@/lib/shared/i18n', () => ({
  resolveLocale: () => 'en',
}))

vi.mock('@/lib/server/logger', () => ({
  logger: {
    child: () => ({
      debug: vi.fn(),
      error: vi.fn(),
    }),
  },
}))

vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getTenantSettings: vi.fn(async () => null),
}))

vi.mock('@/lib/server/auth/registered-providers', () => ({
  getRegisteredAuthProviders: vi.fn(async () => []),
}))

vi.mock('@/lib/server/config', () => ({
  config: { baseUrl: 'http://localhost:3000' },
}))

vi.mock('@/lib/server/domains/help-center/help-center-domain.service', () => ({
  resolveHelpCenterBaseUrl: () => 'http://localhost:3000',
}))

beforeAll(async () => {
  vi.useFakeTimers()
  await import('../bootstrap')
  bootstrapHandler = hoisted.handlers.at(-1)

  const actualPublicCache =
    await vi.importActual<typeof import('../public-cache')>('../public-cache')
  actualDocumentCacheVary = actualPublicCache.DOCUMENT_CACHE_VARY
})

beforeEach(() => {
  hoisted.headers = new Headers()
  hoisted.setResponseHeader.mockClear()
})

afterAll(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('bootstrap response headers', () => {
  it('defines the canonical credential-aware root document Vary value', () => {
    expect(actualDocumentCacheVary).toBe(
      'Cookie, Authorization, Accept-Language, Sec-CH-Prefers-Color-Scheme, Host'
    )
  })

  it('consumes the shared document Vary value', async () => {
    expect(bootstrapHandler).toBeTypeOf('function')

    await bootstrapHandler!()

    expect(hoisted.setResponseHeader).toHaveBeenCalledWith('Vary', hoisted.varySentinel)
  })
})
