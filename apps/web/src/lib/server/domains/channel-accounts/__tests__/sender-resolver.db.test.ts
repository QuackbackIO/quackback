/**
 * Which From a customer email leaves with, against a real database.
 *
 * One resolver chooses it for every email, so these cases pin the three things
 * that choice has to be: it falls back from the assigned team to the default
 * team before giving up, it only ever picks an address the send guard permits,
 * and among several permitted rows it picks the same one every time (oldest
 * first, then by id) so a second address added later never takes over.
 *
 * Pooled tenancy is stubbed on so the guard is live: on a single-workspace
 * install it stands down and every row would be permitted.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import {
  createId,
  type ChannelAccountId,
  type ConversationId,
  type PrincipalId,
  type TeamId,
  type TicketId,
  type UserId,
} from '@quackback/ids'

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  and,
  eq,
  isNull,
  teams,
  channelAccounts,
  emailSendingDomains,
  conversations,
  principal,
  user,
  tickets,
  ticketStatuses,
  ticketConversations,
} from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import {
  createInboundRoute,
  createSendingAddress,
  createSendingDomain,
} from '../channel-account.service'
import {
  resolveConversationFrom,
  resolveSender,
  resolveSendingAddress,
  resolveTicketFrom,
} from '../sender-resolver'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: channelAccounts.id }).from(channelAccounts).limit(0)
    await db.select({ id: emailSendingDomains.id }).from(emailSendingDomains).limit(0)
    await db.select({ id: conversations.id }).from(conversations).limit(0)
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

/** The default team the SQL bundle seeds. Asserted, so a missing seed fails loudly. */
async function defaultTeam(): Promise<TeamId> {
  const [team] = await testDb
    .select({ id: teams.id })
    .from(teams)
    .where(and(eq(teams.isDefault, true), isNull(teams.deletedAt)))
    .limit(1)
  expect(team?.id, 'a workspace is seeded with one default team').toBeTruthy()
  return team.id
}

async function seedVisitor(): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: 'Visitor' })
  await testDb.insert(principal).values({
    id: principalId,
    userId,
    role: 'user',
    type: 'user',
    displayName: 'Visitor',
    createdAt: new Date(),
  })
  return principalId
}

/** A domain in the state a real verification leaves behind, written directly. */
async function seedVerifiedDomain(owningTeamId: TeamId, domain: string): Promise<void> {
  const now = new Date()
  await testDb.insert(emailSendingDomains).values({
    owningTeamId,
    domain,
    status: 'verified',
    verifiedAt: now,
    lastCheckedAt: now,
    dnsRecords: [
      {
        type: 'TXT',
        host: '_quackback',
        value: 'quackback-domain-verification=6f1c2a9e4b8d0f37',
        purpose: 'ownership',
      },
    ],
  })
}

/**
 * A sending address with an explicit creation time. Every row written inside
 * one test transaction would otherwise share `now()`, which would make "oldest
 * first" untestable.
 */
async function seedAddress(
  owningTeamId: TeamId,
  address: string,
  createdAt: Date
): Promise<ChannelAccountId> {
  const row = await createSendingAddress({ owningTeamId, address, module: 'support' })
  await testDb.update(channelAccounts).set({ createdAt }).where(eq(channelAccounts.id, row.id))
  return row.id
}

async function seedConversation(input: {
  assignedTeamId: TeamId | null
  channelAccountId?: ChannelAccountId
}): Promise<ConversationId> {
  const [conv] = await testDb
    .insert(conversations)
    .values({
      channel: input.channelAccountId ? ('email' as const) : ('messenger' as const),
      channelAccountId: input.channelAccountId ?? null,
      assignedTeamId: input.assignedTeamId,
      visitorPrincipalId: await seedVisitor(),
    })
    .returning()
  return conv.id as ConversationId
}

const EARLIER = new Date('2026-01-01T00:00:00Z')
const LATER = new Date('2026-06-01T00:00:00Z')

