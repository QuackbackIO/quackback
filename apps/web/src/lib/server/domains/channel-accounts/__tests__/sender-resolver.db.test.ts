/**
 * Which From a customer email leaves with, and the name it goes under, against
 * a real database.
 *
 * One resolver chooses it for every email, in one order: the thread's stored
 * sender, then (support set to the inbox) the address the customer wrote to,
 * then the surface's chosen address, then the workspace default, then the
 * platform. Every step only ever yields an address the send guard permits.
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
import { setEmailSender, getEmailSenders } from '../email-senders'
import { removeSendingAddress } from '../sending-address'
import {
  resolveConversationFrom,
  resolveConversationSender,
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

/** A sending address on the default team, as the settings page adds one. */
async function seedAddress(address: string, senderName: string | null = null) {
  const row = await createSendingAddress({ owningTeamId: await defaultTeam(), address, senderName })
  return row.id
}

async function seedConversation(input: {
  assignedTeamId?: TeamId | null
  channelAccountId?: ChannelAccountId
}): Promise<ConversationId> {
  const [conv] = await testDb
    .insert(conversations)
    .values({
      channel: input.channelAccountId ? ('email' as const) : ('messenger' as const),
      channelAccountId: input.channelAccountId ?? null,
      assignedTeamId: input.assignedTeamId ?? null,
      visitorPrincipalId: await seedVisitor(),
    })
    .returning()
  return conv.id as ConversationId
}

/** A forwarded support inbox, which also sets support to reply from it. */
async function seedForwardedInbox(forwardingTarget: string): Promise<ChannelAccountId> {
  const route = await createInboundRoute({
    owningTeamId: await defaultTeam(),
    config: { forwardingTarget, provider: 'cloudflare' },
  })
  return route.id
}

async function demote(domain: string): Promise<void> {
  await testDb
    .update(emailSendingDomains)
    .set({ status: 'failed' })
    .where(eq(emailSendingDomains.domain, domain))
}

