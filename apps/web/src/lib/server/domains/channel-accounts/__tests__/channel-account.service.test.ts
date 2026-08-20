/**
 * Real-DB coverage for the channel-account service (support platform §4.8 Layer 2):
 * one inbound route per workspace (partial-unique), sending addresses resolved per
 * module, sending-domain verify toggle, and the soft-delete filter. Runs inside the
 * db-test-fixture rollback transaction.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { type TeamId } from '@quackback/ids'

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { mailSlugFor, withWorkspace } from '@/lib/server/__tests__/workspace-scope'

// The inbound channel's addressing half. Every reader of it reads at call time,
// so setting it here is enough to fix the address the platform inbox derives.
process.env.EMAIL_INBOUND_DOMAIN = 'tenaevexeo.resend.app'
process.env.EMAIL_INBOUND_SIGNING_SECRET = 'whsec_dGVzdHNlY3JldA=='
import { teams, channelAccounts, emailSendingDomains, eq } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import {
  ChannelAddressInUseError,
  createInboundRoute,
  ensurePlatformInboundRoute,
  setInboundForwardingTarget,
  createSendingAddress,
  createSendingDomain,
  getInboundRoute,
  getSendingAddress,
  getSendingDomain,
  deleteSendingDomain,
  SendingDomainInUseError,
  listChannelAccounts,
  softDeleteChannelAccount,
  resolveChannelAccountByRecipient,
  resolveSendingAddress,
  updateInboundTrust,
  clearInboundForwarding,
  updateSendingAddressSmtp,
} from '../channel-account.service'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: channelAccounts.id }).from(channelAccounts).limit(0)
    await db.select({ id: emailSendingDomains.id }).from(emailSendingDomains).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

/** A workspace named as the live fleet names one, and the address it has for
 *  being one. Derived from the slug rather than written out, so the two sides of
 *  every platform-inbox case here cannot drift apart. */
const WORKSPACE = 'live-t1'
const PLATFORM_ADDRESS = `${mailSlugFor(WORKSPACE)}@tenaevexeo.resend.app`

async function seedTeam(): Promise<TeamId> {
  const [team] = await testDb
    .insert(teams)
    .values({ name: `Team-${suffix()}` })
    .returning()
  return team.id
}

