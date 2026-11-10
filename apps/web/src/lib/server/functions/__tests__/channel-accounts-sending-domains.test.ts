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
  workspaceName: { value: 'Acme' as string | undefined },
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
  getEmailSenders: vi.fn(),
  setEmailSender: vi.fn(),
  updateName: vi.fn(),
  guardContext: vi.fn(),
  resolveSender: vi.fn(),
}))

vi.mock('@/lib/server/domains/channel-accounts/email-senders', () => ({
  getEmailSenders: hoisted.getEmailSenders,
  setEmailSender: hoisted.setEmailSender,
}))

vi.mock('@/lib/server/domains/channel-accounts/outbound-identity', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/lib/server/domains/channel-accounts/outbound-identity')
  >()),
  sendingIdentityContext: hoisted.guardContext,
}))

vi.mock('@/lib/server/domains/settings/settings.helpers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/domains/settings/settings.helpers')>()),
  requireSettingsCached: async () => ({ name: hoisted.workspaceName.value }),
}))

vi.mock('@/lib/server/domains/channel-accounts/sending-address', () => ({
  addSendingAddress: hoisted.addAddress,
  removeSendingAddress: hoisted.removeAddress,
  sendTestEmail: hoisted.sendTest,
  addressModeFor: hoisted.addressMode,
}))

vi.mock('@/lib/server/functions/auth-helpers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/functions/auth-helpers')>()),
  requireAuth: hoisted.requireAuth,
}))

vi.mock('@/lib/server/domains/channel-accounts/sender-resolver', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/lib/server/domains/channel-accounts/sender-resolver')
  >()),
  resolveSender: hoisted.resolveSender,
}))

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
    updateSendingAddressName: hoisted.updateName,
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
  setEmailSenderFn,
  updateSendingAddressNameFn,
  createInboundRouteFn,
  getSurfaceSenderFn,
} = await import('../channel-accounts')
const setSender = setEmailSenderFn as unknown as AnyHandler
const updateName = updateSendingAddressNameFn as unknown as AnyHandler
const getConfig = getEmailChannelConfigFn as unknown as AnyHandler
const createAddress = createSendingAddressFn as unknown as AnyHandler
const deleteAccount = deleteChannelAccountFn as unknown as AnyHandler
const sendTest = sendTestEmailFn as unknown as AnyHandler
const restartChecks = restartSendingDomainChecksFn as unknown as AnyHandler
const deleteDomain = deleteSendingDomainFn as unknown as AnyHandler
const createInbound = createInboundRouteFn as unknown as AnyHandler
const surfaceSender = getSurfaceSenderFn as unknown as AnyHandler

