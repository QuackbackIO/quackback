import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { EMAIL_SENDING_PERMISSION } from '@/lib/shared/email-sending-permissions'

const sending = vi.fn()
const signIn = vi.fn()
const sections = vi.fn()
const added = vi.fn()

vi.mock('@/lib/server/functions/domains-overview', () => ({
  getSendingDomainSummariesFn: sending,
  getSignInDomainSummariesFn: signIn,
}))

vi.mock('@/lib/server/functions/section-domains', () => ({ getSectionDomainsFn: sections }))

vi.mock('@/lib/server/functions/domains', () => ({ listDomainsFn: added }))

const { loadDomainSummaries } = await import('../domain-summaries')

const SENDING = [{ id: 'dom_1', domain: 'acme.com' }]
const SIGN_IN = [{ id: 'domain_a', name: 'acme.com', verified: true, provenBy: null }]
const SECTIONS = {
  sectionDomains: { help: { hostname: 'help.acme.com', verifiedAt: '2026-11-01T00:00:00.000Z' } },
  primaryHost: 'acme.com',
}
const ADDED = [{ name: 'acme.io', verified: false }]

beforeEach(() => {
  vi.clearAllMocks()
  sending.mockResolvedValue(SENDING)
  signIn.mockResolvedValue(SIGN_IN)
  sections.mockResolvedValue(SECTIONS)
  added.mockResolvedValue(ADDED)
})

describe('domain summaries', () => {
  it('reads every use for a holder of every permission', async () => {
    const result = await loadDomainSummaries({
      permissions: [
        EMAIL_SENDING_PERMISSION,
        PERMISSIONS.AUTH_MANAGE,
        PERMISSIONS.SETTINGS_CUSTOM_DOMAIN,
      ],
      cloudEnabled: false,
    })
    expect(result).toEqual({
      sending: SENDING,
      signIn: SIGN_IN,
      sectionDomains: SECTIONS,
      added: ADDED,
    })
  })

  it('reads only the use whose permission the viewer holds', async () => {
    const result = await loadDomainSummaries({
      permissions: [PERMISSIONS.AUTH_MANAGE],
      cloudEnabled: false,
    })
    // Domains added by name are read by any viewer of the page.
    expect(result).toEqual({ sending: [], signIn: SIGN_IN, sectionDomains: null, added: ADDED })
    expect(sending).not.toHaveBeenCalled()
    expect(sections).not.toHaveBeenCalled()
  })

  it('reads nothing for a viewer with none of them', async () => {
    const result = await loadDomainSummaries({ permissions: undefined, cloudEnabled: false })
    expect(result).toEqual({ sending: [], signIn: [], sectionDomains: null, added: [] })
    expect(sending).not.toHaveBeenCalled()
    expect(signIn).not.toHaveBeenCalled()
    expect(sections).not.toHaveBeenCalled()
    expect(added).not.toHaveBeenCalled()
  })

  it('reads no section map for the Domains list, which rows only the domains the workspace owns', async () => {
    const result = await loadDomainSummaries(
      { permissions: [PERMISSIONS.SETTINGS_CUSTOM_DOMAIN], cloudEnabled: false },
      { sectionDomains: false }
    )
    expect(result.sectionDomains).toBeNull()
    expect(sections).not.toHaveBeenCalled()
    expect(added).toHaveBeenCalled()
  })

  it("reads the section domains on Cloud too, for a domain's own page", async () => {
    const result = await loadDomainSummaries({
      permissions: [PERMISSIONS.SETTINGS_CUSTOM_DOMAIN],
      cloudEnabled: true,
    })
    expect(result.sectionDomains).toEqual(SECTIONS)
  })

  it('keeps the uses it could read when one read fails', async () => {
    sending.mockRejectedValue(new Error('down'))
    added.mockRejectedValue(new Error('down'))
    const result = await loadDomainSummaries({
      permissions: [EMAIL_SENDING_PERMISSION, PERMISSIONS.AUTH_MANAGE],
      cloudEnabled: false,
    })
    expect(result).toEqual({ sending: [], signIn: SIGN_IN, sectionDomains: null, added: [] })
  })
})
