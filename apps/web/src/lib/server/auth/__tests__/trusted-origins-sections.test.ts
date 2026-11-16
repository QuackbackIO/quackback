// @vitest-environment node
/**
 * Every routable section host is a trusted origin, on a single-workspace
 * install as on Cloud. Without it a sign-in posted from help.acme.com is
 * refused as "Invalid origin", and a callback URL back to it is refused too.
 * Only hosts links and routing would send a visitor to count: verified and
 * on, and on Cloud a custom domain that is ready.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  settings: null as Record<string, unknown> | null,
  fail: false,
}))

vi.mock('@/lib/server/config', () => ({
  config: { baseUrl: 'https://acme.com' },
  getBaseUrl: () => 'https://acme.com',
}))
vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getWorkspaceSettings: async () => {
    if (state.fail) throw new Error('settings unreadable')
    return state.settings
  },
}))

const { authTrustedOrigins } = await import('../trusted-origins')

const VERIFIED = '2026-11-01T00:00:00.000Z'

function workspace({
  sectionDomains,
  legacyHelpDomain = { domain: null, verifiedAt: null },
  helpCenter = true,
  cloud,
}: {
  sectionDomains?: Record<
    string,
    { hostname: string; verifiedAt: string | null; unconfirmedSince?: string }
  >
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

beforeEach(() => {
  state.fail = false
  state.settings = null
})

describe('authTrustedOrigins on a single-workspace install', () => {
  it('trusts every verified section host', async () => {
    state.settings = workspace({
      sectionDomains: {
        help: { hostname: 'help.acme.com', verifiedAt: VERIFIED },
        status: { hostname: 'status.acme.com', verifiedAt: VERIFIED },
      },
    })
    const origins = await authTrustedOrigins()
    expect(origins).toContain('https://acme.com')
    expect(origins).toContain('https://help.acme.com')
    expect(origins).toContain('https://status.acme.com')
  })

  it("trusts the help center's own domain from before the section map", async () => {
    state.settings = workspace({
      legacyHelpDomain: { domain: 'help.acme.com', verifiedAt: VERIFIED },
    })
    expect(await authTrustedOrigins()).toContain('https://help.acme.com')
  })

  it('does not trust a host that is mapped but not verified', async () => {
    state.settings = workspace({
      sectionDomains: { help: { hostname: 'help.acme.com', verifiedAt: null } },
    })
    expect(await authTrustedOrigins()).not.toContain('https://help.acme.com')
  })

  it('does not trust a host whose verification is only kept because its lookups go unanswered', async () => {
    // A lapsed or dangling domain may belong to someone else now.
    state.settings = workspace({
      sectionDomains: {
        help: {
          hostname: 'help.acme.com',
          verifiedAt: VERIFIED,
          unconfirmedSince: new Date().toISOString(),
        },
      },
    })
    expect(await authTrustedOrigins()).not.toContain('https://help.acme.com')
  })

  it('does not trust the host of a section that is off', async () => {
    state.settings = workspace({
      sectionDomains: { help: { hostname: 'help.acme.com', verifiedAt: VERIFIED } },
      helpCenter: false,
    })
    expect(await authTrustedOrigins()).not.toContain('https://help.acme.com')
  })

  it('falls back to the base list when the settings cannot be read', async () => {
    state.fail = true
    expect(await authTrustedOrigins()).toEqual(['https://acme.com'])
  })
})

describe('authTrustedOrigins on Cloud', () => {
  function cloudWith(readiness: string) {
    return {
      cloud: { enabled: true },
      cloudIdentity: {
        version: 1,
        displayName: 'Acme',
        canonicalOrigin: 'https://acme.com',
        platformHostname: 'acme.com',
        customDomains: [
          { hostname: 'help.acme.com', readiness, isPrimary: false, updatedAt: VERIFIED },
        ],
        updatedAt: VERIFIED,
      },
    }
  }

  it('trusts a section host whose custom domain is ready', async () => {
    state.settings = workspace({
      sectionDomains: { help: { hostname: 'help.acme.com', verifiedAt: VERIFIED } },
      cloud: cloudWith('ready'),
    })
    expect(await authTrustedOrigins()).toContain('https://help.acme.com')
  })

  it('does not trust a section host whose custom domain is not ready', async () => {
    state.settings = workspace({
      sectionDomains: { help: { hostname: 'help.acme.com', verifiedAt: VERIFIED } },
      cloud: cloudWith('failed'),
    })
    expect(await authTrustedOrigins()).not.toContain('https://help.acme.com')
  })
})