/** A caller holding exactly these permissions, as requireAuth checks them. */
function actingWith(...held: string[]) {
  hoisted.requireAuth.mockImplementation(async (options?: { permission?: string }) => {
    if (options?.permission && !held.includes(options.permission)) {
      throw new Error(`Access denied: Requires permission '${options.permission}'`)
    }
    return {
      principal: { id: 'principal_1', role: 'admin' },
      user: { id: 'user_1', email: 'admin@example.com' },
      permissions: held,
      scope: 'dashboard',
    }
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  actingWith('settings.manage', 'channel_account.manage')
  hoisted.defaultTeamId.mockResolvedValue('team_1')
  hoisted.getEmailSenders.mockResolvedValue(new Map())
  hoisted.guardContext.mockResolvedValue(guard())
  hoisted.addressMode.mockReturnValue('verified-domains')
  vi.stubEnv('EMAIL_FROM', 'noreply@mail.quackback.test')
})

/** The send guard's context for a shared server, with these domains verified. */
function guard(verifiedDomains: string[] = []) {
  return {
    verifiedDomains,
    platformFrom: 'noreply@mail.quackback.test',
    inboundDomain: null,
    mailSlug: null,
    pooled: true,
  }
}

describe('restartSendingDomainChecksFn and deleteSendingDomainFn', () => {
  it('asks for a retry on a transient provider failure', async () => {
    hoisted.restart.mockRejectedValue(new SesIdentityError('throttled', 429, 'Throttling', true))
    await expect(restartChecks({ data: { id: 'sending_domain_1' } })).rejects.toThrow(
      "Couldn't reach the email provider. Try again in a minute."
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
    const result = await createAddress({
      data: { address: 'help@acme.com', senderName: 'Acme Support' },
    })
    expect(hoisted.requireAuth).toHaveBeenCalledWith({ permission: 'settings.manage' })
    expect(hoisted.addAddress).toHaveBeenCalledWith({
      owningTeamId: 'team_1',
      address: 'help@acme.com',
      senderName: 'Acme Support',
    })
    expect(result).toMatchObject({
      id: 'channel_account_1',
      sendingDomainId: 'sending_domain_1',
      createdAt: '2026-11-01T09:00:00.000Z',
    })
  })

  it('says whether the address became the default sender', async () => {
    hoisted.addAddress.mockResolvedValue(ACCOUNT)
    hoisted.getEmailSenders.mockResolvedValue(
      new Map<string, unknown>([['default', { mode: 'address', account: { id: ACCOUNT.id } }]])
    )
    expect(await createAddress({ data: { address: 'help@acme.com' } })).toMatchObject({
      madeDefault: true,
    })

    hoisted.getEmailSenders.mockResolvedValue(
      new Map<string, unknown>([['default', { mode: 'address', account: { id: 'another' } }]])
    )
    expect(await createAddress({ data: { address: 'help@acme.com' } })).toMatchObject({
      madeDefault: false,
    })
  })

  it('carries a provider failure back as a sentence a person can act on', async () => {
    hoisted.addAddress.mockRejectedValue(
      new SesIdentityError('SES refused', 400, 'AccessDeniedException', false)
    )
    await expect(
      createAddress({ data: { address: 'help@acme.com', senderName: 'Acme Support' } })
    ).rejects.toThrow(
      "Custom sending domains aren't set up correctly on this server. Nothing was added."
    )
  })
})

describe('createSendingAddressFn failures', () => {
  it('names the address, not a domain, when an unknown failure stops the add', async () => {
    hoisted.addAddress.mockRejectedValue(new Error('connection reset'))
    await expect(
      createAddress({ data: { address: 'help@acme.com', senderName: 'Acme Support' } })
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
  it('needs the workspace settings permission and sends to the caller, never to an input', async () => {
    hoisted.sendTest.mockResolvedValue({ from: 'help@acme.com', to: 'admin@example.com' })
    const result = await sendTest({
      data: { addressId: 'channel_account_1', to: 'someone@example.net' },
    })
    expect(hoisted.requireAuth).toHaveBeenCalledWith({ permission: 'settings.manage' })
    expect(hoisted.sendTest).toHaveBeenCalledWith({
      addressId: 'channel_account_1',
      userId: 'user_1',
      workspaceName: 'Acme',
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
      hoisted.addressMode.mockReturnValue(mode)
      hoisted.defaultTeamId.mockResolvedValue(null)
      expect(await getConfig()).toMatchObject({ addressMode: mode })
    }
  )
})

describe('getEmailChannelConfigFn domains', () => {
  it('returns a domain no address uses, so the page can list it', async () => {
    hoisted.addressMode.mockReturnValue('verified-domains')
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
    hoisted.addressMode.mockReturnValue('verified-domains')
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

describe('choosing which address each kind of email sends from', () => {
  it('reports every surface, the workspace name, and whether the forwarded address may send', async () => {
    hoisted.addressMode.mockReturnValue('verified-domains')
    hoisted.listChannelAccounts.mockResolvedValue([])
    hoisted.listSendingDomains.mockResolvedValue([])
    hoisted.getInboundRoute.mockResolvedValue({
      id: 'channel_account_route',
      role: 'inbound',
      address: null,
      senderName: null,
      config: { forwardingTarget: 'support@acme.com' },
      inboundTrust: 'strict',
      sendingDomainId: null,
      createdAt: new Date('2026-11-01T09:00:00.000Z'),
    })
    hoisted.getEmailSenders.mockResolvedValue(
      new Map<string, unknown>([
        ['default', { mode: 'address', account: { id: 'channel_account_1' } }],
        ['support', { mode: 'inbox', account: null }],
      ])
    )

    const config = (await getConfig()) as Record<string, unknown>
    expect(config.workspaceName).toBe('Acme')
    expect(config.senders).toEqual({
      default: { mode: 'address', id: 'channel_account_1' },
      support: { mode: 'inbox' },
      feedback: null,
      changelog: null,
      status: null,
    })
    expect(config.forwardingTargetPermitted).toBe(false)

    // The address behind the inbox, when it has one, so the page can name it.
    hoisted.getEmailSenders.mockResolvedValue(
      new Map<string, unknown>([
        ['support', { mode: 'inbox', account: { id: 'channel_account_2' } }],
      ])
    )
    expect(((await getConfig()) as { senders: unknown }).senders).toMatchObject({
      support: { mode: 'inbox', fallbackId: 'channel_account_2' },
    })

    hoisted.guardContext.mockResolvedValue(guard(['acme.com']))
    expect(await getConfig()).toMatchObject({ forwardingTargetPermitted: true })
  })

  it('says for each address whether email can leave from it now, as the guard decides', async () => {
    const row = (id: string, address: string) => ({
      id,
      role: 'sending',
      address,
      senderName: null,
      config: {},
      inboundTrust: 'strict',
      sendingDomainId: null,
      createdAt: new Date('2026-11-01T09:00:00.000Z'),
    })
    hoisted.getInboundRoute.mockResolvedValue(null)
    hoisted.listSendingDomains.mockResolvedValue([])
    hoisted.listChannelAccounts.mockResolvedValue([
      row('a1', 'help@mail.acme.com'),
      row('a2', 'help@elsewhere.example'),
      row('a3', 'noreply@mail.quackback.test'),
    ])
    hoisted.guardContext.mockResolvedValue(guard(['acme.com']))
    const config = (await getConfig()) as { sendingAddresses: Array<Record<string, unknown>> }
    expect(config.sendingAddresses.map((a) => [a.id, a.sendable])).toEqual([
      ['a1', true],
      ['a2', false],
      ['a3', true],
    ])
    // One read of the guard's context answers for every address on the page.
    expect(hoisted.guardContext).toHaveBeenCalledTimes(1)
  })

  it('says nothing about a forwarded address when none is forwarded', async () => {
    hoisted.addressMode.mockReturnValue('verified-domains')
    hoisted.listChannelAccounts.mockResolvedValue([])
    hoisted.listSendingDomains.mockResolvedValue([])
    hoisted.getInboundRoute.mockResolvedValue(null)
    const config = (await getConfig()) as Record<string, unknown>
    expect(config.forwardingTargetPermitted).toBeNull()
  })

  it.each([
    [
      { mode: 'address', id: 'channel_account_1' },
      { mode: 'address', channelAccountId: 'channel_account_1' },
    ],
    [{ mode: 'inbox' }, { mode: 'inbox' }],
    [null, null],
  ])('passes the choice %j on behind the permission gate', async (choice, stored) => {
    await setSender({ data: { surface: 'support', choice } })
    expect(hoisted.setEmailSender).toHaveBeenCalledWith('support', stored)
  })

  it('renames an address behind the permission gate', async () => {
    hoisted.updateName.mockResolvedValue({
      id: 'channel_account_1',
      role: 'sending',
      address: 'help@acme.com',
      senderName: 'Acme',
      config: {},
      inboundTrust: 'strict',
      sendingDomainId: null,
      createdAt: new Date('2026-11-01T09:00:00.000Z'),
    })
    const result = await updateName({ data: { id: 'channel_account_1', senderName: 'Acme' } })
    expect(hoisted.requireAuth).toHaveBeenCalledWith({ permission: 'settings.manage' })
    expect(hoisted.updateName).toHaveBeenCalledWith({ id: 'channel_account_1', senderName: 'Acme' })
    expect(result).toMatchObject({ senderName: 'Acme' })
  })
})

describe('who may change sending', () => {
  it.each([
    ['add an address', () => createAddress({ data: { address: 'help@acme.com' } })],
    ['rename an address', () => updateName({ data: { id: 'channel_account_1', senderName: 'A' } })],
    ['remove an address', () => deleteAccount({ data: { id: 'channel_account_1' } })],
    ['send a test', () => sendTest({ data: { addressId: 'channel_account_1' } })],
    ['re-check a domain', () => restartChecks({ data: { id: 'sending_domain_1' } })],
    ['remove a domain', () => deleteDomain({ data: { id: 'sending_domain_1' } })],
  ])('a support lead may not %s', async (_, act) => {
    actingWith('channel_account.manage')
    await expect(act()).rejects.toThrow('Access denied')
    expect(hoisted.addAddress).not.toHaveBeenCalled()
    expect(hoisted.removeAddress).not.toHaveBeenCalled()
    expect(hoisted.sendTest).not.toHaveBeenCalled()
    expect(hoisted.restart).not.toHaveBeenCalled()
    expect(hoisted.deleteDomain).not.toHaveBeenCalled()
  })

  it.each(['default', 'feedback', 'changelog', 'status'])(
    'a support lead may not choose the %s sender',
    async (surface) => {
      actingWith('channel_account.manage')
      await expect(setSender({ data: { surface, choice: null } })).rejects.toThrow('Access denied')
      expect(hoisted.setEmailSender).not.toHaveBeenCalled()
    }
  )

  it.each([['channel_account.manage'], ['settings.manage']])(
    'the support sender may be chosen with %s',
    async (permission) => {
      actingWith(permission)
      await setSender({ data: { surface: 'support', choice: { mode: 'inbox' } } })
      expect(hoisted.setEmailSender).toHaveBeenCalledWith('support', { mode: 'inbox' })
    }
  )

  it('nobody without either permission chooses the support sender', async () => {
    actingWith('changelog.manage')
    await expect(
      setSender({ data: { surface: 'support', choice: { mode: 'inbox' } } })
    ).rejects.toThrow('Access denied')
    expect(hoisted.setEmailSender).not.toHaveBeenCalled()
  })

  it('an admin without the support permission chooses every sender', async () => {
    actingWith('settings.manage')
    await setSender({ data: { surface: 'changelog', choice: null } })
    expect(hoisted.setEmailSender).toHaveBeenCalledWith('changelog', null)
  })

  it.each([['channel_account.manage'], ['settings.manage']])(
    'the email config reads with %s',
    async (permission) => {
      actingWith(permission)
      hoisted.addressMode.mockReturnValue('verified-domains')
      hoisted.defaultTeamId.mockResolvedValue(null)
      await expect(getConfig()).resolves.toMatchObject({ addressMode: 'verified-domains' })
    }
  )

  it('the email config does not read without either', async () => {
    actingWith('changelog.manage')
    await expect(getConfig()).rejects.toThrow('Access denied')
  })

  it('the support inbox stays with the support permission', async () => {
    actingWith('settings.manage')
    await expect(createInbound({ data: { forwardingTarget: 'support@acme.com' } })).rejects.toThrow(
      'Access denied'
    )
  })
})

describe('getSurfaceSenderFn', () => {
  it('names the address a kind of email sends from', async () => {
    actingWith('changelog.manage')
    hoisted.resolveSender.mockResolvedValue({
      from: 'Updates <hello@updates.acme.com>',
      source: 'surface',
      senderName: 'Acme Updates',
    })
    const result = await surfaceSender({ data: { surface: 'changelog' } })
    expect(hoisted.resolveSender).toHaveBeenCalledWith({ surface: 'changelog', preview: true })
    expect(result).toEqual({ from: 'Acme Updates <hello@updates.acme.com>' })
  })

  it('uses the workspace name for an address with none of its own', async () => {
    actingWith('status_page.manage')
    hoisted.resolveSender.mockResolvedValue({
      from: 'hello@acme.com',
      source: 'default',
      senderName: null,
    })
    expect(await surfaceSender({ data: { surface: 'status' } })).toEqual({
      from: 'Acme <hello@acme.com>',
    })
  })

  it('falls back to the platform address under the workspace name', async () => {
    actingWith('changelog.manage')
    hoisted.resolveSender.mockResolvedValue(null)
    expect(await surfaceSender({ data: { surface: 'changelog' } })).toEqual({
      from: 'Acme <noreply@mail.quackback.test>',
    })
  })

  it('shows the bare address when there is no name to put on it', async () => {
    actingWith('changelog.manage')
    hoisted.workspaceName.value = ''
    hoisted.resolveSender.mockResolvedValue({
      from: 'hello@acme.com',
      source: 'default',
      senderName: null,
    })
    try {
      expect(await surfaceSender({ data: { surface: 'changelog' } })).toEqual({
        from: 'hello@acme.com',
      })
    } finally {
      hoisted.workspaceName.value = 'Acme'
    }
  })

  it('does not report a support sender, which depends on the conversation', async () => {
    actingWith('settings.manage')
    await expect(surfaceSender({ data: { surface: 'support' } })).rejects.toThrow()
    expect(hoisted.resolveSender).not.toHaveBeenCalled()
  })

  it.each([
    ['changelog', 'status_page.manage'],
    ['status', 'changelog.manage'],
  ])('keeps the %s sender from a caller holding only %s', async (surface, permission) => {
    actingWith(permission)
    await expect(surfaceSender({ data: { surface } })).rejects.toThrow('Access denied')
    expect(hoisted.resolveSender).not.toHaveBeenCalled()
  })

  it('reads for an admin on any surface', async () => {
    actingWith('settings.manage')
    hoisted.resolveSender.mockResolvedValue(null)
    await expect(surfaceSender({ data: { surface: 'feedback' } })).resolves.toEqual({
      from: 'Acme <noreply@mail.quackback.test>',
    })
  })
})
