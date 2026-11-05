/**
 * Adding, removing and testing a sending address, against a real database and
 * a fake provider.
 *
 * An address on a domain this workspace has not verified is allowed: it brings
 * its domain with it (a new one, or the one already being set up) and sends
 * from the default address until that domain is live.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import type { ChannelAccountId, TeamId, UserId } from '@quackback/ids'
import type { SesDomainIdentity, SesIdentityCreation } from '@quackback/email/ses-identity'
import type { RawEmailOptions } from '@quackback/email'

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { eq, isNull, and, teams, emailSendingDomains, channelAccounts } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

const createIdentity = vi.fn<(domain: string) => Promise<SesIdentityCreation>>()
/** What the provider reports for a domain before anything is created here. */
const existingIdentity = vi.fn<(domain: string) => SesDomainIdentity | null>()
vi.mock('@quackback/email/ses-identity', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@quackback/email/ses-identity')>()),
  createSesDomainIdentity: (domain: string) => createIdentity(domain),
  getSesDomainIdentity: async (domain: string) => existingIdentity(domain) ?? identity(domain),
  putSesMailFromDomain: async () => {},
}))

/** Every send, as the provider would have been handed it. */
const sent = vi.fn<(options: RawEmailOptions) => void>()
vi.mock('@quackback/email', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@quackback/email')>()),
  sendRawEmail: async (options: RawEmailOptions) => {
    sent(options)
    return { sent: true }
  },
}))

/** Each user's own account address, looked up by the id it is asked for. */
const accountEmails = new Map<string, string>()
vi.mock('@/lib/server/email/recipient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/email/recipient')>()),
  resolveAccountRecipient: async (userId: string) => accountEmails.get(userId) ?? null,
}))

/**
 * A zone with nothing in it, so pre-flight finds every name free. The
 * nameserver lookup runs a test's hook first, for work that has to land
 * between an add looking for its domain and inserting one.
 */
const duringPreflight = vi.fn<() => Promise<void>>()
vi.mock('@/lib/server/dns/resolver', () => {
  const none = async () => {
    throw Object.assign(new Error('ENODATA'), { code: 'ENODATA' })
  }
  const resolver = {
    resolveTxt: none,
    resolveCname: none,
    resolveMx: none,
    resolve4: none,
    resolveNs: async () => {
      await duringPreflight()
      return none()
    },
  }
  return { systemResolver: resolver, interactiveResolver: resolver }
})

/**
 * The send guard, passed through, except for addresses a test says it refuses.
 * Records every address it is asked about.
 */
const guardAsked = vi.fn<(from: string | null) => void>()
const guardRefuses = new Set<string>()
vi.mock('../outbound-identity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../outbound-identity')>()
  return {
    ...actual,
    permittedSendingIdentity: async (from: string | null) => {
      guardAsked(from)
      if (from && guardRefuses.has(from)) return null
      return actual.permittedSendingIdentity(from)
    },
  }
})

const maxSendingDomains = vi.fn<() => number | null>(() => null)
vi.mock('@/lib/server/domains/settings/tier-limits.service', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/server/domains/settings/tier-limits.service')>()
  const { OSS_TIER_LIMITS } = await import('@/lib/server/domains/settings/tier-limits.types')
  return {
    ...actual,
    getTierLimits: async () => ({ ...OSS_TIER_LIMITS, maxSendingDomains: maxSendingDomains() }),
  }
})

import {
  addSendingAddress,
  removeSendingAddress,
  sendTestEmail,
  sendingAddressMode,
} from '../sending-address'
import { deleteSendingDomain, SendingDomainInUseError } from '../channel-account.service'

const identity = (domain: string): SesDomainIdentity => ({
  domain,
  dkimTokens: ['aaa', 'bbb', 'ccc'],
  signingHostedZone: null,
  dkimStatus: 'PENDING',
  verifiedForSending: false,
  mailFrom: { domain: `qb-bounce.${domain}`, status: 'PENDING' },
})

const SES_ENV = {
  EMAIL_SES_ACCESS_KEY_ID: 'AKIASEND',
  EMAIL_SES_SECRET_ACCESS_KEY: 'send-secret',
  EMAIL_SES_REGION: 'eu-west-2',
  EMAIL_SES_IDENTITY_ACCESS_KEY_ID: 'AKIAIDENT',
  EMAIL_SES_IDENTITY_SECRET_ACCESS_KEY: 'ident-secret',
}

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: emailSendingDomains.id }).from(emailSendingDomains).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

