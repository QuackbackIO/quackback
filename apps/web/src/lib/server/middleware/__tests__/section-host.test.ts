// @vitest-environment node
/**
 * The section host middleware: with the help center on help.acme.com, `/`
 * there shows the help center, the primary domain's /hc pages move there, and
 * other sections' pages on it go back where they live. Everything else reaches
 * the app untouched, and the response the app makes is handed back as is.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SectionHostContext } from '../section-host-handler'

const state = vi.hoisted(() => ({
  settings: null as Record<string, unknown> | null,
  settingsReads: 0,
  baseUrl: 'https://acme.example.com',
}))

vi.mock('@/lib/server/config', () => ({
  config: {
    get baseUrl() {
      return state.baseUrl
    },
  },
}))
vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getWorkspaceSettings: async () => {
    state.settingsReads += 1
    return state.settings
  },
}))

const { handleSectionHost } = await import('../section-host-handler')

const VERIFIED = '2026-11-01T00:00:00.000Z'
const PASSED = new Response('passed')

function workspace({
  sectionDomains,
  legacyHelpDomain = { domain: null, verifiedAt: null },
  helpCenter = true,
  cloud,
}: {
  sectionDomains?: Record<string, { hostname: string; verifiedAt: string | null }>
  legacyHelpDomain?: { domain: string | null; verifiedAt: string | null }
  helpCenter?: boolean
  cloud?: { cloud: unknown; cloudIdentity: unknown }
}) {
  return {
    settings: cloud ?? { cloud: null, cloudIdentity: null },
    portalConfig: { ...(sectionDomains ? { sectionDomains } : {}), support: { enabled: false } },
    helpCenterConfig: { domain: legacyHelpDomain },
    featureFlags: { feedback: true, helpCenter, changelog: true, statusPage: true },
    statusConfig: { enabled: true },
  }
}

interface Outcome {
  response: Response
  context: SectionHostContext | undefined
}

async function send(url: string, init: RequestInit = {}): Promise<Outcome> {
  let context: SectionHostContext | undefined
  const request = new Request(url, {
    ...init,
    headers: { host: new URL(url).host, ...(init.headers as Record<string, string>) },
  })
  const result = await handleSectionHost({
    request,
    next: async (opts) => {
      context = opts?.context
      return { response: PASSED }
    },
  })
  return { response: result instanceof Response ? result : result.response!, context }
}

beforeEach(() => {
  state.settingsReads = 0
  state.baseUrl = 'https://acme.example.com'
  state.settings = workspace({
    sectionDomains: {
      help: { hostname: 'help.acme.com', verifiedAt: VERIFIED },
      status: { hostname: 'status.acme.com', verifiedAt: VERIFIED },
    },
  })
})

describe('team sign-in while Feedback has its own domain', () => {
  // /admin without a session sends the browser to the sign-in dialog on `/`,
  // and Feedback owns `/`. Moved to Feedback's host, the sign-in made a portal
  // session there and sent the browser back to /admin on the primary domain,
  // which had no session, and so on round again.
  beforeEach(() => {
    state.settings = workspace({
      sectionDomains: { feedback: { hostname: 'feedback.acme.com', verifiedAt: VERIFIED } },
    })
  })

  it.each([
    '/?auth=signin&callbackUrl=%2Fadmin',
    '/?auth=signin&callbackUrl=%2Fadmin&error=not_team_member',
    '/?auth=signup&callbackUrl=%2Fonboarding',
    '/?auth=signin&callbackUrl=%2Fdevice%3Fuser_code%3DABCD-EFGH',
    '/?auth=signin&callbackUrl=%2Foauth%2Fconsent%3Fclient_id%3Dc1',
  ])('answers %s on the primary domain', async (pathAndQuery) => {
    const { response } = await send(`https://acme.example.com${pathAndQuery}`)
    expect(response).toBe(PASSED)
  })

  it('sends a team sign-in that reached the Feedback host back to the primary domain', async () => {
    const { response } = await send('https://feedback.acme.com/?auth=signin&callbackUrl=%2Fadmin')
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(
      'https://acme.example.com/?auth=signin&callbackUrl=%2Fadmin'
    )
  })

  it("still moves the portal's own sign-in to the Feedback host", async () => {
    const { response } = await send(
      'https://acme.example.com/?auth=signin&callbackUrl=%2Fb%2Fideas'
    )
    expect(response.status).toBe(301)
    expect(response.headers.get('location')).toBe(
      'https://feedback.acme.com/?auth=signin&callbackUrl=%2Fb%2Fideas'
    )
  })
})

describe('handleSectionHost', () => {
  it("shows the help center at / on the help center's host", async () => {
    const { response, context } = await send('https://help.acme.com/')
    expect(response).toBe(PASSED)
    expect(context).toEqual({ sectionHome: '/hc' })
  })

  it('hands the help pages on its host to the app, telling it which page is home', async () => {
    // The router writes links to the home as / on this host, on every page.
    const { response, context } = await send('https://help.acme.com/hc/articles/x')
    expect(response).toBe(PASSED)
    expect(context).toEqual({ sectionHome: '/hc' })
  })

  it('tells the app nothing on the primary domain', async () => {
    const { response, context } = await send('https://acme.example.com/roadmap')
    expect(response).toBe(PASSED)
    expect(context).toBeUndefined()
  })

  it("moves the primary domain's help pages to the help center's host for good", async () => {
    const { response } = await send('https://acme.example.com/hc/articles/x?ref=1')
    expect(response.status).toBe(301)
    expect(response.headers.get('location')).toBe('https://help.acme.com/hc/articles/x?ref=1')
    expect(response.headers.get('vary')).toBe('Host, Cookie')
  })

  it("moves the primary domain's help center sitemap too, keeping the query", async () => {
    const { response } = await send('https://acme.example.com/hc/sitemap.xml?page=2')
    expect(response.status).toBe(301)
    expect(response.headers.get('location')).toBe('https://help.acme.com/hc/sitemap.xml?page=2')
  })

  it("sends another section's page on the help host to that section's host", async () => {
    const { response } = await send('https://help.acme.com/status/inc_1')
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('https://status.acme.com/status/inc_1')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('vary')).toBe('Host, Cookie')
  })

  it('sends a section host to the primary domain while its section is off', async () => {
    state.settings = workspace({
      sectionDomains: { help: { hostname: 'help.acme.com', verifiedAt: VERIFIED } },
      helpCenter: false,
    })
    const { response } = await send('https://help.acme.com/')
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('https://acme.example.com/')
  })

  it("routes by the help center's own domain before the map is first written", async () => {
    state.settings = workspace({
      legacyHelpDomain: { domain: 'help.acme.com', verifiedAt: VERIFIED },
    })
    const { response } = await send('https://acme.example.com/hc')
    expect(response.status).toBe(301)
    expect(response.headers.get('location')).toBe('https://help.acme.com/hc')
  })

  it('reads the host the edge vouches for, not a forwarded host anyone can send', async () => {
    const { response, context } = await send('https://acme.example.com/', {
      headers: { 'x-forwarded-host': 'help.acme.com' },
    })
    expect(response).toBe(PASSED)
    expect(context).toBeUndefined()
  })

  it('tells a shared page on a section host which page is home too', async () => {
    const { response, context } = await send('https://help.acme.com/settings/profile')
    expect(response).toBe(PASSED)
    expect(context).toEqual({ sectionHome: '/hc' })
  })

  it('does not read the settings for a request that is not a page', async () => {
    for (const path of ['/api/health', '/_serverFn/abc', '/assets/main.js', '/favicon.ico']) {
      expect((await send(`https://help.acme.com${path}`)).response).toBe(PASSED)
    }
    expect(state.settingsReads).toBe(0)
  })

  it('passes everything through when the workspace has no settings', async () => {
    state.settings = null
    expect((await send('https://acme.example.com/hc')).response).toBe(PASSED)
  })

  it('on Cloud, sends no one to a custom domain that is not ready', async () => {
    state.settings = workspace({
      sectionDomains: { help: { hostname: 'help.acme.com', verifiedAt: VERIFIED } },
      cloud: {
        cloud: { enabled: true },
        cloudIdentity: {
          version: 1,
          displayName: 'Acme',
          canonicalOrigin: 'https://acme.example.com',
          platformHostname: 'acme.example.com',
          customDomains: [
            {
              hostname: 'help.acme.com',
              readiness: 'failed',
              isPrimary: false,
              updatedAt: VERIFIED,
            },
          ],
          updatedAt: VERIFIED,
        },
      },
    })
    expect((await send('https://acme.example.com/hc')).response).toBe(PASSED)
  })
})

describe('handleSectionHost for a signed-in visitor', () => {
  const SIGNED_IN = { cookie: 'theme=dark; better-auth.session_token=abc.sig' }

  it('carries the session through the handoff when moving to a section host', async () => {
    const { response } = await send('https://acme.example.com/hc/articles/x?ref=1', {
      headers: SIGNED_IN,
    })
    expect(response.status).toBe(302)
    const location = new URL(response.headers.get('location')!)
    expect(location.origin).toBe('https://help.acme.com')
    expect(location.pathname).toBe('/auth/section-handoff')
    expect(location.searchParams.get('from')).toBe('acme.example.com')
    expect(location.searchParams.get('returnTo')).toBe('/hc/articles/x?ref=1')
    // Per viewer: never a cached permanent move.
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('vary')).toContain('Cookie')
  })

  it('carries the secure-prefixed session cookie too', async () => {
    const { response } = await send('https://help.acme.com/status/inc_1', {
      headers: { cookie: '__Secure-better-auth.session_token=abc.sig' },
    })
    const location = new URL(response.headers.get('location')!)
    expect(location.origin).toBe('https://status.acme.com')
    expect(location.pathname).toBe('/auth/section-handoff')
    expect(location.searchParams.get('from')).toBe('help.acme.com')
    expect(location.searchParams.get('returnTo')).toBe('/status/inc_1')
  })

  it('carries the session back to the primary domain', async () => {
    state.settings = workspace({
      sectionDomains: { help: { hostname: 'help.acme.com', verifiedAt: VERIFIED } },
    })
    const { response } = await send('https://help.acme.com/roadmap', { headers: SIGNED_IN })
    const location = new URL(response.headers.get('location')!)
    expect(location.origin).toBe('https://acme.example.com')
    expect(location.pathname).toBe('/auth/section-handoff')
    expect(location.searchParams.get('from')).toBe('help.acme.com')
    expect(location.searchParams.get('returnTo')).toBe('/roadmap')
  })

  it('keeps the plain move for a visitor with no session cookie', async () => {
    const { response } = await send('https://acme.example.com/hc/articles/x', {
      headers: { cookie: 'theme=dark; not-better-auth.session_token_x=1' },
    })
    expect(response.status).toBe(301)
    expect(response.headers.get('location')).toBe('https://help.acme.com/hc/articles/x')
  })
})

describe('handleSectionHost for a team page on a section host', () => {
  it('sends /admin to the primary domain, keeping the path and query', async () => {
    const { response } = await send('https://help.acme.com/admin/feedback?post=p_1')
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(
      'https://acme.example.com/admin/feedback?post=p_1'
    )
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('never carries a section host session to the primary domain for a team page', async () => {
    const { response } = await send('https://help.acme.com/admin', {
      headers: { cookie: 'better-auth.session_token=abc.sig' },
    })
    expect(response.status).toBe(302)
    // A plain move: the teammate signs in on the primary domain as a teammate,
    // rather than arriving with a portal session carried from the section host.
    expect(response.headers.get('location')).toBe('https://acme.example.com/admin')
  })

  it('sends onboarding and the device page to the primary domain too', async () => {
    for (const path of ['/onboarding', '/device?user_code=ABCD-EFGH']) {
      const { response } = await send(`https://status.acme.com${path}`)
      expect(response.status).toBe(302)
      expect(response.headers.get('location')).toBe(`https://acme.example.com${path}`)
    }
  })

  it('serves /admin on the primary domain', async () => {
    expect((await send('https://acme.example.com/admin')).response).toBe(PASSED)
  })

  it('leaves server functions on a section host to the app', async () => {
    const { response } = await send('https://help.acme.com/_serverFn/abc', { method: 'POST' })
    expect(response).toBe(PASSED)
  })
})

describe('handleSectionHost when a section names the primary domain', () => {
  // A help center domain set to BASE_URL's host before section domains (main
  // never refused it, and it did nothing there), BASE_URL moved onto a
  // section's hostname, or a custom domain made primary on Cloud. The primary
  // domain stays the primary domain: no rewrite of /, and no section's path
  // sent to itself.
  const PAGES = ['/roadmap', '/b/x', '/changelog', '/status', '/hc', '/support']

  describe.each([
    ['verified', VERIFIED],
    ['not verified', null],
  ])('a legacy help domain that is the BASE_URL host, %s', (_label, verifiedAt) => {
    describe.each([
      ['help on', true],
      ['help off', false],
    ])('%s', (_on, helpCenter) => {
      beforeEach(() => {
        state.settings = workspace({
          legacyHelpDomain: { domain: 'acme.example.com', verifiedAt },
          helpCenter,
        })
      })

      it('shows the feedback home at /', async () => {
        const { response, context } = await send('https://acme.example.com/')
        expect(response).toBe(PASSED)
        expect(context).toBeUndefined()
      })

      it.each(PAGES)('serves %s with no redirect', async (path) => {
        const { response, context } = await send(`https://acme.example.com${path}`)
        expect(response).toBe(PASSED)
        expect(context).toBeUndefined()
      })
    })
  })

  it('stops treating a section hostname as a section host once BASE_URL moves onto it', async () => {
    state.baseUrl = 'https://help.acme.com'
    const { response, context } = await send('https://help.acme.com/')
    expect(response).toBe(PASSED)
    expect(context).toBeUndefined()
    for (const path of ['/roadmap', '/b/x', '/changelog', '/hc', '/support']) {
      expect((await send(`https://help.acme.com${path}`)).response).toBe(PASSED)
    }
    // Another section with a host of its own is still moved there.
    const status = await send('https://help.acme.com/status')
    expect(status.response.status).toBe(301)
    expect(status.response.headers.get('location')).toBe('https://status.acme.com/status')
  })

  it('compares with BASE_URL without case or port', async () => {
    state.baseUrl = 'https://HELP.acme.com:8443'
    const { response, context } = await send('https://help.acme.com/roadmap')
    expect(response).toBe(PASSED)
    expect(context).toBeUndefined()
  })
})
