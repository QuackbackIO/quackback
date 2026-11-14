/**
 * Every inbox notice follows each recipient's own scope, over real rows.
 *
 * One world per test: a Billing team, a Logistics team, and teammates of every
 * shape (a workspace-wide manager, scoped teammates on and off the item's
 * team, a scoped direct assignee, a removed teammate now on role `user`, a
 * service principal holding view_all through a leftover assignment) plus the
 * customer. Each builder is driven with a real event and the assertions are on
 * the resolved recipients. Only the support flag, stage labels and presence
 * are stubbed.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import type { ConversationId, PrincipalId, TeamId, TicketId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { conversations, ticketSubscriptions, eq } from '@/lib/server/db'
import { PERMISSIONS } from '@/lib/shared/permissions'
import {
  SCOPED_KEYS,
  seedConversation,
  seedPerson,
  seedTeam,
  seedTicket,
  type SeededPerson,
} from '@/lib/server/__tests__/scope-seed'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('@/lib/server/domains/settings/settings.support', () => ({
  isSupportTicketsEnabled: async () => true,
  isPortalSupportEnabled: async () => false,
}))
const sendEmail = vi.hoisted(() =>
  vi.fn<(options: Record<string, unknown>) => Promise<{ sent: boolean }>>()
)
vi.mock('@quackback/email', async (original) => ({
  ...(await original<typeof import('@quackback/email')>()),
  sendConversationMessageEmail: sendEmail,
}))
vi.mock('@/lib/server/realtime/presence', () => ({
  isAnyAgentOnline: async () => false,
  isPrincipalOnline: async () => false,
}))
vi.mock('@/lib/server/events/hook-context', () => ({
  buildHookContext: async () => ({
    workspaceName: 'W',
    portalBaseUrl: 'https://p',
    logoUrl: null,
  }),
}))
vi.mock('@/lib/server/domains/settings/settings.tickets', () => ({
  getStageLabels: async () => ({ received: 'Received', resolved: 'Resolved' }),
}))

import type { EventData } from '../types'
import type { HookContext } from '../hook-context'
import type { HookTarget } from '../hook-types'
import {
  getAssistantHandedOffTargets,
  getConversationAssignedTargets,
  getSlaEmailTargets,
  getTicketAssignedEmailTargets,
  getTicketAssignedTargets,
  getTicketNoteAddedTargets,
  getTicketRepliedTargets,
  getMessageCreatedTargets,
} from '../targets'
import { notifyVisitorMessage } from '@/lib/server/domains/conversation/conversation.notify'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: conversations.id }).from(conversations).limit(0)
  },
})

beforeEach(async () => {
  expect(fixture.available).toBe(true)
  await fixture.begin()
  sendEmail.mockReset().mockResolvedValue({ sent: true })
})
afterEach(fixture.rollback)
afterAll(fixture.close)

const context = {
  portalBaseUrl: 'https://p',
  workspaceName: 'W',
  logoUrl: null,
} as unknown as HookContext

interface World {
  billing: TeamId
  logistics: TeamId
  /** Legacy member: the Manager preset, view_all. */
  manager: SeededPerson
  /** Scoped, on Billing. */
  onTeam: SeededPerson
  /** Scoped, on Logistics. */
  elsewhere: SeededPerson
  /** Scoped, on no team: sees only what is assigned to them. */
  solo: SeededPerson
  /** On Billing, but a custom role with no inbox keys: sees nothing. */
  blind: SeededPerson
  /** Role user: a removed teammate, still on Billing and on old rows. */
  former: SeededPerson
  /** Not a teammate, yet holding view_all through a leftover assignment. */
  service: SeededPerson
  /** The teammate who acts (never notified). */
  actor: SeededPerson
  /** The customer. */
  requester: SeededPerson
}