const SURFACES = ['support', 'feedback', 'changelog', 'status'] as const

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

  describe('the workspace default', () => {
    it('sends every kind of email from the default when nothing overrides it', async () => {
      await seedVerifiedDomain(await defaultTeam(), 'acme.example')
      await seedAddress('hello@acme.example', 'Acme Team')

      for (const surface of SURFACES) {
        expect(await resolveSender({ surface })).toEqual({
          from: 'hello@acme.example',
          source: 'default',
          senderName: 'Acme Team',
        })
      }
    })

    it('makes the first address added the default, and not a second one', async () => {
      await seedVerifiedDomain(await defaultTeam(), 'acme.example')
      const first = await seedAddress('hello@acme.example')
      await seedAddress('news@acme.example')

      const senders = await getEmailSenders()
      expect(senders.get('default')?.account?.id).toBe(first)
      expect(await resolveSendingAddress(null, 'changelog')).toBe('hello@acme.example')
    })

    it('sends from the platform when no default is chosen', async () => {
      await seedVerifiedDomain(await defaultTeam(), 'acme.example')
      await seedAddress('hello@acme.example')
      await setEmailSender('default', null)

      for (const surface of SURFACES) expect(await resolveSender({ surface })).toBeNull()
    })

    it('names the address after the workspace when it has no sender name', async () => {
      await seedVerifiedDomain(await defaultTeam(), 'acme.example')
      await seedAddress('hello@acme.example')
      expect((await resolveSender({ surface: 'feedback' }))?.senderName).toBeNull()
    })
  })

  describe('a surface override', () => {
    it('sends that surface from its address and leaves the others on the default', async () => {
      await seedVerifiedDomain(await defaultTeam(), 'acme.example')
      await seedAddress('hello@acme.example')
      const news = await seedAddress('news@acme.example', 'Acme Updates')
      await setEmailSender('changelog', { mode: 'address', channelAccountId: news })

      expect(await resolveSender({ surface: 'changelog' })).toEqual({
        from: 'news@acme.example',
        source: 'surface',
        senderName: 'Acme Updates',
      })
      expect((await resolveSender({ surface: 'status' }))?.from).toBe('hello@acme.example')
      expect((await resolveSender({ surface: 'feedback' }))?.source).toBe('default')
    })

    it('falls back to the default once its domain is demoted', async () => {
      const home = await defaultTeam()
      await seedVerifiedDomain(home, 'acme.example')
      await seedVerifiedDomain(home, 'status.example')
      await seedAddress('hello@acme.example')
      const status = await seedAddress('alerts@status.example')
      await setEmailSender('status', { mode: 'address', channelAccountId: status })
      expect((await resolveSender({ surface: 'status' }))?.from).toBe('alerts@status.example')

      await demote('status.example')
      expect(await resolveSender({ surface: 'status' })).toEqual({
        from: 'hello@acme.example',
        source: 'default',
        senderName: null,
      })
    })

    it('falls back to the platform when the default is demoted too', async () => {
      await seedVerifiedDomain(await defaultTeam(), 'acme.example')
      const hello = await seedAddress('hello@acme.example')
      await setEmailSender('feedback', { mode: 'address', channelAccountId: hello })
      await demote('acme.example')
      expect(await resolveSender({ surface: 'feedback' })).toBeNull()
    })

    it('never sends from an address on a pending domain', async () => {
      const home = await defaultTeam()
      await seedVerifiedDomain(home, 'acme.example')
      await seedAddress('hello@acme.example')
      await createSendingDomain({ owningTeamId: home, domain: 'pending.example' })
      const pending = await seedAddress('help@pending.example')
      await setEmailSender('support', { mode: 'address', channelAccountId: pending })

      expect((await resolveSender({ surface: 'support' }))?.from).toBe('hello@acme.example')
    })

    it('ignores the team: an address chosen for support answers every team', async () => {
      await seedVerifiedDomain(await defaultTeam(), 'acme.example')
      await seedAddress('hello@acme.example')
      const second = await seedTeam()
      expect(await resolveSendingAddress(second)).toBe('hello@acme.example')
      const conv = await seedConversation({ assignedTeamId: second })
      expect(await resolveConversationFrom(conv)).toBe('hello@acme.example')
    })

    it('stops sending from an address once it is removed', async () => {
      await seedVerifiedDomain(await defaultTeam(), 'acme.example')
      await seedAddress('hello@acme.example')
      const news = await seedAddress('news@acme.example')
      await setEmailSender('changelog', { mode: 'address', channelAccountId: news })
      await removeSendingAddress(news)

      expect((await getEmailSenders()).has('changelog')).toBe(false)
      expect((await resolveSender({ surface: 'changelog' }))?.from).toBe('hello@acme.example')
    })
  })

  describe('support and the address the customer wrote to', () => {
    it('chooses the inbox for support when an inbound route is created', async () => {
      await seedForwardedInbox('support@acme.example')
      expect((await getEmailSenders()).get('support')).toEqual({ mode: 'inbox', account: null })
    })

    it('keeps a support choice made before the route was created', async () => {
      await seedVerifiedDomain(await defaultTeam(), 'acme.example')
      const hello = await seedAddress('hello@acme.example')
      await setEmailSender('support', { mode: 'address', channelAccountId: hello })
      await seedForwardedInbox('support@acme.example')
      expect((await getEmailSenders()).get('support')?.mode).toBe('address')
    })

    it('replies from the forwarded address once its domain is verified', async () => {
      const home = await defaultTeam()
      await seedVerifiedDomain(home, 'acme.example')
      await seedAddress('hello@acme.example')
      const route = await seedForwardedInbox('support@acme.example')
      const conv = await seedConversation({ channelAccountId: route })

      expect(await resolveSender({ surface: 'support', conversationId: conv })).toEqual({
        from: 'support@acme.example',
        source: 'inbox',
        senderName: null,
      })
    })

    it('names an inbox reply after the sending address of the same name', async () => {
      await seedVerifiedDomain(await defaultTeam(), 'acme.example')
      await seedAddress('support@acme.example', 'Acme Support')
      const route = await seedForwardedInbox('support@acme.example')
      const conv = await seedConversation({ channelAccountId: route })
      expect((await resolveSender({ conversationId: conv }))?.senderName).toBe('Acme Support')
    })

    it('replies from the default while the forwarded address is unverified', async () => {
      await seedVerifiedDomain(await defaultTeam(), 'acme.example')
      await seedAddress('hello@acme.example')
      const route = await seedForwardedInbox('support@unproved.example')
      const conv = await seedConversation({ channelAccountId: route })

      expect(await resolveSender({ surface: 'support', conversationId: conv })).toEqual({
        from: 'hello@acme.example',
        source: 'default',
        senderName: null,
      })
    })

    it('replies to a widget conversation from the default in inbox mode', async () => {
      await seedVerifiedDomain(await defaultTeam(), 'acme.example')
      await seedAddress('hello@acme.example')
      await seedForwardedInbox('support@acme.example')
      const conv = await seedConversation({})
      expect((await resolveSender({ conversationId: conv }))?.source).toBe('default')
    })

    it('skips the inbox when support is set to the default', async () => {
      await seedVerifiedDomain(await defaultTeam(), 'acme.example')
      await seedAddress('hello@acme.example')
      const route = await seedForwardedInbox('support@acme.example')
      await setEmailSender('support', null)
      const conv = await seedConversation({ channelAccountId: route })

      expect((await resolveSender({ conversationId: conv }))?.from).toBe('hello@acme.example')
    })

    it('skips the inbox when support is set to an address', async () => {
      await seedVerifiedDomain(await defaultTeam(), 'acme.example')
      await seedAddress('hello@acme.example')
      const help = await seedAddress('help@acme.example')
      const route = await seedForwardedInbox('support@acme.example')
      await setEmailSender('support', { mode: 'address', channelAccountId: help })
      const conv = await seedConversation({ channelAccountId: route })

      expect(await resolveSender({ conversationId: conv })).toEqual({
        from: 'help@acme.example',
        source: 'surface',
        senderName: null,
      })
    })

    it('does not reply from the inbox for anything but support', async () => {
      await seedVerifiedDomain(await defaultTeam(), 'acme.example')
      await seedAddress('hello@acme.example')
      const route = await seedForwardedInbox('support@acme.example')
      const conv = await seedConversation({ channelAccountId: route })
      expect((await resolveSender({ surface: 'feedback', conversationId: conv }))?.from).toBe(
        'hello@acme.example'
      )
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
      await seedVerifiedDomain(await defaultTeam(), 'acme.example')
      await seedAddress('hello@acme.example')
      const conv = await seedConversation({})

      expect(await storedSender(conv)).toBeNull()
      expect(await resolveConversationFrom(conv)).toBe('hello@acme.example')
      expect(await storedSender(conv)).toBe('hello@acme.example')
    })

    it('keeps the From in every mode once support is pointed elsewhere', async () => {
      await seedVerifiedDomain(await defaultTeam(), 'acme.example')
      await seedAddress('hello@acme.example', 'Acme')
      const help = await seedAddress('help@acme.example')
      const route = await seedForwardedInbox('support@acme.example')
      const conv = await seedConversation({ channelAccountId: route })
      expect(await resolveConversationFrom(conv)).toBe('support@acme.example')

      for (const choice of [
        null,
        { mode: 'address' as const, channelAccountId: help },
        { mode: 'inbox' as const },
      ]) {
        await setEmailSender('support', choice)
        expect(await resolveConversationSender(conv)).toEqual({
          from: 'support@acme.example',
          source: 'thread',
          senderName: null,
        })
      }
    })

    it('names a thread reply after its stored address', async () => {
      await seedVerifiedDomain(await defaultTeam(), 'acme.example')
      await seedAddress('hello@acme.example', 'Acme Team')
      const conv = await seedConversation({})
      await resolveConversationFrom(conv)
      expect(await resolveConversationSender(conv)).toEqual({
        from: 'hello@acme.example',
        source: 'thread',
        senderName: 'Acme Team',
      })
    })

    it('falls through to the normal order once the stored domain is no longer verified', async () => {
      const home = await defaultTeam()
      await seedVerifiedDomain(home, 'acme.example')
      await seedAddress('hello@acme.example')
      const conv = await seedConversation({})
      expect(await resolveConversationFrom(conv)).toBe('hello@acme.example')

      await demote('acme.example')
      await seedVerifiedDomain(home, 'other.example')
      const other = await seedAddress('help@other.example')
      await setEmailSender('default', { mode: 'address', channelAccountId: other })

      expect(await resolveSender({ conversationId: conv })).toEqual({
        from: 'help@other.example',
        source: 'default',
        senderName: null,
      })
      // The thread's own sender is kept, so it comes back if the domain does.
      expect(await storedSender(conv)).toBe('hello@acme.example')
    })

    it('records nothing when the thread sends from the platform default', async () => {
      const conv = await seedConversation({})
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

    it("matches the linked conversation's replies, not the support choice", async () => {
      await seedVerifiedDomain(await defaultTeam(), 'acme.example')
      await seedAddress('hello@acme.example')
      const help = await seedAddress('help@acme.example')
      const conv = await seedConversation({})
      // The conversation has already been answered, so its thread has a sender.
      expect(await resolveConversationFrom(conv)).toBe('hello@acme.example')

      await setEmailSender('support', { mode: 'address', channelAccountId: help })
      const ticket = await seedTicket(conv)
      expect(await resolveTicketFrom(ticket, await seedTeam())).toBe('hello@acme.example')
    })

    it('sends as support when no conversation is linked', async () => {
      await seedVerifiedDomain(await defaultTeam(), 'acme.example')
      await seedAddress('hello@acme.example')
      const help = await seedAddress('help@acme.example')
      await setEmailSender('support', { mode: 'address', channelAccountId: help })

      const ticket = await seedTicket()
      expect(await resolveTicketFrom(ticket, await seedTeam())).toBe('help@acme.example')
    })
  })
})
