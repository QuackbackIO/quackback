import { describe, expect, it, vi, beforeEach } from 'vitest'

// The widget loader hands the frame the visitor's portal session only when the
// frame's document navigation comes from the instance's own origin.
const request = vi.hoisted(() => ({ headers: new Headers() }))
// Lets a test hold the locale lookup open to see what runs alongside it.
const localeGate = vi.hoisted(() => ({ wait: null as Promise<void> | null }))

// Server functions run their handler in-process, as they do during the frame's
// server render.
vi.mock('@tanstack/react-start', async (original) => ({
  ...(await original<typeof import('@tanstack/react-start')>()),
  createServerFn: () => {
    const chain = {
      validator: () => chain,
      handler: (fn: (opts: { data?: unknown }) => unknown) => (opts?: { data?: unknown }) =>
        fn({ data: opts?.data }),
    }
    return chain
  },
}))
vi.mock('@tanstack/react-start/server', async (original) => ({
  ...(await original<typeof import('@tanstack/react-start/server')>()),
  getRequestHeaders: () => request.headers,
  setResponseHeader: vi.fn(),
}))
vi.mock('@/lib/server/functions/portal-session-token', () => ({
  extractSessionTokenFromCookie: (cookie: string) =>
    cookie.includes('session=signed') ? 'signed-token' : null,
}))
vi.mock('@/lib/server/functions/portal', () => ({
  fetchUserAvatar: vi.fn(async () => ({ avatarUrl: '/avatar.png' })),
}))
vi.mock('@/lib/shared/i18n', async (original) => ({
  ...(await original<typeof import('@/lib/shared/i18n')>()),
  loadWidgetMessages: vi.fn(async () => ({})),
  resolveRequestLocale: () => 'en',
}))
vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getLanguageConfig: async () => {
    if (localeGate.wait) await localeGate.wait
    return { mainLanguage: 'en', visitorLanguage: 'own' }
  },
}))

const { fetchUserAvatar } = await import('@/lib/server/functions/portal')
const { Route } = await import('../widget')

function setRequest(fetchMetadata: Record<string, string>) {
  request.headers = new Headers({ cookie: 'session=signed', ...fetchMetadata })
}

async function runLoader() {
  const loader = Route.options.loader
  if (typeof loader !== 'function') throw new Error('expected a loader function')
  const context = {
    settings: { settings: { name: 'Acme' }, brandingConfig: {} },
    session: {
      user: {
        id: 'user_1',
        name: 'Ada',
        email: 'ada@example.com',
        image: null,
        principalType: 'user',
      },
    },
    userRole: 'user',
  }
  return (await loader({ context, location: { search: {} } } as never)) as {
    portalUser: unknown
    portalSessionToken: string | null
  }
}

describe('widget loader portal session reuse', () => {
  beforeEach(() => {
    vi.mocked(fetchUserAvatar).mockClear()
  })

  it('reuses the portal session when a same-origin page embeds the frame', async () => {
    setRequest({ 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'navigate' })
    const data = await runLoader()
    expect(data.portalSessionToken).toBe('signed-token')
    expect(data.portalUser).toEqual({
      id: 'user_1',
      name: 'Ada',
      email: 'ada@example.com',
      avatarUrl: '/avatar.png',
    })
  })

  it.each([
    ['a same-site page on another origin', { 'sec-fetch-site': 'same-site' }],
    ['a cross-site page', { 'sec-fetch-site': 'cross-site' }],
    ['a browser that sends no Fetch Metadata', {}],
  ])('starts without the portal session when %s embeds the frame', async (_label, site) => {
    setRequest({ ...site, 'sec-fetch-mode': 'navigate' })
    const data = await runLoader()
    expect(data.portalSessionToken).toBeNull()
    expect(data.portalUser).toBeNull()
    expect(fetchUserAvatar).not.toHaveBeenCalled()
  })

  it('does not reuse it for a call made from inside the frame (loader re-run)', async () => {
    setRequest({ 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors' })
    const data = await runLoader()
    expect(data.portalSessionToken).toBeNull()
    expect(data.portalUser).toBeNull()
  })

  it('looks up the avatar alongside the locale, not after it', async () => {
    setRequest({ 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'navigate' })
    let releaseLocale = () => {}
    localeGate.wait = new Promise((resolve) => {
      releaseLocale = resolve
    })
    try {
      const run = runLoader()
      await vi.waitFor(() => expect(fetchUserAvatar).toHaveBeenCalled())
      releaseLocale()
      const data = await run
      expect(data.portalUser).toMatchObject({ avatarUrl: '/avatar.png' })
    } finally {
      localeGate.wait = null
      releaseLocale()
    }
  })
})