async function seedTeam(): Promise<TeamId> {
  const [team] = await testDb
    .insert(teams)
    .values({ name: `Team-${suffix()}` })
    .returning()
  return team.id
}

async function seedDomain(teamId: TeamId, domain: string, status: 'pending' | 'verified') {
  const [row] = await testDb
    .insert(emailSendingDomains)
    .values({ owningTeamId: teamId, domain, status })
    .returning()
  return row
}

async function domainsOf(teamId: TeamId) {
  return testDb
    .select()
    .from(emailSendingDomains)
    .where(eq(emailSendingDomains.owningTeamId, teamId))
}

async function liveAddresses(teamId: TeamId) {
  return testDb
    .select()
    .from(channelAccounts)
    .where(and(eq(channelAccounts.owningTeamId, teamId), isNull(channelAccounts.deletedAt)))
}

describe.skipIf(!fixture.available)('sending addresses (real DB, rolled back)', () => {
  beforeEach(async () => {
    await fixture.begin()
    for (const [k, v] of Object.entries(SES_ENV)) vi.stubEnv(k, v)
    vi.stubEnv('EMAIL_SMTP_HOST', '')
    vi.stubEnv('EMAIL_RESEND_API_KEY', '')
    vi.stubEnv('RESEND_API_KEY', '')
    vi.stubEnv('EMAIL_FROM', 'Quackback <notifications@mail.platform.test>')
    vi.stubEnv('EMAIL_INBOUND_DOMAIN', 'mail.platform.test')
    // Many workspaces share the provider account, so the guard is strict.
    vi.stubEnv('QUACKBACK_TENANCY', 'pooled')
    createIdentity
      .mockReset()
      .mockImplementation(async (domain) => ({ identity: identity(domain), preexisting: false }))
    maxSendingDomains.mockReset().mockReturnValue(null)
    existingIdentity.mockReset().mockReturnValue(null)
    duringPreflight.mockReset().mockResolvedValue()
    sent.mockReset()
    accountEmails.clear()
    guardAsked.mockReset()
    guardRefuses.clear()
  })
  afterEach(async () => {
    vi.unstubAllEnvs()
    await fixture.rollback()
  })
  afterAll(fixture.close)

  describe('addSendingAddress', () => {
    it('sets up the domain of an address on an unverified domain and links the address to it', async () => {
      const teamId = await seedTeam()
      const account = await addSendingAddress({
        owningTeamId: teamId,
        address: 'Help@Acme.com',
        module: 'support',
      })

      const [domain] = await domainsOf(teamId)
      expect(domain).toMatchObject({ domain: 'acme.com', status: 'pending' })
      expect(createIdentity).toHaveBeenCalledWith('acme.com')
      expect(account).toMatchObject({ address: 'help@acme.com', sendingDomainId: domain.id })
    })

    it('reuses the domain already being set up for a second address on it', async () => {
      const teamId = await seedTeam()
      const first = await addSendingAddress({
        owningTeamId: teamId,
        address: 'help@acme.com',
        module: 'support',
      })
      createIdentity.mockClear()
      const second = await addSendingAddress({
        owningTeamId: teamId,
        address: 'news@acme.com',
        module: 'changelog',
      })

      expect(createIdentity).not.toHaveBeenCalled()
      expect(await domainsOf(teamId)).toHaveLength(1)
      expect(second.sendingDomainId).toBe(first.sendingDomainId)
    })

    it('links an address on a verified domain without setting anything up', async () => {
      const teamId = await seedTeam()
      const verified = await seedDomain(teamId, 'acme.com', 'verified')
      const account = await addSendingAddress({
        owningTeamId: teamId,
        address: 'help@acme.com',
        module: 'support',
      })
      expect(createIdentity).not.toHaveBeenCalled()
      expect(account.sendingDomainId).toBe(verified.id)
    })

    it('refuses past the plan cap and keeps no address', async () => {
      const teamId = await seedTeam()
      maxSendingDomains.mockReturnValue(1)
      await addSendingAddress({
        owningTeamId: teamId,
        address: 'help@a.example',
        module: 'support',
      })

      await expect(
        addSendingAddress({ owningTeamId: teamId, address: 'help@b.example', module: 'feedback' })
      ).rejects.toThrow(/sending domains/i)
      expect((await liveAddresses(teamId)).map((a) => a.address)).toEqual(['help@a.example'])
    })

    it('refuses with the one line on a server that cannot set up domains', async () => {
      vi.stubEnv('EMAIL_SES_IDENTITY_ACCESS_KEY_ID', '')
      const teamId = await seedTeam()
      await expect(
        addSendingAddress({ owningTeamId: teamId, address: 'help@acme.com', module: 'support' })
      ).rejects.toThrow("Custom sending addresses aren't available on this server.")
      expect(await liveAddresses(teamId)).toEqual([])
      expect(await domainsOf(teamId)).toEqual([])
    })

    it('still adds an address on a single-workspace server that cannot set up domains', async () => {
      // One workspace, its own provider account: the send guard already lets it
      // send as anything, as it always has.
      vi.stubEnv('EMAIL_SES_IDENTITY_ACCESS_KEY_ID', '')
      vi.stubEnv('QUACKBACK_TENANCY', '')
      const teamId = await seedTeam()
      const account = await addSendingAddress({
        owningTeamId: teamId,
        address: 'help@acme.com',
        module: 'support',
      })
      expect(account).toMatchObject({ address: 'help@acme.com', sendingDomainId: null })
      expect(await domainsOf(teamId)).toEqual([])
    })

    it('sets up the domain on a single-workspace server that can, and links the address', async () => {
      vi.stubEnv('QUACKBACK_TENANCY', '')
      const teamId = await seedTeam()
      const account = await addSendingAddress({
        owningTeamId: teamId,
        address: 'help@acme.com',
        module: 'support',
      })
      const [domain] = await domainsOf(teamId)
      expect(domain).toMatchObject({ domain: 'acme.com', status: 'pending' })
      expect(account.sendingDomainId).toBe(domain.id)
    })

    it('still adds the address on a single-workspace server when its domain cannot be set up', async () => {
      // The address was always accepted here; a refused setup must not refuse it.
      vi.stubEnv('QUACKBACK_TENANCY', '')
      const teamId = await seedTeam()
      maxSendingDomains.mockReturnValue(1)
      await addSendingAddress({
        owningTeamId: teamId,
        address: 'help@a.example',
        module: 'support',
      })

      const account = await addSendingAddress({
        owningTeamId: teamId,
        address: 'help@b.example',
        module: 'feedback',
      })
      expect(account).toMatchObject({ address: 'help@b.example', sendingDomainId: null })
      expect((await domainsOf(teamId)).map((d) => d.domain)).toEqual(['a.example'])
    })

    it('leaves a domain verified by hand alone on a single-workspace server', async () => {
      // The operator verified acme.com themselves; creating a row and an
      // identity setup over it would only get in the way.
      vi.stubEnv('QUACKBACK_TENANCY', '')
      existingIdentity.mockImplementation((domain) =>
        domain === 'acme.com'
          ? { ...identity(domain), dkimStatus: 'SUCCESS', verifiedForSending: true }
          : null
      )
      const teamId = await seedTeam()
      const account = await addSendingAddress({
        owningTeamId: teamId,
        address: 'help@acme.com',
        module: 'support',
      })
      expect(account).toMatchObject({ address: 'help@acme.com', sendingDomainId: null })
      expect(await domainsOf(teamId)).toEqual([])
      expect(createIdentity).not.toHaveBeenCalled()
    })

    it('sets up a pending identity that already exists without re-keying it (single workspace)', async () => {
      vi.stubEnv('QUACKBACK_TENANCY', '')
      existingIdentity.mockImplementation((domain) => ({
        ...identity(domain),
        verifiedForSending: false,
      }))
      createIdentity.mockImplementation(async (domain) => ({
        identity: { ...identity(domain), verifiedForSending: false },
        preexisting: true,
      }))
      const teamId = await seedTeam()
      await addSendingAddress({ owningTeamId: teamId, address: 'help@acme.com', module: 'support' })
      const [row] = await domainsOf(teamId)
      expect(row.dkimMode).toBe('shared')
    })

    it('still sets up an unverified identity on a single-workspace server', async () => {
      vi.stubEnv('QUACKBACK_TENANCY', '')
      existingIdentity.mockImplementation((domain) => ({
        ...identity(domain),
        verifiedForSending: false,
      }))
      const teamId = await seedTeam()
      const account = await addSendingAddress({
        owningTeamId: teamId,
        address: 'help@acme.com',
        module: 'support',
      })
      expect(account.sendingDomainId).not.toBeNull()
      expect(createIdentity).toHaveBeenCalledWith('acme.com')
    })

    it.each([
      ['shared', 'pooled'],
      ['single-workspace', ''],
    ])(
      'reuses the row another add created for the same domain a moment earlier (%s)',
      async (_l, tenancy) => {
        // The other add's row lands after this one looked for it and before it
        // inserted its own, which is the unique-key race.
        vi.stubEnv('QUACKBACK_TENANCY', tenancy)
        const teamId = await seedTeam()
        let winner: { id: string } | undefined
        duringPreflight.mockImplementationOnce(async () => {
          winner = await seedDomain(teamId, 'acme.com', 'pending')
        })
        const account = await addSendingAddress({
          owningTeamId: teamId,
          address: 'help@acme.com',
          module: 'support',
        })
        expect(winner).toBeDefined()
        expect(await domainsOf(teamId)).toHaveLength(1)
        expect(account.sendingDomainId).toBe(winner?.id)
      }
    )

    it('reuses the row another add created when that add took the last plan slot', async () => {
      // The winner's row fills the plan, so this add is refused at the cap
      // before it ever reaches the unique key. The domain exists all the same.
      maxSendingDomains.mockReturnValue(1)
      const teamId = await seedTeam()
      let winner: { id: string } | undefined
      duringPreflight.mockImplementationOnce(async () => {
        winner = await seedDomain(teamId, 'acme.com', 'pending')
      })
      const account = await addSendingAddress({
        owningTeamId: teamId,
        address: 'help@acme.com',
        module: 'support',
      })
      expect(winner).toBeDefined()
      expect(await domainsOf(teamId)).toHaveLength(1)
      expect(account.sendingDomainId).toBe(winner?.id)
    })

    it('still refuses at the plan cap when the domain was not added meanwhile', async () => {
      maxSendingDomains.mockReturnValue(1)
      const teamId = await seedTeam()
      duringPreflight.mockImplementationOnce(async () => {
        await seedDomain(teamId, 'other.example', 'pending')
      })
      await expect(
        addSendingAddress({ owningTeamId: teamId, address: 'help@acme.com', module: 'support' })
      ).rejects.toThrow(/sending domains/i)
      expect(await liveAddresses(teamId)).toEqual([])
    })

    it('adds the platform default address without setting up a domain', async () => {
      const teamId = await seedTeam()
      const account = await addSendingAddress({
        owningTeamId: teamId,
        address: 'notifications@mail.platform.test',
        module: 'support',
      })
      expect(account.sendingDomainId).toBeNull()
      expect(createIdentity).not.toHaveBeenCalled()
    })

    it('releases a domain it set up when the address itself is refused', async () => {
      const teamId = await seedTeam()
      await testDb.insert(channelAccounts).values({
        owningTeamId: teamId,
        role: 'inbound',
        address: 'help@acme.com',
      })
      await expect(
        addSendingAddress({ owningTeamId: teamId, address: 'help@acme.com', module: 'support' })
      ).rejects.toThrow()
      expect(await domainsOf(teamId)).toEqual([])
    })
  })

  describe('sendingAddressMode', () => {
    it('is any on a single-workspace server, whatever it can set up', async () => {
      vi.stubEnv('QUACKBACK_TENANCY', '')
      expect(await sendingAddressMode()).toBe('any')
      vi.stubEnv('EMAIL_SES_IDENTITY_ACCESS_KEY_ID', '')
      expect(await sendingAddressMode()).toBe('any')
    })

    it('is verified-domains on a shared server that can set up domains', async () => {
      expect(await sendingAddressMode()).toBe('verified-domains')
    })

    it('is unavailable on a shared server that cannot', async () => {
      vi.stubEnv('EMAIL_SES_IDENTITY_ACCESS_KEY_ID', '')
      expect(await sendingAddressMode()).toBe('unavailable')
    })
  })

  describe('removeSendingAddress', () => {
    it('flags the domain when its last address goes', async () => {
      const teamId = await seedTeam()
      const a = await addSendingAddress({
        owningTeamId: teamId,
        address: 'help@acme.com',
        module: 'support',
      })
      const b = await addSendingAddress({
        owningTeamId: teamId,
        address: 'news@acme.com',
        module: 'changelog',
      })

      expect(await removeSendingAddress(a.id)).toEqual({ lastOnDomain: null })
      expect(await removeSendingAddress(b.id)).toEqual({
        lastOnDomain: { id: b.sendingDomainId, domain: 'acme.com' },
      })
      expect(await liveAddresses(teamId)).toEqual([])
    })

    it('does not flag a domain an unlinked address still sends from', async () => {
      const teamId = await seedTeam()
      const verified = await seedDomain(teamId, 'acme.com', 'verified')
      await testDb.insert(channelAccounts).values({
        owningTeamId: teamId,
        role: 'sending',
        address: 'old@acme.com',
        module: 'feedback',
      })
      const linked = await addSendingAddress({
        owningTeamId: teamId,
        address: 'help@acme.com',
        module: 'support',
      })
      expect(linked.sendingDomainId).toBe(verified.id)
      expect(await removeSendingAddress(linked.id)).toEqual({ lastOnDomain: null })
    })

    it('flags the domain of an unlinked address by its zone', async () => {
      const teamId = await seedTeam()
      const verified = await seedDomain(teamId, 'acme.com', 'verified')
      const [old] = await testDb
        .insert(channelAccounts)
        .values({
          owningTeamId: teamId,
          role: 'sending',
          address: 'old@acme.com',
          module: 'support',
        })
        .returning()
      expect(await removeSendingAddress(old.id)).toEqual({
        lastOnDomain: { id: verified.id, domain: 'acme.com' },
      })
    })

    it('lets the domain be deleted once its last address is removed', async () => {
      const teamId = await seedTeam()
      const account = await addSendingAddress({
        owningTeamId: teamId,
        address: 'help@acme.com',
        module: 'support',
      })
      const { lastOnDomain } = await removeSendingAddress(account.id)
      if (!lastOnDomain) throw new Error('expected the domain to be flagged')

      await deleteSendingDomain(lastOnDomain.id)
      expect(await domainsOf(teamId)).toEqual([])
    })

    it('still refuses to delete a domain a live address uses', async () => {
      const teamId = await seedTeam()
      const account = await addSendingAddress({
        owningTeamId: teamId,
        address: 'help@acme.com',
        module: 'support',
      })
      if (!account.sendingDomainId) throw new Error('expected a linked domain')
      await expect(deleteSendingDomain(account.sendingDomainId)).rejects.toThrow(
        SendingDomainInUseError
      )
      expect(await domainsOf(teamId)).toHaveLength(1)
    })

    it('flags nothing for an address with no domain', async () => {
      const teamId = await seedTeam()
      const account = await addSendingAddress({
        owningTeamId: teamId,
        address: 'notifications@mail.platform.test',
        module: 'support',
      })
      expect(await removeSendingAddress(account.id)).toEqual({ lastOnDomain: null })
    })
  })

  describe('sendTestEmail', () => {
    it('sends from the address to the person asking, and says which From went out', async () => {
      const teamId = await seedTeam()
      await seedDomain(teamId, 'acme.com', 'verified')
      const account = await addSendingAddress({
        owningTeamId: teamId,
        address: 'help@acme.com',
        module: 'support',
      })
      accountEmails.set('user_admin', 'admin@example.com')
      accountEmails.set('user_other', 'other@example.com')

      const result = await sendTestEmail({
        addressId: account.id,
        userId: 'user_admin' as UserId,
      })

      expect(sent).toHaveBeenCalledTimes(1)
      expect(sent.mock.calls[0][0]).toMatchObject({
        from: 'help@acme.com',
        to: 'admin@example.com',
      })
      expect(result).toEqual({ from: 'help@acme.com', to: 'admin@example.com' })
    })

    it('refuses while the domain is not live', async () => {
      const teamId = await seedTeam()
      const account = await addSendingAddress({
        owningTeamId: teamId,
        address: 'help@acme.com',
        module: 'support',
      })
      accountEmails.set('user_admin', 'admin@example.com')
      await expect(
        sendTestEmail({ addressId: account.id, userId: 'user_admin' as UserId })
      ).rejects.toThrow(/acme\.com/)
      expect(sent).not.toHaveBeenCalled()
    })

    it('goes through the send guard, and reports the default address when it falls back', async () => {
      const teamId = await seedTeam()
      await seedDomain(teamId, 'acme.com', 'verified')
      const account = await addSendingAddress({
        owningTeamId: teamId,
        address: 'help@acme.com',
        module: 'support',
      })
      accountEmails.set('user_admin', 'admin@example.com')
      guardRefuses.add('help@acme.com')

      const result = await sendTestEmail({ addressId: account.id, userId: 'user_admin' as UserId })

      expect(guardAsked).toHaveBeenCalledWith('help@acme.com')
      expect(sent.mock.calls[0][0].from).toBe('Quackback <notifications@mail.platform.test>')
      expect(result.from).toBe('Quackback <notifications@mail.platform.test>')
    })

    it('refuses an id that is not a sending address', async () => {
      await expect(
        sendTestEmail({
          addressId: 'channel_account_missing' as ChannelAccountId,
          userId: 'u' as UserId,
        })
      ).rejects.toThrow()
      expect(sent).not.toHaveBeenCalled()
    })
  })
})