async function seedWorld(): Promise<World> {
  const manager = await seedPerson('manager', 'member')
  const onTeam = await seedPerson('on-team', 'member', { keys: SCOPED_KEYS })
  const elsewhere = await seedPerson('elsewhere', 'member', { keys: SCOPED_KEYS })
  const solo = await seedPerson('solo', 'member', { keys: SCOPED_KEYS })
  const blind = await seedPerson('blind', 'member', { keys: [] })
  const former = await seedPerson('former', 'user')
  const service = await seedPerson('service', 'member', {
    type: 'service',
    keys: [PERMISSIONS.CONVERSATION_VIEW_ALL, PERMISSIONS.TICKET_VIEW_ALL],
  })
  const actor = await seedPerson('actor', 'admin')
  const requester = await seedPerson('requester', 'user')
  const billing = await seedTeam('Billing', [onTeam.id, blind.id, former.id])
  const logistics = await seedTeam('Logistics', [elsewhere.id])
  return {
    billing,
    logistics,
    manager,
    onTeam,
    elsewhere,
    solo,
    blind,
    former,
    service,
    actor,
    requester,
  }
}

const recipientsOf = (target: HookTarget | null) =>
  [...((target?.target as { principalIds: string[] } | undefined)?.principalIds ?? [])].sort()

const emailsOf = (targets: HookTarget[]) =>
  targets.map((t) => (t.target as { email: string }).email).sort()

const sorted = (...ids: string[]) => [...ids].sort()

/** Only the world's people: other committed rows in the database never count. */
const within = (w: World, ids: string[]) => {
  const mine = new Set<string>(
    [
      w.manager,
      w.onTeam,
      w.elsewhere,
      w.solo,
      w.blind,
      w.former,
      w.service,
      w.actor,
      w.requester,
    ].map((p) => p.id)
  )
  return ids.filter((id) => mine.has(id)).sort()
}

async function moveConversation(
  id: ConversationId,
  to: { assignee: PrincipalId | null; team: TeamId | null }
) {
  await testDb
    .update(conversations)
    .set({ assignedAgentPrincipalId: to.assignee, assignedTeamId: to.team })
    .where(eq(conversations.id, id))
}

function ticketRef(id: TicketId) {
  return { id, number: 1, type: 'customer', priority: 'none', assignedTeamId: null }
}

// ============================================================================
// Ticket watchers
// ============================================================================

describe('ticket watchers hear only about tickets in their scope', () => {
  async function watchedTicket(w: World) {
    const ticket = await seedTicket({ requester: w.requester.id, team: w.billing })
    const id = ticket.id as TicketId
    await testDb.insert(ticketSubscriptions).values(
      [w.requester, w.manager, w.onTeam, w.elsewhere, w.solo, w.former].map((p) => ({
        ticketId: id,
        principalId: p.id,
        reason: p === w.requester ? 'requester' : 'manual',
      }))
    )
    return id
  }

  it('reply bell: in-scope watchers and the requester', async () => {
    const w = await seedWorld()
    const id = await watchedTicket(w)
    const target = await getTicketRepliedTargets({
      id: 'evt-r',
      type: 'ticket.replied',
      timestamp: '2026-01-01T00:00:00Z',
      actor: { type: 'user', principalId: w.actor.id },
      data: {
        ticket: ticketRef(id),
        messageId: 'conversation_message_1',
        content: 'Fix is queued.',
        attachments: null,
        senderType: 'agent',
        title: 'Cannot log in',
        authorName: 'Sarah',
        requesterPrincipalId: w.requester.id,
      },
    } as EventData)
    expect(recipientsOf(target)).toEqual(sorted(w.manager.id, w.onTeam.id, w.requester.id))
  })

  it('note bell: in-scope agent watchers only', async () => {
    const w = await seedWorld()
    const id = await watchedTicket(w)
    const target = await getTicketNoteAddedTargets({
      id: 'evt-n',
      type: 'ticket.note_added',
      timestamp: '2026-01-01T00:00:00Z',
      actor: { type: 'user', principalId: w.actor.id },
      data: { ticket: ticketRef(id), content: 'Internal', title: 'Cannot log in', authorName: 'S' },
    } as unknown as EventData)
    expect(recipientsOf(target)).toEqual(sorted(w.manager.id, w.onTeam.id))
  })

  it('a watcher hears again once the ticket comes back to their scope', async () => {
    const w = await seedWorld()
    const id = await watchedTicket(w)
    const { tickets } = await import('@/lib/server/db')
    await testDb.update(tickets).set({ assigneeTeamId: w.logistics }).where(eq(tickets.id, id))
    const target = await getTicketNoteAddedTargets({
      id: 'evt-n2',
      type: 'ticket.note_added',
      timestamp: '2026-01-01T00:00:00Z',
      actor: { type: 'user', principalId: w.actor.id },
      data: { ticket: ticketRef(id), content: 'Internal', title: 'Cannot log in', authorName: 'S' },
    } as unknown as EventData)
    expect(recipientsOf(target)).toEqual(sorted(w.manager.id, w.elsewhere.id))
  })
})

