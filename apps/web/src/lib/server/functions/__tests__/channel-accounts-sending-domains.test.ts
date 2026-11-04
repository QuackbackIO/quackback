/**
 * The sending-domain server functions: the capability gate and the message a
 * failed action carries back to the settings page.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SesIdentityError } from '@quackback/email/ses-identity'

type AnyHandler = (args?: { data: Record<string, unknown> }) => Promise<unknown>

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain = {
      validator() {
        return chain
      },
      handler: (fn: AnyHandler) => fn,
    }
    return chain
  },
}))

const hoisted = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  defaultTeamId: vi.fn(),
  restart: vi.fn(),
  deleteDomain: vi.fn(),
  listSendingDomains: vi.fn(),
  addAddress: vi.fn(),
  removeAddress: vi.fn(),
  sendTest: vi.fn(),
  addressMode: vi.fn(),
  getInboundRoute: vi.fn(),
  listChannelAccounts: vi.fn(),
}))

vi.mock('@/lib/server/domains/channel-accounts/sending-address', () => ({
  addSendingAddress: hoisted.addAddress,
  removeSendingAddress: hoisted.removeAddress,
  sendTestEmail: hoisted.sendTest,
  sendingAddressMode: hoisted.addressMode,
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({ requireAuth: hoisted.requireAuth }))

vi.mock(
  '@/lib/server/domains/channel-accounts/channel-account.service',
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('@/lib/server/domains/channel-accounts/channel-account.service')
    >()),
    defaultTeamId: hoisted.defaultTeamId,
    deleteSendingDomain: hoisted.deleteDomain,
    listSendingDomains: hoisted.listSendingDomains,
    getInboundRoute: hoisted.getInboundRoute,
    listChannelAccounts: hoisted.listChannelAccounts,
  })
)

vi.mock('@/lib/server/domains/channel-accounts/sending-identity', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/lib/server/domains/channel-accounts/sending-identity')
  >()),
  restartSendingDomainChecks: hoisted.restart,
}))

const {
  deleteSendingDomainFn,
  restartSendingDomainChecksFn,
  createSendingAddressFn,
  deleteChannelAccountFn,
  sendTestEmailFn,
  getEmailChannelConfigFn,
} = await import('../channel-accounts')
const getConfig = getEmailChannelConfigFn as unknown as AnyHandler
const createAddress = createSendingAddressFn as unknown as AnyHandler
const deleteAccount = deleteChannelAccountFn as unknown as AnyHandler
const sendTest = sendTestEmailFn as unknown as AnyHandler
const restartChecks = restartSendingDomainChecksFn as unknown as AnyHandler
const deleteDomain = deleteSendingDomainFn as unknown as AnyHandler

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  hoisted.requireAuth.mockResolvedValue({
    principal: { id: 'principal_1', role: 'admin' },
    user: { id: 'user_1', email: 'admin@example.com' },
  })
  hoisted.defaultTeamId.mockResolvedValue('team_1')
})

describe('restartSendingDomainChecksFn and deleteSendingDomainFn', () => {
  it('asks for a retry on a transient provider failure', async () => {
    hoisted.restart.mockRejectedValue(new SesIdentityError('throttled', 429, 'Throttling', true))
    await expect(restartChecks({ data: { id: 'sending_domain_1' } })).rejects.toThrow(
      "Couldn't reach the mail provider. Try again in a minute."
    )
  })

  it('falls back to the remove wording for an unknown failure', async () => {
    hoisted.deleteDomain.mockRejectedValue(new Error('connection reset'))
    await expect(deleteDomain({ data: { id: 'sending_domain_1' } })).rejects.toThrow(
      "Couldn't remove the domain. Try again, and if it keeps failing, contact your workspace's operator."
    )
  })
})

describe('restartSendingDomainChecksFn', () => {
  it('restarts the named domain and returns its window', async () => {
    hoisted.restart.mockResolvedValue({
      id: 'sending_domain_1',
      domain: 'acme.com',
      status: 'pending',
      dnsRecords: [],
      verifiedAt: null,
      mailFromLabel: 'qb-bounce',
      autoCheckUntil: new Date('2026-11-06T10:00:00.000Z'),
      preflight: {},
      lastCheckedAt: new Date('2026-11-03T10:00:00.000Z'),
    })
    const result = await restartChecks({ data: { id: 'sending_domain_1' } })
    expect(hoisted.restart).toHaveBeenCalledWith('sending_domain_1')
    expect(result).toMatchObject({
      autoCheckUntil: '2026-11-06T10:00:00.000Z',
      lastCheckedAt: '2026-11-03T10:00:00.000Z',
      mailFromLabel: 'qb-bounce',
    })
  })

  it('never sends a held signing key to the page', async () => {
    hoisted.restart.mockResolvedValue({
      id: 'sending_domain_1',
      domain: 'acme.com',
      status: 'pending',
      dnsRecords: [],
      verifiedAt: null,
      mailFromLabel: 'qb-bounce',
      dkimMode: 'shared',
      pendingSigningKey: 'SEALED-SIGNING-KEY',
      autoCheckUntil: null,
      preflight: {},
      lastCheckedAt: null,
    })
    const result = await restartChecks({ data: { id: 'sending_domain_1' } })
    expect(result).not.toHaveProperty('pendingSigningKey')
    expect(result).toMatchObject({ signingKeyPending: true })
    expect(JSON.stringify(result)).not.toContain('SEALED-SIGNING-KEY')
  })

  it('says so when the domain is gone', async () => {
    hoisted.restart.mockResolvedValue(null)
    await expect(restartChecks({ data: { id: 'sending_domain_1' } })).rejects.toThrow(
      'That sending domain no longer exists.'
    )
  })
})

const ACCOUNT = {
  id: 'channel_account_1',
  role: 'sending',
  address: 'help@acme.com',
  module: 'support',
  config: {},
  inboundTrust: 'strict',
  sendingDomainId: 'sending_domain_1',
  createdAt: new Date('2026-11-01T09:00:00.000Z'),
}

describe('createSendingAddressFn', () => {
  it('adds the address through the domain-aware path for the default team', async () => {
    hoisted.addAddress.mockResolvedValue(ACCOUNT)
    const result = await createAddress({ data: { address: 'help@acme.com', module: 'support' } })
    expect(hoisted.requireAuth).toHaveBeenCalledWith({ permission: 'channel_account.manage' })
    expect(hoisted.addAddress).toHaveBeenCalledWith({
      owningTeamId: 'team_1',
      address: 'help@acme.com',
      module: 'support',
    })
    expect(result).toMatchObject({
      id: 'channel_account_1',
      sendingDomainId: 'sending_domain_1',
      createdAt: '2026-11-01T09:00:00.000Z',
    })
  })

  it('carries a provider failure back as a sentence a person can act on', async () => {
    hoisted.addAddress.mockRejectedValue(
      new SesIdentityError('SES refused', 400, 'AccessDeniedException', false)
    )
    await expect(
      createAddress({ data: { address: 'help@acme.com', module: 'support' } })
    ).rejects.toThrow(
      "Custom sending domains aren't set up correctly on this server. Nothing was added."
    )
  })
})

describe('createSendingAddressFn failures', () => {
  it('names the address, not a domain, when an unknown failure stops the add', async () => {
    hoisted.addAddress.mockRejectedValue(new Error('connection reset'))
    await expect(
      createAddress({ data: { address: 'help@acme.com', module: 'support' } })
    ).rejects.toThrow(
      "Couldn't add the address. Try again, and if it keeps failing, contact your workspace's operator."
    )
  })
})

describe('deleteChannelAccountFn', () => {
  it('reports the domain its last address was on', async () => {
    hoisted.removeAddress.mockResolvedValue({
      lastOnDomain: { id: 'sending_domain_1', domain: 'acme.com' },
    })
    const result = await deleteAccount({ data: { id: 'channel_account_1' } })
    expect(hoisted.removeAddress).toHaveBeenCalledWith('channel_account_1')
    expect(result).toEqual({
      id: 'channel_account_1',
      lastOnDomain: { id: 'sending_domain_1', domain: 'acme.com' },
    })
  })
})

describe('sendTestEmailFn', () => {
  it('needs the channel permission and sends to the caller, never to an input', async () => {
    hoisted.sendTest.mockResolvedValue({ from: 'help@acme.com', to: 'admin@example.com' })
    const result = await sendTest({
      data: { addressId: 'channel_account_1', to: 'someone@example.net' },
    })
    expect(hoisted.requireAuth).toHaveBeenCalledWith({ permission: 'channel_account.manage' })
    expect(hoisted.sendTest).toHaveBeenCalledWith({
      addressId: 'channel_account_1',
      userId: 'user_1',
    })
    expect(result).toEqual({ from: 'help@acme.com', to: 'admin@example.com' })
  })

  it('sends nothing when the caller lacks the permission', async () => {
    hoisted.requireAuth.mockRejectedValue(new Error('Access denied'))
    await expect(sendTest({ data: { addressId: 'channel_account_1' } })).rejects.toThrow(
      'Access denied'
    )
    expect(hoisted.sendTest).not.toHaveBeenCalled()
  })
})

describe('getEmailChannelConfigFn', () => {
  it.each(['any', 'verified-domains', 'unavailable'] as const)(
    'tells the page the %s address mode the server decided',
    async (mode) => {
      hoisted.addressMode.mockResolvedValue(mode)
      hoisted.defaultTeamId.mockResolvedValue(null)
      expect(await getConfig()).toMatchObject({ addressMode: mode })
    }
  )
})

describe('getEmailChannelConfigFn domains', () => {
  it('returns a domain no address uses, so the page can list it', async () => {
    hoisted.addressMode.mockResolvedValue('verified-domains')
    hoisted.getInboundRoute.mockResolvedValue(null)
    hoisted.listChannelAccounts.mockResolvedValue([])
    hoisted.listSendingDomains.mockResolvedValue([
      {
        id: 'sending_domain_1',
        domain: 'acme.com',
        status: 'pending',
        dnsRecords: [],
        verifiedAt: null,
        mailFromLabel: 'bounce',
        autoCheckUntil: null,
        preflight: {},
        lastCheckedAt: null,
      },
    ])
    const config = (await getConfig()) as { sendingAddresses: unknown[]; domains: unknown[] }
    expect(hoisted.listSendingDomains).toHaveBeenCalledWith('team_1')
    expect(config.sendingAddresses).toEqual([])
    expect(config.domains).toMatchObject([{ id: 'sending_domain_1', domain: 'acme.com' }])
  })
})

describe('the sending domain DTO', () => {
  it.each(['easy', 'byo', 'shared'] as const)('carries the %s signing mode', async (dkimMode) => {
    hoisted.addressMode.mockResolvedValue('verified-domains')
    hoisted.getInboundRoute.mockResolvedValue(null)
    hoisted.listChannelAccounts.mockResolvedValue([])
    hoisted.listSendingDomains.mockResolvedValue([
      {
        id: 'sending_domain_1',
        domain: 'acme.com',
        status: 'pending',
        dnsRecords: [
          {
            type: 'TXT',
            host: 'qb1a2b3c4d._domainkey',
            value: 'v=DKIM1; k=rsa; p=PUB',
            purpose: 'dkim',
          },
        ],
        verifiedAt: null,
        mailFromLabel: 'qb-bounce',
        autoCheckUntil: null,
        preflight: {},
        lastCheckedAt: null,
        dkimMode,
      },
    ])
    const config = (await getConfig()) as { domains: unknown[] }
    expect(config.domains).toMatchObject([{ dkimMode }])
    expect(JSON.stringify(config)).not.toMatch(/PRIVATE|privateKey/i)
  })
})
