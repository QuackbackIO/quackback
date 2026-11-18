// @vitest-environment node
/**
 * A paused custom domain with portal sections on their own hosts.
 *
 * The request runs through both middlewares in the order the app registers
 * them: the paused custom domain first, then the section host routing. While
 * the custom domain is paused a section's host keeps serving its own section
 * in place, nothing sends a visitor there (the primary domain's section paths
 * stay put, and every link names the primary domain), the team's pages on a
 * section's host go straight to the default hostname, and sign-out and
 * sign-in still trust the hosts that keep serving. No request loops.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  baseUrl: 'https://feedback.acme.test',
  sources: null as Record<string, unknown> | null,
  settings: null as Record<string, unknown> | null,
}))

vi.mock('@/lib/server/config', async () => {
  const { baseUrlOverride } = await import('@/lib/server/base-url-override')
  const config = {
    get baseUrl() {
      return baseUrlOverride() ?? h.baseUrl
    },
  }
  return {
    config,
    configuredBaseUrl: () => h.baseUrl,
    getBaseUrl: () => config.baseUrl,
  }
})
vi.mock('@/lib/server/workspaces/workspace-context', () => ({
  getCurrentWorkspace: () => null,
}))
vi.mock('@/lib/server/domains/settings/settings.plan-limits', () => ({
  readPlanLimitsSources: async () => h.sources,
}))
vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getWorkspaceSettings: async () => h.settings,
}))
vi.mock(
  '@/lib/server/domains/plan-limits/plan-limits.service',
  async () =>
    (await import('@/lib/server/domains/plan-limits/__tests__/feature-states'))
      .planLimitsServiceDouble
)

import { runWithLogContext } from '@/lib/server/log-context'
import {
  handlePausedCustomDomain,
  withPausedCustomDomainOrigin,
} from '../plan-limits.custom-domain'
import {
  handleSectionHost,
  type SectionHostContext,
} from '@/lib/server/middleware/section-host-handler'
import {
  getSectionOrigins,
  getSignInSectionOrigins,
} from '@/lib/server/domains/settings/section-links'
import { authTrustedOrigins } from '@/lib/server/auth/trusted-origins'
import { setFeatureState } from './feature-states'

const NOW = '2026-11-01T00:00:00.000Z'
const DEFAULT = 'https://acme.example.com'

/** A Cloud workspace: its default hostname, its custom domains, and help on its own host. */
function workspace(custom: string[]) {
  const cloudIdentity = {
    version: 1,
    displayName: 'Acme',
    canonicalOrigin: `https://${custom[0]}`,
    platformHostname: 'acme.example.com',
    customDomains: custom.map((hostname, i) => ({
      hostname,
      readiness: 'ready',
      isPrimary: i === 0,
      updatedAt: NOW,
    })),
    updatedAt: NOW,
  }
  h.sources = {
    planLimitsState: null,
    tierLimits: null,
    cloud: null,
    cloudIdentity,
    customCss: null,
    sectionHostnames: ['help.acme.test'],
    autoTranslate: false,
  }
  h.settings = {
    settings: { cloud: { enabled: true }, cloudIdentity },
    portalConfig: {
      sectionDomains: { help: { hostname: 'help.acme.test', verifiedAt: NOW } },
      support: { enabled: false },
    },
    helpCenterConfig: { domain: { domain: null, verifiedAt: null } },
    featureFlags: { feedback: true, helpCenter: true, changelog: true, statusPage: false },
    statusConfig: { enabled: false },
  }
}

interface Served {
  /** The response a middleware answered with, or null when the app was reached. */
  response: Response | null
  context: SectionHostContext | undefined
  /** Where links to the help center point, as the app would build them. */
  helpLink: string
  /** The help center origin sign-in accepts. */
  signInHelp: string
}