// ============================================================================
// Assignment bells and emails
// ============================================================================

function conversationAssigned(
  w: World,
  conversationId: ConversationId,
  to: { assignee: PrincipalId | null; team: TeamId | null }
): EventData {
  return {
    id: 'evt-ca',
    type: 'conversation.assigned',
    timestamp: '2026-01-01T00:00:00Z',
    actor: { type: 'user', principalId: w.actor.id },
    data: {
      conversation: { id: conversationId },
      assignedAgentPrincipalId: to.assignee,
      previousAgentPrincipalId: null,
      assignedTeamId: to.team,
      previousTeamId: null,
    },
  } as unknown as EventData
}

function ticketAssigned(
  w: World,
  ticketId: TicketId,
  to: { assignee: PrincipalId | null; team: TeamId | null }
): EventData {
  return {
    id: 'evt-ta',
    type: 'ticket.assigned',
    timestamp: '2026-01-01T00:00:00Z',
    actor: { type: 'user', principalId: w.actor.id },
    data: {
      ticket: ticketRef(ticketId),
      assignedPrincipalId: to.assignee,
      previousPrincipalId: null,
      assignedTeamId: to.team,
      previousTeamId: null,
    },
  } as unknown as EventData
}

describe('conversation assigned bell', () => {
  it('reaches the scoped assignee and the team members whose scope holds it', async () => {
    const w = await seedWorld()
    const to = { assignee: w.solo.id, team: w.billing }
    const { conversation } = await seedConversation(to)
    const target = await getConversationAssignedTargets(
      conversationAssigned(w, conversation.id as ConversationId, to)
    )
    expect(recipientsOf(target)).toEqual(sorted(w.solo.id, w.onTeam.id))
  })

  it('never bells a removed teammate who is still the direct assignee', async () => {
    const w = await seedWorld()
    const to = { assignee: w.former.id, team: null }
    const { conversation } = await seedConversation(to)
    const target = await getConversationAssignedTargets(
      conversationAssigned(w, conversation.id as ConversationId, to)
    )
    expect(recipientsOf(target)).toEqual([])
  })

  it('reads where the conversation is now, not where the event said it went', async () => {
    const w = await seedWorld()
    const to = { assignee: w.solo.id, team: null }
    const { conversation } = await seedConversation(to)
    await moveConversation(conversation.id as ConversationId, { assignee: null, team: w.logistics })
    const target = await getConversationAssignedTargets(
      conversationAssigned(w, conversation.id as ConversationId, to)
    )
    expect(recipientsOf(target)).toEqual([])
  })
})