describe.skipIf(!fixture.available)('channel-account.service (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('creates + resolves one inbound route per workspace, and rejects a second', async () => {
    const teamId = await seedTeam()
    const route = await createInboundRoute({
      owningTeamId: teamId,
      config: { forwardingTarget: 'support@acme.com', provider: 'resend' },
    })
    expect(route.role).toBe('inbound')
    expect(route.channel).toBe('email')
    expect(route.inboundTrust).toBe('strict')

    const resolved = await getInboundRoute(teamId)
    expect(resolved?.id).toBe(route.id)
    expect(resolved?.config.forwardingTarget).toBe('support@acme.com')

    // The partial-unique enforces one inbound route per workspace.
    await expect(
      createInboundRoute({ owningTeamId: teamId, config: { provider: 'imap' } })
    ).rejects.toThrow()
  })

  it('resolves a sending address by module', async () => {
    const teamId = await seedTeam()
    await createSendingAddress({
      owningTeamId: teamId,
      address: 'Support@Acme.com',
      module: 'support',
    })
    await createSendingAddress({
      owningTeamId: teamId,
      address: 'ideas@acme.com',
      module: 'feedback',
    })

    const support = await getSendingAddress(teamId, 'support')
    expect(support?.address).toBe('support@acme.com') // lowercased on write
    expect(support?.module).toBe('support')

    const feedback = await getSendingAddress(teamId, 'feedback')
    expect(feedback?.address).toBe('ideas@acme.com')

    expect(await getSendingAddress(teamId, 'changelog')).toBeNull()
  })

  it('creates a sending domain pending, and removing it frees the name again', async () => {
    // Pending on creation and only ever moved by the checker: there is no
    // manual toggle, because a status this row can be given by hand is a
    // sending identity this workspace can grant itself.
    const teamId = await seedTeam()
    const domain = await createSendingDomain({
      owningTeamId: teamId,
      domain: 'Mail.Acme.com',
      dnsRecords: [
        {
          type: 'TXT',
          host: '_quackback',
          value: 'quackback-domain-verification=6f1c2a9e4b8d0f37',
          purpose: 'ownership',
        },
      ],
    })
    expect(domain.domain).toBe('mail.acme.com')
    expect(domain.status).toBe('pending')
    expect(domain.dnsRecords).toHaveLength(1)

    // A typo would otherwise hold its slot and its name forever: the unique
    // index on (team, domain) refuses the re-add until the row is gone.
    await deleteSendingDomain(domain.id)
    expect(await getSendingDomain(domain.id)).toBeNull()
    const again = await createSendingDomain({ owningTeamId: teamId, domain: 'mail.acme.com' })
    expect(again.status).toBe('pending')
  })

  it('refuses to delete a sending domain while an address still names it', async () => {
    const teamId = await seedTeam()
    const domain = await createSendingDomain({ owningTeamId: teamId, domain: 'mail.acme.com' })
    await createSendingAddress({
      owningTeamId: teamId,
      address: 'help@acme.com',
      module: 'support',
      sendingDomainId: domain.id,
    })
    await expect(deleteSendingDomain(domain.id)).rejects.toBeInstanceOf(SendingDomainInUseError)
    expect(await getSendingDomain(domain.id)).not.toBeNull()
  })

  it('updates inbound trust and can clear the forwarding target', async () => {
    const teamId = await seedTeam()
    await setInboundForwardingTarget({
      owningTeamId: teamId,
      forwardingTarget: 'support@acme.com',
    })
    const trusted = await updateInboundTrust({ owningTeamId: teamId, inboundTrust: 'lenient' })
    expect(trusted.inboundTrust).toBe('lenient')
    expect(trusted.config.forwardingTarget).toBe('support@acme.com')

    const cleared = await clearInboundForwarding(teamId)
    expect(cleared?.config.forwardingTarget).toBeUndefined()
    expect(cleared?.inboundTrust).toBe('lenient')
    expect(await getInboundRoute(teamId)).not.toBeNull()
  })

  it('sets and clears a per-address SMTP override', async () => {
    const teamId = await seedTeam()
    const sending = await createSendingAddress({
      owningTeamId: teamId,
      address: 'help@acme.com',
      module: 'support',
    })
    const withSmtp = await updateSendingAddressSmtp({
      id: sending.id,
      smtp: { host: 'smtp.example.com', port: 587, secure: true, user: 'help' },
    })
    expect(withSmtp.config.smtp).toEqual({
      host: 'smtp.example.com',
      port: 587,
      secure: true,
      user: 'help',
    })
    const cleared = await updateSendingAddressSmtp({ id: sending.id, smtp: null })
    expect(cleared.config.smtp).toBeUndefined()
  })

  it('resolves a channel account by a sending address or the inbound forwarding target', async () => {
    const teamId = await seedTeam()
    await createInboundRoute({
      owningTeamId: teamId,
      config: { forwardingTarget: 'inbound@acme.com', provider: 'resend' },
    })
    const sending = await createSendingAddress({
      owningTeamId: teamId,
      address: 'support@acme.com',
      module: 'support',
    })

    // Match a sending address (case-insensitive, display name stripped by caller).
    const bySending = await resolveChannelAccountByRecipient(['Support@Acme.com', 'other@x.com'])
    expect(bySending?.id).toBe(sending.id)

    // Match the inbound route's forwarding target.
    const byInbound = await resolveChannelAccountByRecipient(['inbound@acme.com'])
    expect(byInbound?.role).toBe('inbound')

    // No match, and empty input.
    expect(await resolveChannelAccountByRecipient(['nobody@x.com'])).toBeNull()
    expect(await resolveChannelAccountByRecipient([])).toBeNull()
  })

  it('soft-delete hides an account from the resolver + list', async () => {
    const teamId = await seedTeam()
    const route = await createInboundRoute({ owningTeamId: teamId, config: {} })
    expect(await listChannelAccounts(teamId)).toHaveLength(1)

    await softDeleteChannelAccount(route.id)
    expect(await getInboundRoute(teamId)).toBeNull()
    expect(await listChannelAccounts(teamId)).toHaveLength(0)

    // ...and the partial-unique frees up, so a fresh inbound route can be created.
    await expect(createInboundRoute({ owningTeamId: teamId, config: {} })).resolves.toBeDefined()
  })

  /**
   * The opt-in half of the design, arriving AFTER the default half already did.
   *
   * A workspace has one front door and the partial unique index says so, and by
   * the time somebody configures forwarding the platform default has materialised
   * on the first message. An insert there is a unique violation, which on this
   * path is a person clicking a button and getting an error for doing the exact
   * thing the product tells them to do.
   */
  it('adds a forwarding address to the route the platform default already created', async () => {
    const platform = await withWorkspace(WORKSPACE, () =>
      ensurePlatformInboundRoute([PLATFORM_ADDRESS])
    )
    expect(platform).not.toBeNull()
    if (!platform) return
    // The default route names NO address, and that is the design rather than an
    // omission. `address` is the column the sending-address index is built over
    // and the column the outbound From reads first, so a value here would put
    // the workspace's one front door under a second unique constraint and
    // shadow the customer's own verified address on the way out. The platform
    // address is derived on both paths instead, so it cannot go stale and
    // cannot outrank configuration.
    expect(platform.address).toBeNull()
    expect(platform.config.forwardingTarget).toBeUndefined()

    const updated = await setInboundForwardingTarget({
      owningTeamId: platform.owningTeamId,
      forwardingTarget: 'support@acme.com',
    })

    // The same row, widened. Forwarding narrows nothing: the address the
    // workspace already answered on is still there, so a customer who publishes
    // it does not find it stops working the day they set forwarding up.
    expect(updated.id).toBe(platform.id)
    expect(updated.address).toBeNull()
    expect(updated.config.forwardingTarget).toBe('support@acme.com')
    expect(await listChannelAccounts(platform.owningTeamId)).toHaveLength(1)

    // Both addresses still reach that one front door, by the two different
    // means they are each known through: the forwarding target is a stored
    // recipient, the platform address is derived from the workspace's slug.
    expect((await resolveChannelAccountByRecipient(['support@acme.com']))?.id).toBe(platform.id)
    const again = await withWorkspace(WORKSPACE, () =>
      ensurePlatformInboundRoute([PLATFORM_ADDRESS])
    )
    expect(again?.id).toBe(platform.id)
  })

  it('stores a forwarding target in the one spelling the resolver looks it up by', async () => {
    // A person types an address the way their own mail client shows it. The
    // resolver folds the recipients it is handed before the lookup, so a stored
    // value that was never folded is a front door that matches nothing.
    const teamId = await seedTeam()
    await setInboundForwardingTarget({
      owningTeamId: teamId,
      forwardingTarget: '  Support@Acme.COM ',
    })
    expect((await getInboundRoute(teamId))?.config.forwardingTarget).toBe('support@acme.com')
    expect((await resolveChannelAccountByRecipient(['support@acme.com']))?.owningTeamId).toBe(
      teamId
    )

    // ...and the same on the update branch, which is the one a workspace that
    // already has a front door takes.
    await setInboundForwardingTarget({ owningTeamId: teamId, forwardingTarget: 'Inbound@Acme.com' })
    expect((await getInboundRoute(teamId))?.config.forwardingTarget).toBe('inbound@acme.com')
    expect((await resolveChannelAccountByRecipient(['inbound@acme.com']))?.owningTeamId).toBe(
      teamId
    )
  })

  /**
   * The mirror of the inbound direction, and the same unique index either way.
   *
   * `channel_accounts_sending_address_uq` covers (team, channel, address) with no
   * module in it, so the second write of an address a workspace already holds is
   * a 23505. Unhandled, that reaches a person as a 500 from a settings button.
   */
  it('re-adding a sending address moves it rather than failing the request', async () => {
    const teamId = await seedTeam()
    const first = await createSendingAddress({
      owningTeamId: teamId,
      address: 'support@acme.com',
      module: 'support',
    })

    const moved = await createSendingAddress({
      owningTeamId: teamId,
      address: 'Support@Acme.com',
      module: 'feedback',
    })

    expect(moved.id).toBe(first.id)
    expect(moved.module).toBe('feedback')
    expect(await listChannelAccounts(teamId)).toHaveLength(1)
    expect(await getSendingAddress(teamId, 'support')).toBeNull()
  })

  /**
   * The other row the same unique index can collide with, and the one an upsert
   * must not silently swallow.
   *
   * `channel_accounts_sending_address_uq` spans ROLES: `address` is a column an
   * inbound route may carry too, because a person can point a front door at an
   * address by hand. Left to a plain upsert, adding that address as a From
   * identity would find the inbound row, rewrite its module and config, and hand
   * back a row whose role is still `inbound` — the workspace's one front door
   * quietly repurposed by a settings button, and its mail stops arriving.
   *
   * So the update is confined to `sending` rows, no row comes back from the
   * branch that would have rewritten the route, and the person who typed the
   * address is told rather than obeyed.
   */
  it('refuses to rewrite a hand-configured inbound route into a sending identity', async () => {
    const teamId = await seedTeam()
    // Written directly, because this is the shape no API of ours produces: an
    // inbound route carrying an address in the column rather than in its config.
    const [route] = await testDb
      .insert(channelAccounts)
      .values({
        owningTeamId: teamId,
        role: 'inbound',
        address: 'support@acme.com',
        config: { forwardingTarget: 'support@acme.com', provider: 'resend' },
      })
      .returning()

    await expect(
      createSendingAddress({
        owningTeamId: teamId,
        // The spelling a person's mail client shows them; folded on the way in,
        // so it collides with the stored one rather than inserting beside it.
        address: 'Support@Acme.com',
        module: 'support',
      })
    ).rejects.toBeInstanceOf(ChannelAddressInUseError)

    // Not one column of the front door rewritten, and no second row: the refusal
    // is what the route's survival rests on, not a later repair.
    expect(await listChannelAccounts(teamId)).toEqual([route])
    expect((await getInboundRoute(teamId))?.id).toBe(route.id)
    expect(await getSendingAddress(teamId, 'support')).toBeNull()
  })

  it('adds the workspace platform address as a sending address beside the default route', async () => {
    // The address the settings page advertises, added by the person reading it.
    // The outbound guard grants exactly this one (the workspace's label on the
    // minting domain), so a workspace refused it here would be refused the one
    // address it is certain to be entitled to.
    const platform = await withWorkspace(WORKSPACE, () =>
      ensurePlatformInboundRoute([PLATFORM_ADDRESS])
    )
    expect(platform).not.toBeNull()
    if (!platform) return

    const sending = await createSendingAddress({
      owningTeamId: platform.owningTeamId,
      address: PLATFORM_ADDRESS,
      module: 'support',
    })
    expect(sending.role).toBe('sending')
    expect(sending.id).not.toBe(platform.id)
    expect((await getSendingAddress(platform.owningTeamId, 'support'))?.address).toBe(
      PLATFORM_ADDRESS
    )
  })

  it('resolveSendingAddress: assigned team, default-team fallback, then null', async () => {
    const teamId = await seedTeam()
    await createSendingAddress({
      owningTeamId: teamId,
      address: 'team@acme.com',
      module: 'support',
    })
    // The conversation's assigned team's sending address wins.
    expect(await resolveSendingAddress(teamId)).toBe('team@acme.com')

    // With no assigned team, fall back to THE default team's sending address.
    // (One default team is a workspace invariant, so set the address on the
    // existing one rather than minting a second.)
    const [defaultTeam] = await testDb
      .select({ id: teams.id })
      .from(teams)
      .where(eq(teams.isDefault, true))
      .limit(1)
    if (defaultTeam) {
      await createSendingAddress({
        owningTeamId: defaultTeam.id as TeamId,
        address: 'default@acme.com',
        module: 'support',
      })
      expect(await resolveSendingAddress(null)).toBe('default@acme.com')
    }

    // A team with no sending address resolves null (caller uses EMAIL_FROM).
    const bare = await seedTeam()
    expect(await resolveSendingAddress(bare)).toBeNull()
  })
})
