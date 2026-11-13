import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { EMAIL_SENDING_PERMISSION } from '@/lib/shared/email-sending-permissions'

const sending = vi.fn()
const signIn = vi.fn()
const helpCenter = vi.fn()
const added = vi.fn()

vi.mock('@/lib/server/functions/domains-overview', () => ({
  getSendingDomainSummariesFn: sending,
  getSignInDomainSummariesFn: signIn,
  getHelpCenterDomainSummaryFn: helpCenter,
}))

vi.mock('@/lib/server/functions/domains', () => ({ listDomainsFn: added }))

const { loadDomainSummaries } = await import('../domain-summaries')

const SENDING = [{ id: 'dom_1', domain: 'acme.com' }]
const SIGN_IN = [{ id: 'domain_a', name: 'acme.com', verified: true, provenBy: null }]
const HELP = { domain: 'help.acme.com', verified: true }
const ADDED = [{ name: 'acme.io', verified: false }]

beforeEach(() => {
  vi.clearAllMocks()
  sending.mockResolvedValue(SENDING)
  signIn.mockResolvedValue(SIGN_IN)
  helpCenter.mockResolvedValue(HELP)
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
      helpCenterDomain: HELP,
      added: ADDED,
    })
  })

  it('reads only the use whose permission the viewer holds', async () => {
    const result = await loadDomainSummaries({
      permissions: [PERMISSIONS.AUTH_MANAGE],
      cloudEnabled: false,
    })
    // Domains added by name are read by any viewer of the page.
    expect(result).toEqual({ sending: [], signIn: SIGN_IN, helpCenterDomain: null, added: ADDED })
    expect(sending).not.toHaveBeenCalled()
    expect(helpCenter).not.toHaveBeenCalled()
  })

  it('reads nothing for a viewer with none of them', async () => {
    const result = await loadDomainSummaries({ permissions: undefined, cloudEnabled: false })
    expect(result).toEqual({ sending: [], signIn: [], helpCenterDomain: null, added: [] })
    expect(sending).not.toHaveBeenCalled()
    expect(signIn).not.toHaveBeenCalled()
    expect(helpCenter).not.toHaveBeenCalled()
    expect(added).not.toHaveBeenCalled()
  })

  it('leaves the help center domain to the custom domains card on Cloud', async () => {
    await loadDomainSummaries({
      permissions: [PERMISSIONS.SETTINGS_CUSTOM_DOMAIN],
      cloudEnabled: true,
    })
    expect(helpCenter).not.toHaveBeenCalled()
  })

  it('keeps the uses it could read when one read fails', async () => {
    sending.mockRejectedValue(new Error('down'))
    added.mockRejectedValue(new Error('down'))
    const result = await loadDomainSummaries({
      permissions: [EMAIL_SENDING_PERMISSION, PERMISSIONS.AUTH_MANAGE],
      cloudEnabled: false,
    })
    expect(result).toEqual({ sending: [], signIn: SIGN_IN, helpCenterDomain: null, added: [] })
  })
})