describe('ticket assigned bell and email', () => {
  it('bell: the scoped assignee and the in-scope members of the new team', async () => {
    const w = await seedWorld()
    const to = { assignee: w.solo.id, team: w.billing }
    const ticket = await seedTicket({ requester: w.requester.id, ...to })
    const target = await getTicketAssignedTargets(ticketAssigned(w, ticket.id as TicketId, to))
    expect(recipientsOf(target)).toEqual(sorted(w.solo.id, w.onTeam.id))
  })

  it('bell: never a removed teammate who is still the direct assignee', async () => {
    const w = await seedWorld()
    const to = { assignee: w.former.id, team: null }
    const ticket = await seedTicket({ requester: w.requester.id, ...to })
    const target = await getTicketAssignedTargets(ticketAssigned(w, ticket.id as TicketId, to))
    expect(recipientsOf(target)).toEqual([])
  })

  it('email: the same people as the bell', async () => {
    const w = await seedWorld()
    const to = { assignee: w.former.id, team: w.billing }
    const ticket = await seedTicket({ requester: w.requester.id, ...to })
    const targets = await getTicketAssignedEmailTargets(
      ticketAssigned(w, ticket.id as TicketId, to),
      context
    )
    expect(emailsOf(targets)).toEqual([w.onTeam.email])
  })
})

describe('assistant hand-off bell', () => {
  function handedOff(conversationId: ConversationId, actor: PrincipalId): EventData {
    return {
      id: 'evt-h',
      type: 'assistant.handed_off',
      timestamp: '2026-01-01T00:00:00Z',
      actor: { type: 'service', principalId: actor },
      data: { conversationId, reason: 'asked_for_human' },
    } as unknown as EventData
  }

  it('with a team: the members whose scope holds it', async () => {
    const w = await seedWorld()
    const { conversation } = await seedConversation({ team: w.billing })
    const target = await getAssistantHandedOffTargets(
      handedOff(conversation.id as ConversationId, w.service.id)
    )
    expect(recipientsOf(target)).toEqual([w.onTeam.id])
  })

  it('without a team: only the teammates who see every conversation', async () => {
    const w = await seedWorld()
    const { conversation } = await seedConversation({})
    const target = await getAssistantHandedOffTargets(
      handedOff(conversation.id as ConversationId, w.service.id)
    )
    expect(within(w, recipientsOf(target))).toEqual(sorted(w.manager.id, w.actor.id))
  })
})

// ============================================================================
// SLA emails
// ============================================================================

describe('SLA email', () => {
  function sla(conversationId: ConversationId): EventData {
    return {
      id: 'evt-sla',
      type: 'sla.breached',
      timestamp: '2026-01-01T00:00:00Z',
      actor: { type: 'service' },
      data: { conversationId, clock: 'first_response', dueAt: '2026-01-01T00:00:00Z' },
    } as unknown as EventData
  }

  it('mails a scoped direct assignee', async () => {
    const w = await seedWorld()
    const { conversation } = await seedConversation({ assignee: w.solo.id })
    const targets = await getSlaEmailTargets(sla(conversation.id as ConversationId), context)
    expect(emailsOf(targets)).toEqual([w.solo.email])
  })

  it('never mails a removed teammate who is still the direct assignee', async () => {
    const w = await seedWorld()
    const { conversation } = await seedConversation({ assignee: w.former.id })
    const targets = await getSlaEmailTargets(sla(conversation.id as ConversationId), context)
    expect(emailsOf(targets)).toEqual([])
  })

  it('mails the team members whose scope holds it', async () => {
    const w = await seedWorld()
    const { conversation } = await seedConversation({ team: w.billing })
    const targets = await getSlaEmailTargets(sla(conversation.id as ConversationId), context)
    expect(emailsOf(targets)).toEqual([w.onTeam.email])
  })
})

// ============================================================================
// New visitor message: the bell and the offline email
// ============================================================================