describe.skipIf(!fixture.available)('resolveSender (real DB, rolled back)', () => {
  beforeEach(async () => {
    await fixture.begin()
    vi.stubEnv('QUACKBACK_TENANCY', 'pooled')
    vi.stubEnv('EMAIL_FROM', 'Quackback <notifications@mail.platform.test>')
    vi.stubEnv('EMAIL_INBOUND_DOMAIN', 'mail.platform.test')
  })
  afterEach(async () => {
    vi.unstubAllEnvs()
    await fixture.rollback()
  })
  afterAll(fixture.close)

  describe('default-team fallback', () => {
    it("uses the default team's address for a second team that has none", async () => {
      const home = await defaultTeam()
      await seedVerifiedDomain(home, 'home.example')
      await seedAddress(home, 'help@home.example', EARLIER)
      const second = await seedTeam()

      expect(await resolveSendingAddress(second)).toBe('help@home.example')
      expect(await resolveSender({ module: 'support', teamId: second })).toEqual({
        from: 'help@home.example',
        source: 'default_team',
      })
    })

    it("answers a ticket or widget conversation on a second team from the default team's address", async () => {
      const home = await defaultTeam()
      await seedVerifiedDomain(home, 'home.example')
      await seedAddress(home, 'help@home.example', EARLIER)
      const conv = await seedConversation({ assignedTeamId: await seedTeam() })

      expect(await resolveConversationFrom(conv)).toBe('help@home.example')
    })

    it("prefers the default team's address over the platform inbox on an email thread", async () => {
      const home = await defaultTeam()
      await seedVerifiedDomain(home, 'home.example')
      await seedAddress(home, 'help@home.example', EARLIER)
      // The inbox names a domain this workspace never verified, so the thread
      // falls past it to the team steps.
      const route = await createInboundRoute({
        owningTeamId: home,
        config: { forwardingTarget: 'support@unproved.example', provider: 'cloudflare' },
      })
      const conv = await seedConversation({
        assignedTeamId: await seedTeam(),
        channelAccountId: route.id,
      })

      expect(await resolveSender({ module: 'support', conversationId: conv })).toEqual({
        from: 'help@home.example',
        source: 'default_team',
      })
    })

    it("prefers the assigned team's own address over the default team's", async () => {
      const home = await defaultTeam()
      await seedVerifiedDomain(home, 'home.example')
      await seedAddress(home, 'help@home.example', EARLIER)
      const second = await seedTeam()
      await seedAddress(second, 'billing@home.example', LATER)

      expect(await resolveSender({ module: 'support', teamId: second })).toEqual({
        from: 'billing@home.example',
        source: 'team',
      })
    })

    it('falls back to the platform default when neither team has a usable address', async () => {
      const second = await seedTeam()
      expect(await resolveSendingAddress(second)).toBeNull()
      expect(await resolveSender({ module: 'support', teamId: second })).toBeNull()
    })
  })

  describe('only permitted addresses are candidates', () => {
    it('never lets a newly added address on a pending domain replace a live one', async () => {
      const home = await defaultTeam()
      await seedVerifiedDomain(home, 'live.example')
      await seedAddress(home, 'help@live.example', EARLIER)
      await createSendingDomain({ owningTeamId: home, domain: 'pending.example' })
      await seedAddress(home, 'help@pending.example', LATER)

      expect(await resolveSendingAddress(home)).toBe('help@live.example')
    })

    it('skips an older row on an unverified domain and picks the next permitted row', async () => {
      const home = await defaultTeam()
      // The older row's domain is still pending (or was demoted): it must not
      // suppress the live address beside it.
      await createSendingDomain({ owningTeamId: home, domain: 'pending.example' })
      await seedAddress(home, 'help@pending.example', EARLIER)
      await seedVerifiedDomain(home, 'live.example')
      await seedAddress(home, 'help@live.example', LATER)

      expect(await resolveSendingAddress(home)).toBe('help@live.example')
    })

    it("falls through an assigned team whose only address is unverified to the default team's", async () => {
      const home = await defaultTeam()
      await seedVerifiedDomain(home, 'home.example')
      await seedAddress(home, 'help@home.example', EARLIER)
      const second = await seedTeam()
      await seedAddress(second, 'team@unproved.example', EARLIER)

      expect(await resolveSender({ module: 'support', teamId: second })).toEqual({
        from: 'help@home.example',
        source: 'default_team',
      })
    })
  })

  describe('a thread keeps its first sender', () => {
    async function storedSender(conv: ConversationId): Promise<string | null> {
      const [row] = await testDb
        .select({ address: conversations.threadSenderAddress })
        .from(conversations)
        .where(eq(conversations.id, conv))
      return row?.address ?? null
    }

    it('records the address the first email on a conversation goes out from', async () => {
      const home = await defaultTeam()
      await seedVerifiedDomain(home, 'home.example')
      await seedAddress(home, 'help@home.example', EARLIER)
      const conv = await seedConversation({ assignedTeamId: home })

      expect(await storedSender(conv)).toBeNull()
      expect(await resolveConversationFrom(conv)).toBe('help@home.example')
      expect(await storedSender(conv)).toBe('help@home.example')
    })

    it('keeps the From when the conversation is reassigned to a team with its own address', async () => {
      const home = await defaultTeam()
      await seedVerifiedDomain(home, 'home.example')
      await seedAddress(home, 'help@home.example', EARLIER)
      const billing = await seedTeam()
      await seedAddress(billing, 'billing@home.example', LATER)
      const conv = await seedConversation({ assignedTeamId: home })

      expect(await resolveConversationFrom(conv)).toBe('help@home.example')
      await testDb
        .update(conversations)
        .set({ assignedTeamId: billing })
        .where(eq(conversations.id, conv))

      expect(await resolveConversationFrom(conv)).toBe('help@home.example')
      expect(await resolveSender({ module: 'support', conversationId: conv })).toEqual({
        from: 'help@home.example',
        source: 'thread',
      })
      expect(await storedSender(conv)).toBe('help@home.example')
    })

    it('falls through to the normal order once the stored domain is no longer verified', async () => {
      const home = await defaultTeam()
      await seedVerifiedDomain(home, 'home.example')
      await seedAddress(home, 'help@home.example', EARLIER)
      const conv = await seedConversation({ assignedTeamId: home })
      expect(await resolveConversationFrom(conv)).toBe('help@home.example')

      // The domain is demoted, and the team gains an address on another domain
      // that is still live. The stored sender is no longer one the guard
      // permits, so it gives way rather than suppressing the send.
      await testDb
        .update(emailSendingDomains)
        .set({ status: 'failed' })
        .where(eq(emailSendingDomains.domain, 'home.example'))
      await seedVerifiedDomain(home, 'other.example')
      await seedAddress(home, 'help@other.example', LATER)

      expect(await resolveSender({ module: 'support', conversationId: conv })).toEqual({
        from: 'help@other.example',
        source: 'team',
      })
      // The thread's own sender is kept, so it comes back if the domain does.
      expect(await storedSender(conv)).toBe('help@home.example')
    })

    it('records nothing when the thread sends from the platform default', async () => {
      const conv = await seedConversation({ assignedTeamId: await seedTeam() })
      expect(await resolveConversationFrom(conv)).toBeNull()
      expect(await storedSender(conv)).toBeNull()
    })
  })

  describe("a ticket's From", () => {
    async function seedTicket(linked?: ConversationId): Promise<TicketId> {
      const [status] = await testDb
        .insert(ticketStatuses)
        .values({ name: `Open-${suffix()}`, slug: createId('ticket_status') })
        .returning()
      const [ticket] = await testDb
        .insert(tickets)
        .values({ title: 'Cannot sign in', statusId: status.id })
        .returning()
      if (linked) {
        await testDb
          .insert(ticketConversations)
          .values({ ticketId: ticket.id, conversationId: linked, ticketType: 'customer' })
      }
      return ticket.id
    }

    it("matches the linked conversation's replies, not the ticket team's address", async () => {
      const home = await defaultTeam()
      await seedVerifiedDomain(home, 'home.example')
      await seedAddress(home, 'help@home.example', EARLIER)
      const billing = await seedTeam()
      await seedAddress(billing, 'billing@home.example', LATER)
      const conv = await seedConversation({ assignedTeamId: home })
      // The conversation has already been answered, so its thread has a sender.
      expect(await resolveConversationFrom(conv)).toBe('help@home.example')

      const ticket = await seedTicket(conv)
      expect(await resolveTicketFrom(ticket, billing)).toBe('help@home.example')
    })

    it("uses the ticket team's address when no conversation is linked", async () => {
      const home = await defaultTeam()
      await seedVerifiedDomain(home, 'home.example')
      await seedAddress(home, 'help@home.example', EARLIER)
      const billing = await seedTeam()
      await seedAddress(billing, 'billing@home.example', LATER)

      const ticket = await seedTicket()
      expect(await resolveTicketFrom(ticket, billing)).toBe('billing@home.example')
    })
  })

  describe('a fixed, repeatable choice', () => {
    it('picks the oldest permitted row, whatever order the rows were written in', async () => {
      const home = await defaultTeam()
      await seedVerifiedDomain(home, 'home.example')
      // Written newest first, so a pick by physical order would get it wrong.
      await seedAddress(home, 'second@home.example', LATER)
      await seedAddress(home, 'first@home.example', EARLIER)

      const picks = new Set<string | null>()
      for (let i = 0; i < 5; i++) picks.add(await resolveSendingAddress(home))
      expect([...picks]).toEqual(['first@home.example'])
    })

    it('breaks a tie on creation time by id', async () => {
      const home = await defaultTeam()
      await seedVerifiedDomain(home, 'home.example')
      // Two ids in a known order, the larger written first, so a pick by
      // insertion order and a pick by id disagree.
      const [low, high] = [
        createId('channel_account') as ChannelAccountId,
        createId('channel_account') as ChannelAccountId,
      ].sort()
      for (const [id, address] of [
        [high, 'high@home.example'],
        [low, 'low@home.example'],
      ] as const) {
        await testDb.insert(channelAccounts).values({
          id,
          owningTeamId: home,
          role: 'sending',
          module: 'support',
          address,
          createdAt: EARLIER,
        })
      }

      const picks = new Set<string | null>()
      for (let i = 0; i < 5; i++) picks.add(await resolveSendingAddress(home))
      expect([...picks]).toEqual(['low@home.example'])
    })
  })
})