async function serve(url: string, method = 'GET'): Promise<Served> {
  const request = new Request(url, { method, headers: { host: new URL(url).host } })
  const seen: Omit<Served, 'response'> = { context: undefined, helpLink: '', signInHelp: '' }
  const result = await runWithLogContext({} as never, () =>
    handlePausedCustomDomain({
      request,
      next: () =>
        handleSectionHost({
          request,
          next: async (opts) => {
            seen.context = opts?.context
            seen.helpLink = (await getSectionOrigins()).help
            seen.signInHelp = (await getSignInSectionOrigins()).help
            return { response: undefined }
          },
        }),
    })
  )
  return { response: result instanceof Response ? result : null, ...seen }
}

function location(served: Served): string | null {
  return served.response?.headers.get('location') ?? null
}

beforeEach(() => {
  vi.clearAllMocks()
  h.baseUrl = 'https://feedback.acme.test'
  workspace(['feedback.acme.test', 'help.acme.test'])
  setFeatureState('enforced', 'customDomain')
})

describe('a paused custom domain with the help center on its own host', () => {
  it('keeps the primary domain serving its help center, with no move to the paused host', async () => {
    const served = await serve(`${DEFAULT}/hc/articles/refunds`)
    expect(served.response).toBeNull()
    expect(served.helpLink).toBe(DEFAULT)
  })

  it("serves the section's host in place, its home included", async () => {
    const home = await serve('https://help.acme.test/')
    expect(home.response).toBeNull()
    expect(home.context?.sectionHome).toBe('/hc')

    const article = await serve('https://help.acme.test/hc/articles/refunds')
    expect(article.response).toBeNull()
    // Links built there name the primary domain, never the paused host.
    expect(article.helpLink).toBe(DEFAULT)
  })

  it("sends the team's pages on a section's host straight to the default hostname", async () => {
    const served = await serve('https://help.acme.test/admin/feedback?x=1')
    expect(served.response?.status).toBe(302)
    expect(location(served)).toBe(`${DEFAULT}/admin/feedback?x=1`)
    // ...where the admin is served, not moved again.
    expect((await serve(`${DEFAULT}/admin/feedback?x=1`)).response).toBeNull()
  })

  it('still moves the paused primary custom hostname to the default hostname', async () => {
    const served = await serve('https://feedback.acme.test/b/ideas')
    expect(served.response?.status).toBe(307)
    expect(location(served)).toBe(`${DEFAULT}/b/ideas`)
  })

  it('keeps trusting the section host for sign-in and sign-out, since it still serves', async () => {
    expect((await serve('https://help.acme.test/hc')).signInHelp).toBe('https://help.acme.test')
    const signOut = new Request('https://help.acme.test/api/auth/sign-out', {
      method: 'POST',
      headers: { host: 'help.acme.test', origin: 'https://help.acme.test' },
    })
    const trusted = await runWithLogContext({} as never, () =>
      handlePausedCustomDomain({ request: signOut, next: () => authTrustedOrigins(signOut) })
    )
    expect(trusted).toContain('https://help.acme.test')
  })

  it('names the primary domain in links a job builds, even when the primary is not custom', async () => {
    h.baseUrl = DEFAULT
    workspace(['help.acme.test'])
    expect(await withPausedCustomDomainOrigin(async () => (await getSectionOrigins()).help)).toBe(
      DEFAULT
    )
  })

  it('serves a help host that is only a section, when the primary is not custom', async () => {
    h.baseUrl = DEFAULT
    workspace(['help.acme.test'])
    expect((await serve(`${DEFAULT}/hc/articles/refunds`)).response).toBeNull()
    expect((await serve('https://help.acme.test/hc/articles/refunds')).response).toBeNull()
  })
})

describe('the same workspace while its custom domain serves', () => {
  it('moves the help center to its own host and links it there', async () => {
    setFeatureState('grace', 'customDomain')
    const served = await serve('https://feedback.acme.test/hc/articles/refunds')
    expect(served.response?.status).toBe(301)
    expect(location(served)).toBe('https://help.acme.test/hc/articles/refunds')
    expect((await serve('https://help.acme.test/hc')).helpLink).toBe('https://help.acme.test')
  })
})