describe('new-message bell and email', () => {
  function messageCreated(
    conversationId: ConversationId,
    snapshot: { assignee: PrincipalId | null; team: TeamId | null },
    isFirstMessage = false
  ): EventData {
    return {
      id: 'evt-m',
      type: 'message.created',
      timestamp: '2026-01-01T00:00:00Z',
      actor: { type: 'user' },
      data: {
        message: {
          id: 'conversation_message_1',
          conversationId,
          senderType: 'visitor',
          content: 'Hello',
          authorName: 'Visitor',
        },
        conversation: {
          id: conversationId,
          assignedAgentPrincipalId: snapshot.assignee,
          assignedTeamId: snapshot.team,
        },
        isFirstMessage,
      },
    } as unknown as EventData
  }

  async function emailedFor(conversation: typeof conversations.$inferSelect, first: boolean) {
    await notifyVisitorMessage({
      conversation,
      content: 'Hello',
      authorName: 'Visitor',
      isFirstMessage: first,
    })
    return sendEmail.mock.calls.map(([options]) => options.to as string).sort()
  }

  it('bell: only the teammates whose scope holds the conversation', async () => {
    const w = await seedWorld()
    const to = { assignee: null, team: w.billing }
    const { conversation } = await seedConversation(to)
    const target = await getMessageCreatedTargets(
      messageCreated(conversation.id as ConversationId, to)
    )
    expect(within(w, recipientsOf(target))).toEqual(sorted(w.manager.id, w.actor.id, w.onTeam.id))
  })

  it('bell: an unassigned conversation reaches only teammates who see every conversation', async () => {
    const w = await seedWorld()
    const to = { assignee: null, team: null }
    const { conversation } = await seedConversation(to)
    const target = await getMessageCreatedTargets(
      messageCreated(conversation.id as ConversationId, to, true)
    )
    expect(within(w, recipientsOf(target))).toEqual(sorted(w.manager.id, w.actor.id))
  })

  it('first-message bell: a teammate routing just assigned hears, though the event predates routing', async () => {
    const w = await seedWorld()
    const { conversation } = await seedConversation({})
    await moveConversation(conversation.id as ConversationId, { assignee: w.solo.id, team: null })
    const target = await getMessageCreatedTargets(
      messageCreated(conversation.id as ConversationId, { assignee: null, team: null }, true)
    )
    expect(within(w, recipientsOf(target))).toEqual(sorted(w.manager.id, w.actor.id, w.solo.id))
  })

  it('bell: a teammate the conversation has since moved away from does not hear', async () => {
    const w = await seedWorld()
    const { conversation } = await seedConversation({ assignee: w.solo.id })
    await moveConversation(conversation.id as ConversationId, { assignee: null, team: w.logistics })
    const target = await getMessageCreatedTargets(
      messageCreated(conversation.id as ConversationId, { assignee: w.solo.id, team: null })
    )
    expect(within(w, recipientsOf(target))).toEqual(
      sorted(w.manager.id, w.actor.id, w.elsewhere.id)
    )
  })

  it('email: only the teammates whose scope holds the conversation', async () => {
    const w = await seedWorld()
    const { conversation } = await seedConversation({ team: w.billing })
    const emailed = await emailedFor(conversation, true)
    const mine = [w.manager, w.actor, w.onTeam, w.elsewhere, w.solo, w.blind, w.former]
    expect(emailed.filter((e) => mine.some((p) => p.email === e))).toEqual(
      [w.manager.email, w.actor.email, w.onTeam.email].sort()
    )
  })

  it('first-message email: reads the row routing just wrote, not the snapshot it was handed', async () => {
    const w = await seedWorld()
    const { conversation } = await seedConversation({})
    await moveConversation(conversation.id as ConversationId, { assignee: w.solo.id, team: null })
    const emailed = await emailedFor(conversation, true)
    const mine = [w.manager, w.actor, w.onTeam, w.elsewhere, w.solo, w.blind, w.former]
    expect(emailed.filter((e) => mine.some((p) => p.email === e))).toEqual(
      [w.manager.email, w.actor.email, w.solo.email].sort()
    )
  })
})
