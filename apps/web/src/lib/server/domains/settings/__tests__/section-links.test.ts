// @vitest-environment node
/**
 * The server's reading of where each section is linked: the workspace's map,
 * with the help center's own domain before the map was written, and on Cloud
 * only domains that are ready.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  settings: null as Record<string, unknown> | null,
  reads: 0,
}))

vi.mock('@/lib/server/config', () => ({
  getBaseUrl: () => 'https://acme.example.com',
}))
vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getWorkspaceSettings: async () => {
    state.reads += 1
    return state.settings
  },
}))

const { getSectionOrigins } = await import('../section-links')

const VERIFIED = '2026-11-01T00:00:00.000Z'
const PRIMARY = 'https://acme.example.com'

function workspace({
  sectionDomains,
  legacyHelpDomain = { domain: null, verifiedAt: null },
  cloud,
}: {
  sectionDomains?: Record<string, { hostname: string; verifiedAt: string | null }>
  legacyHelpDomain?: { domain: string | null; verifiedAt: string | null }
  cloud?: { cloud: unknown; cloudIdentity: unknown }
}) {
  return {
    settings: cloud ?? { cloud: null, cloudIdentity: null },
    portalConfig: { ...(sectionDomains ? { sectionDomains } : {}), support: { enabled: true } },
    helpCenterConfig: { domain: legacyHelpDomain },
    featureFlags: { feedback: true, helpCenter: true, changelog: true, statusPage: true },
    statusConfig: { enabled: true },
  }
}

beforeEach(() => {
  state.reads = 0
  state.settings = workspace({
    sectionDomains: { help: { hostname: 'help.acme.com', verifiedAt: VERIFIED } },
  })
})

describe('getSectionOrigins', () => {
  it('links a verified section at its own host and the rest at the primary domain', async () => {
    const origins = await getSectionOrigins()
    expect(origins.help).toBe('https://help.acme.com')
    expect(origins.feedback).toBe(PRIMARY)
    expect(origins.primary).toBe(PRIMARY)
  })

  it('links the help center at its own domain before the map is first written', async () => {
    state.settings = workspace({
      legacyHelpDomain: { domain: 'help.acme.com', verifiedAt: VERIFIED },
    })
    expect((await getSectionOrigins()).help).toBe('https://help.acme.com')
  })

  it('keeps everything on the primary domain when the settings cannot be read', async () => {
    state.settings = null
    const origins = await getSectionOrigins()
    expect(origins.help).toBe(PRIMARY)
    expect(origins.primary).toBe(PRIMARY)
  })

  it('on Cloud, links nothing at a custom domain that is not ready', async () => {
    state.settings = workspace({
      sectionDomains: { help: { hostname: 'help.acme.com', verifiedAt: VERIFIED } },
      cloud: {
        cloud: { enabled: true },
        cloudIdentity: {
          version: 1,
          displayName: 'Acme',
          canonicalOrigin: PRIMARY,
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
    expect((await getSectionOrigins()).help).toBe(PRIMARY)
  })
})
