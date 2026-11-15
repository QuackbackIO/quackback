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
}))

vi.mock('@/lib/server/config', () => ({
  config: { baseUrl: 'https://acme.example.com' },
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
  state.settings = workspace({
    sectionDomains: {
      help: { hostname: 'help.acme.com', verifiedAt: VERIFIED },
      status: { hostname: 'status.acme.com', verifiedAt: VERIFIED },
    },
  })
})

describe('handleSectionHost', () => {
  it("shows the help center at / on the help center's host", async () => {
    const { response, context } = await send('https://help.acme.com/')
    expect(response).toBe(PASSED)
    expect(context).toEqual({ sectionHome: '/hc' })
  })

  it('hands the help pages on its host to the app as they are', async () => {
    const { response, context } = await send('https://help.acme.com/hc/articles/x')
    expect(response).toBe(PASSED)
    expect(context).toBeUndefined()
  })

  it("moves the primary domain's help pages to the help center's host for good", async () => {
    const { response } = await send('https://acme.example.com/hc/articles/x?ref=1')
    expect(response.status).toBe(301)
    expect(response.headers.get('location')).toBe('https://help.acme.com/hc/articles/x?ref=1')
    expect(response.headers.get('vary')).toBe('Host')
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
    expect(response.headers.get('vary')).toBe('Host')
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

  it('does not read the settings for a path every host shares', async () => {
    for (const path of ['/api/health', '/_serverFn/abc', '/assets/main.js', '/admin']) {
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
