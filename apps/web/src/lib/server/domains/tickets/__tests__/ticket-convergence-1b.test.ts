/**
 * Real-DB coverage for convergence Phase 1b (scratchpad/convergence-design.md,
 * mechanics appendix "Intake (Phase 1b)" + the side-effect model's intake
 * table). Runs inside the db-test-fixture rollback transaction. Covers:
 *
 *  - THE INTAKE TRANSACTION: every flagged customer-intake create (the
 *    portal/widget funnel `createMyTicket`, and the API v1 / MCP shape via
 *    `createTicket` with `withBackingConversation`) creates the backing
 *    conversation (channel messenger / source ticket_form, open, visitor =
 *    requester) + ticket +
 *    `ticket_conversations` link in ONE transaction — a mid-transaction
 *    failure persists nothing — and the opening message lands
 *    conversation-parented via the Phase 1a redirect.
 *  - THE SIDE-EFFECT GATING TABLE: `conversation.created` FIRES (workflows +
 *    webhooks ride it) with the opening message already in place;
 *    notifyConversationStarted / auto-routing / Quinn stay SUPPRESSED — at
 *    intake AND on a follow-up visitor message, including the LEGACY
 *    widget-source pair shape (the Phase 1a flag: a redirected portal/widget
 *    requester reply must not summon Quinn).
 *  - THE UNCHANGED PATHS: no-requester creates (back-office, requester-less
 *    customer) and flag-less agent creates (admin dialog / convert_to_ticket
 *    shape) stay standalone — no conversation, no link.
 *  - SLA: an intake conversation is born SLA-free, so the shared handoff
 *    no-ops (no ticket TTR clock) while the link itself exists.
 *  - `ticket.created` now dispatches with the pair link already visible
 *    (the event-trigger.ts TICKET_CREATED_LINK_POLL race's proper fix).
 *
 * The two webhook bridges, realtime, and the notify layer are fully mocked
 * (spy bags — same pattern as ticket-convergence-1a.test.ts), so no event
 * pipeline, Redis, or email runs; the assistant orchestrator is a spy so the
 * Quinn gate is assertable at the dispatch site.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import {
  createId,
  type ConversationId,
  type PrincipalId,
  type TicketId,
  type TicketStatusId,
  type UserId,
} from '@quackback/ids'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

// config getters validate the full env (absent in tests); provide just what the
// attachment/avatar URL checks read (same stub the sibling suites use).
vi.mock('@/lib/server/config', () => ({
  config: { s3PublicUrl: undefined, baseUrl: 'http://localhost:3000' },
  getBaseUrl: () => 'http://localhost:3000',
}))

// Neutralize the Redis-backed realtime fan-out on BOTH channels.
const realtime = vi.hoisted(() => ({
  publishTicketEvent: vi.fn(),
  publishConversationEvent: vi.fn(),
  publishAgentConversationEvent: vi.fn(),
  publishConversationUpdate: vi.fn(),
  publishTyping: vi.fn(),
}))
vi.mock('@/lib/server/realtime/conversation-channels', () => realtime)

// The ticket-side event bridge (createTicketCore emits created).
const ticketEmit = vi.hoisted(() => ({
  emitTicketCreated: vi.fn().mockResolvedValue(undefined),
  emitTicketStatusChanged: vi.fn().mockResolvedValue(undefined),
  emitTicketAssigned: vi.fn().mockResolvedValue(undefined),
  emitTicketReplied: vi.fn().mockResolvedValue(undefined),
  emitTicketNoteAdded: vi.fn().mockResolvedValue(undefined),
  emitTicketExternalStatusChanged: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../ticket.webhooks', () => ticketEmit)

// The conversation-side event bridge: emitConversationCreated is the gating
// table's FIRE assertion point (conversation.created workflows + webhooks both
// ride it); emitMessageCreated is the redirect pipeline's assertion point.
const convEmit = vi.hoisted(() => ({
  emitConversationCreated: vi.fn().mockResolvedValue(undefined),
  emitMessageCreated: vi.fn().mockResolvedValue(undefined),
  emitMessageNoteCreated: vi.fn().mockResolvedValue(undefined),
  emitMessageDeleted: vi.fn().mockResolvedValue(undefined),
  emitConversationStatusChanged: vi.fn().mockResolvedValue(undefined),
  emitConversationAssigned: vi.fn().mockResolvedValue(undefined),
  emitConversationPriorityChanged: vi.fn().mockResolvedValue(undefined),
  emitConversationCsatSubmitted: vi.fn().mockResolvedValue(undefined),
  emitConversationCsatCommentAdded: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../conversation/conversation.webhooks', () => convEmit)

// The notify layer: notifyConversationStarted is the gating table's started-
// notify SUPPRESS assertion point.
const convNotify = vi.hoisted(() => ({
  notifyVisitorMessage: vi.fn().mockResolvedValue(undefined),
  notifyAgentReply: vi.fn().mockResolvedValue(undefined),
  notifyConversationStarted: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../conversation/conversation.notify', () => convNotify)

// The Quinn spy: the dispatch site's dynamic import resolves here, so a
// gated-out turn is simply "never called".
const assistant = vi.hoisted(() => ({
  runAssistantTurnForConversation: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/server/domains/assistant/assistant.orchestrator', () => assistant)

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  conversations,
  conversationMessages,
  principal,
  settings,
  ticketConversations,
  tickets,
  ticketStatuses,
  ticketSubscriptions,
  user,
  and,
  eq,
} from '@/lib/server/db'
import { ANONYMOUS_ACTOR, type Actor } from '@/lib/server/policy/types'
import { appendInboundTicketReply } from '../requester.service'
import { createTicket, createTicketCore } from '../ticket.service'
import { sendVisitorMessage } from '../../conversation/conversation.service'

/** The intake transaction shape (API v1 / MCP / agent-on-behalf): a customer
 *  ticket born with its backing conversation. Replaces the deleted
 *  customer-self-file wrapper as this suite's driver — the transaction under
 *  test is createTicketCore's, unchanged. */
function intakeCreate(
  requesterP: PrincipalId,
  input: { title: string; description?: string },
  actor?: Actor
) {
  return createTicketCore(
    {
      type: 'customer',
      title: input.title,
      description: input.description,
      requesterPrincipalId: requesterP,
      withBackingConversation: true,
    },
    actor ?? requesterActor(requesterP)
  )
}

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: ticketConversations.ticketId }).from(ticketConversations).limit(0)
    await db.select({ id: conversations.id }).from(conversations).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

async function seedPrincipal(opts: {
  role?: 'member' | 'admin' | 'user'
  type?: 'user' | 'anonymous' | 'service'
  contactEmail?: string
}): Promise<PrincipalId> {
  const type = opts.type ?? 'user'
  const userId = type === 'user' ? (createId('user') as UserId) : null
  const principalId = createId('principal') as PrincipalId
  if (userId) await testDb.insert(user).values({ id: userId, name: `U-${suffix()}` })
  await testDb.insert(principal).values({
    id: principalId,
    userId,
    role: opts.role ?? 'user',
    type,
    contactEmail: opts.contactEmail ?? null,
    createdAt: new Date(),
  })
  return principalId
}

/** The portal/widget requester: themselves, no team permissions. */
function requesterActor(principalId: PrincipalId): Actor {
  return { ...ANONYMOUS_ACTOR, principalId, principalType: 'user' }
}

/** The API v1 / MCP shape: a workspace-wide service actor with a team role.
 *  No `permissions` set — like the real serviceActorFromApiAuth, the role
 *  preset expands (manager grants ticket.create + conversation.reply). */
function serviceActor(principalId: PrincipalId): Actor {
  return { principalId, role: 'member', principalType: 'service', segmentIds: new Set() }
}

/** Seed the one default status every create resolves, plus the workspace
 *  settings row stage-label resolution reads (getStageLabels → requireSettings). */
async function seedDefaultStatus(): Promise<TicketStatusId> {
  await testDb
    .insert(settings)
    .values({ name: 'Test WS', slug: `test_${suffix()}`, createdAt: new Date() })
  await testDb
    .update(ticketStatuses)
    .set({ isDefault: false })
    .where(eq(ticketStatuses.isDefault, true))
  const received = createId('ticket_status') as TicketStatusId
  await testDb.insert(ticketStatuses).values({
    id: received,
    name: 'T-Received',
    slug: `t_received_${suffix()}`,
    category: 'open',
    publicStage: 'received',
    position: 100,
    isDefault: true,
  })
  return received
}

async function readPairLink(ticketId: TicketId) {
  const [link] = await testDb
    .select()
    .from(ticketConversations)
    .where(
      and(
        eq(ticketConversations.ticketId, ticketId),
        eq(ticketConversations.ticketType, 'customer')
      )
    )
    .limit(1)
  return link ?? null
}

async function readConversation(conversationId: ConversationId) {
  const [row] = await testDb
    .select()
    .from(conversations)
    .where(eq(conversations.id, conversationId))
  return row
}

async function readTicket(ticketId: TicketId) {
  const [row] = await testDb.select().from(tickets).where(eq(tickets.id, ticketId))
  return row
}

/**
 * Flush the dispatch site's fire-and-forget Quinn chain (one DB probe + one
 * dynamic import). For a "never called" assertion this pairs with a positive
 * control: once the control's chain has resolved (vi.waitFor), the gated
 * chain — started in the same window — has resolved too.
 */
async function flushAssistantChain() {
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r))
}

describe.skipIf(!fixture.available)('convergence Phase 1b (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  beforeEach(() => {
    vi.clearAllMocks()
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  describe('the intake transaction (createTicketCore withBackingConversation)', () => {
    it('creates conversation + ticket + link in one transaction, opening message conversation-parented', async () => {
      await seedDefaultStatus()
      const requesterP = await seedPrincipal({})

      const dto = await intakeCreate(requesterP, {
        title: 'Cannot export my data',
        description: 'The export button spins forever.',
      })

      // The pair: one link row, and the conversation is identity-consistent
      // by construction (visitor IS the requester).
      const link = await readPairLink(dto.id as TicketId)
      expect(link).not.toBeNull()
      const conversation = await readConversation(link!.conversationId)
      expect(conversation.visitorPrincipalId).toBe(requesterP)
      expect(conversation.channel).toBe('messenger')
      expect(conversation.source).toBe('ticket_form')
      expect(conversation.status).toBe('open')
      // Born waiting on the team; the requester's own read side is stamped.
      expect(conversation.waitingSince).not.toBeNull()
      expect(conversation.visitorLastReadAt).not.toBeNull()

      // The opening message rode the redirect: conversation-parented,
      // visitor-typed, authored by the requester, with the conversation
      // denorm moved by the full write pipeline.
      const messages = await testDb
        .select()
        .from(conversationMessages)
        .where(eq(conversationMessages.conversationId, conversation.id))
      expect(messages).toHaveLength(1)
      expect(messages[0].senderType).toBe('visitor')
      expect(messages[0].principalId).toBe(requesterP)
      expect(messages[0].content).toBe('The export button spins forever.')
      expect(messages[0].ticketId).toBeNull()
      expect(conversation.lastMessagePreview).toBe('The export button spins forever.')
      // Nothing landed on the legacy ticket parent.
      const ticketRows = await testDb
        .select()
        .from(conversationMessages)
        .where(eq(conversationMessages.ticketId, dto.id as TicketId))
      expect(ticketRows).toHaveLength(0)

      // The ticket side is untouched in shape: born-unassigned, requester set,
      // requester watcher row from birth, and the return DTO is the plain
      // requester DTO (the conversation is infrastructure).
      const ticket = await readTicket(dto.id as TicketId)
      expect(ticket.requesterPrincipalId).toBe(requesterP)
      expect(ticket.assigneePrincipalId).toBeNull()
      expect(dto.title).toBe('Cannot export my data')
      expect((dto as unknown as Record<string, unknown>).conversationId).toBeUndefined()
      const watchers = await testDb
        .select()
        .from(ticketSubscriptions)
        .where(eq(ticketSubscriptions.ticketId, dto.id as TicketId))
      expect(watchers.map((w) => w.principalId)).toContain(requesterP)
    })

    it('rolls the whole intake back when any insert fails (nothing persists)', async () => {
      await seedDefaultStatus()
      // A well-formed but nonexistent requester: the conversation insert's
      // visitor FK is the FIRST statement of the transaction, so its
      // violation must roll everything back.
      const bogusP = createId('principal') as PrincipalId

      await expect(intakeCreate(bogusP, { title: 'doomed', description: 'x' })).rejects.toThrow()

      expect(
        await testDb.select().from(tickets).where(eq(tickets.requesterPrincipalId, bogusP))
      ).toHaveLength(0)
      expect(
        await testDb
          .select()
          .from(conversations)
          .where(eq(conversations.visitorPrincipalId, bogusP))
      ).toHaveLength(0)
      expect(await testDb.select().from(ticketConversations)).toHaveLength(0)
      expect(await testDb.select().from(conversationMessages)).toHaveLength(0)
    })

    it('rolls back the conversation too when a LATER insert fails (bogus assignee)', async () => {
      await seedDefaultStatus()
      const requesterP = await seedPrincipal({})
      const bogusAssignee = createId('principal') as PrincipalId

      // The ticket insert's assignee FK fails AFTER the conversation insert —
      // the transaction must still persist nothing (createTicketCore directly,
      // so the flag + assignee combination is reachable).
      await expect(
        createTicketCore(
          {
            type: 'customer',
            title: 'doomed pair',
            description: 'x',
            requesterPrincipalId: requesterP,
            assigneePrincipalId: bogusAssignee,
            withBackingConversation: true,
          },
          requesterActor(requesterP)
        )
      ).rejects.toThrow()

      expect(
        await testDb.select().from(tickets).where(eq(tickets.requesterPrincipalId, requesterP))
      ).toHaveLength(0)
      expect(
        await testDb
          .select()
          .from(conversations)
          .where(eq(conversations.visitorPrincipalId, requesterP))
      ).toHaveLength(0)
      expect(await testDb.select().from(ticketConversations)).toHaveLength(0)
    })

    it('a title-only intake creates the pair with no opening message and the title as subject', async () => {
      await seedDefaultStatus()
      const requesterP = await seedPrincipal({})

      const dto = await intakeCreate(requesterP, { title: 'Billing question about invoice 42' })

      const link = await readPairLink(dto.id as TicketId)
      expect(link).not.toBeNull()
      const conversation = await readConversation(link!.conversationId)
      expect(conversation.subject).toBe('Billing question about invoice 42')
      // The pair starts with the ball in the team's court even without an
      // opening message.
      expect(conversation.waitingSince).not.toBeNull()
      expect(
        await testDb
          .select()
          .from(conversationMessages)
          .where(eq(conversationMessages.conversationId, conversation.id))
      ).toHaveLength(0)
      // conversation.created still fires — a message-less intake is still a
      // created conversation (native-flow parity is per-effect, not per-shape).
      expect(convEmit.emitConversationCreated).toHaveBeenCalledTimes(1)
    })

    it('an anonymous widget visitor with a captured email gets the same pair', async () => {
      await seedDefaultStatus()
      const anonP = await seedPrincipal({ type: 'anonymous', contactEmail: 'visitor@example.com' })

      const dto = await intakeCreate(
        anonP,
        { title: 'Widget intake', description: 'filed from the messenger' },
        { ...ANONYMOUS_ACTOR, principalId: anonP, principalType: 'anonymous' }
      )

      const link = await readPairLink(dto.id as TicketId)
      expect(link).not.toBeNull()
      const conversation = await readConversation(link!.conversationId)
      expect(conversation.visitorPrincipalId).toBe(anonP)
      const messages = await testDb
        .select()
        .from(conversationMessages)
        .where(eq(conversationMessages.conversationId, conversation.id))
      expect(messages).toHaveLength(1)
      expect(messages[0].senderType).toBe('visitor')
    })
  })

  describe('the side-effect gating table', () => {
    it('FIRES conversation.created (workflows + webhooks) with the opening message already in place', async () => {
      await seedDefaultStatus()
      const requesterP = await seedPrincipal({})

      let messageVisibleAtDispatch = false
      convEmit.emitConversationCreated.mockImplementationOnce(
        async (_actor: unknown, _author: unknown, conversation: { id: ConversationId }) => {
          const rows = await testDb
            .select()
            .from(conversationMessages)
            .where(eq(conversationMessages.conversationId, conversation.id))
          messageVisibleAtDispatch = rows.length === 1
        }
      )

      const dto = await intakeCreate(requesterP, {
        title: 'gated effects',
        description: 'opening context',
      })

      expect(convEmit.emitConversationCreated).toHaveBeenCalledTimes(1)
      const [, , emittedConversation] = convEmit.emitConversationCreated.mock.calls[0]
      const link = await readPairLink(dto.id as TicketId)
      expect(emittedConversation.id).toBe(link!.conversationId)
      expect(emittedConversation.channel).toBe('messenger')
      // Native-flow parity: a conversation.created handler finds the full
      // opening context, not an empty thread.
      expect(messageVisibleAtDispatch).toBe(true)
    })

    it('SUPPRESSES started-notify, auto-routing, and Quinn at intake', async () => {
      await seedDefaultStatus()
      const requesterP = await seedPrincipal({})

      const dto = await intakeCreate(requesterP, {
        title: 'quiet intake',
        description: 'no noise please',
      })
      await flushAssistantChain()

      // notifyConversationStarted (the auto "we'll be with you") never fires.
      expect(convNotify.notifyConversationStarted).not.toHaveBeenCalled()
      // Auto-routing never runs: the conversation stays unowned (the ticket's
      // own born-unassigned shape governs).
      const link = await readPairLink(dto.id as TicketId)
      const conversation = await readConversation(link!.conversationId)
      expect(conversation.assignedAgentPrincipalId).toBeNull()
      // Quinn is gated out at intake.
      expect(assistant.runAssistantTurnForConversation).not.toHaveBeenCalled()
      // The opening message itself went through the pipeline (message.created
      // fired exactly once, for it).
      expect(convEmit.emitMessageCreated).toHaveBeenCalledTimes(1)
    })

    it('dispatches ticket.created with the pair link already visible (the event-trigger race fix)', async () => {
      await seedDefaultStatus()
      const requesterP = await seedPrincipal({})

      let linkVisibleAtDispatch = false
      ticketEmit.emitTicketCreated.mockImplementationOnce(
        async (_actor: unknown, ticket: { id: TicketId }) => {
          linkVisibleAtDispatch = (await readPairLink(ticket.id)) !== null
        }
      )

      await intakeCreate(requesterP, { title: 'race-free created', description: 'x' })

      expect(ticketEmit.emitTicketCreated).toHaveBeenCalledTimes(1)
      expect(linkVisibleAtDispatch).toBe(true)
    })

    it('leaves the intake pair SLA-free: the link exists but no TTR handoff fires', async () => {
      await seedDefaultStatus()
      const requesterP = await seedPrincipal({})

      const dto = await intakeCreate(requesterP, { title: 'sla-free birth', description: 'x' })

      const link = await readPairLink(dto.id as TicketId)
      expect(link).not.toBeNull()
      const conversation = await readConversation(link!.conversationId)
      const ticket = await readTicket(dto.id as TicketId)
      // A fresh backing conversation carries no applied SLA, so the shared
      // handoff (handoffConversationSlaToTicket) no-ops by construction.
      expect(conversation.slaApplied).toBeNull()
      expect(ticket.slaApplied).toBeNull()
    })

    it('a follow-up requester reply lands conversation-parented and still does not summon Quinn', async () => {
      await seedDefaultStatus()
      const requesterP = await seedPrincipal({})
      const dto = await intakeCreate(requesterP, { title: 'intake pair', description: 'opening' })
      assistant.runAssistantTurnForConversation.mockClear()

      const { message } = await appendInboundTicketReply(dto.id as TicketId, requesterP, {
        content: 'any update?',
      })
      await flushAssistantChain()

      const link = await readPairLink(dto.id as TicketId)
      expect(message.conversationId).toBe(link!.conversationId)
      expect(message.ticketId).toBeNull()
      expect(message.senderType).toBe('visitor')
      expect(assistant.runAssistantTurnForConversation).not.toHaveBeenCalled()
      // The ticket side of the matrix still fires: ticket.replied alongside
      // message.created (watcher fan-out preserved).
      expect(ticketEmit.emitTicketReplied).toHaveBeenCalledTimes(1)
    })
  })

  describe('the Quinn gate on LEGACY widget-source pairs (the Phase 1a flag)', () => {
    it('suppresses the assistant turn on the pair, fires it on an unpaired control', async () => {
      await seedDefaultStatus()
      const requesterP = await seedPrincipal({})
      const agentP = await seedPrincipal({ role: 'member' })
      // The legacy pair shape: a messenger-origin (widget-source) conversation
      // linked to a customer ticket after the fact.
      const pairConversationId = createId('conversation') as ConversationId
      await testDb.insert(conversations).values({
        id: pairConversationId,
        visitorPrincipalId: requesterP,
        channel: 'messenger',
      })
      const ticketId = createId('ticket') as TicketId
      await testDb.insert(tickets).values({
        id: ticketId,
        title: `T-${suffix()}`,
        statusId: (await testDb.select().from(ticketStatuses))[0].id,
        type: 'customer',
        requesterPrincipalId: requesterP,
      })
      await testDb
        .insert(ticketConversations)
        .values({ ticketId, conversationId: pairConversationId, ticketType: 'customer' })
      // The control: an ordinary unpaired widget conversation.
      const controlConversationId = createId('conversation') as ConversationId
      await testDb.insert(conversations).values({
        id: controlConversationId,
        visitorPrincipalId: requesterP,
        channel: 'messenger',
      })

      await sendVisitorMessage(
        { conversationId: pairConversationId, content: 'portal reply redirected here' },
        { principalId: requesterP, displayName: 'R' },
        requesterActor(requesterP)
      )
      await sendVisitorMessage(
        { conversationId: controlConversationId, content: 'plain widget message' },
        { principalId: requesterP, displayName: 'R' },
        requesterActor(requesterP)
      )

      // The control proves the flush window is long enough: once ITS chain
      // resolved, the pair's chain (started earlier) has resolved too.
      await vi.waitFor(() =>
        expect(assistant.runAssistantTurnForConversation).toHaveBeenCalledWith(
          controlConversationId
        )
      )
      await flushAssistantChain()
      expect(assistant.runAssistantTurnForConversation).toHaveBeenCalledTimes(1)
      expect(assistant.runAssistantTurnForConversation).not.toHaveBeenCalledWith(pairConversationId)
      // The suppressed turn changes nothing about the send itself: the
      // message landed and the pipeline ran (the agent seed exists only so
      // team-side reads inside the pipeline resolve).
      expect(agentP).toBeDefined()
      const messages = await testDb
        .select()
        .from(conversationMessages)
        .where(eq(conversationMessages.conversationId, pairConversationId))
      expect(messages).toHaveLength(1)
    })
  })

  describe('agent-authored intake (the API v1 / MCP shape via createTicket)', () => {
    it('customer + requester + flag creates the pair with an agent-typed opening, born-owned', async () => {
      await seedDefaultStatus()
      const requesterP = await seedPrincipal({})
      const agentP = await seedPrincipal({ role: 'member', type: 'service' })

      const dto = await createTicket(
        {
          type: 'customer',
          title: 'Refund not received',
          description: 'Customer reports a missing refund.',
          requesterPrincipalId: requesterP,
          withBackingConversation: true,
        },
        serviceActor(agentP)
      )

      const link = await readPairLink(dto.id as TicketId)
      expect(link).not.toBeNull()
      const conversation = await readConversation(link!.conversationId)
      expect(conversation.visitorPrincipalId).toBe(requesterP)
      expect(conversation.channel).toBe('messenger')

      // The opening message is the agent's summary, conversation-parented;
      // the pipeline claims the conversation for the filing principal — the
      // same born-owned shape the ticket gets from createTicket's defaults.
      const messages = await testDb
        .select()
        .from(conversationMessages)
        .where(eq(conversationMessages.conversationId, conversation.id))
      expect(messages).toHaveLength(1)
      expect(messages[0].senderType).toBe('agent')
      expect(messages[0].principalId).toBe(agentP)
      expect(conversation.assignedAgentPrincipalId).toBe(agentP)
      const ticket = await readTicket(dto.id as TicketId)
      expect(ticket.assigneePrincipalId).toBe(agentP)
      // An opening message is never a first response, whichever parent it
      // lands on.
      expect(ticket.firstResponseAt).toBeNull()

      // Gating: conversation.created fires, Quinn stays out, and the matrix's
      // agent-reply → requester email channel rides the redirect unchanged.
      expect(convEmit.emitConversationCreated).toHaveBeenCalledTimes(1)
      expect(convNotify.notifyAgentReply).toHaveBeenCalledTimes(1)
      await flushAssistantChain()
      expect(assistant.runAssistantTurnForConversation).not.toHaveBeenCalled()
    })

    it('customer + NO requester + flag stays standalone (requester-less API create)', async () => {
      await seedDefaultStatus()
      const agentP = await seedPrincipal({ role: 'member', type: 'service' })

      const dto = await createTicket(
        {
          type: 'customer',
          title: 'no requester yet',
          description: 'back-office intake of a phone call',
          withBackingConversation: true,
        },
        serviceActor(agentP)
      )

      expect(await readPairLink(dto.id as TicketId)).toBeNull()
      expect(await testDb.select().from(conversations)).toHaveLength(0)
      expect(convEmit.emitConversationCreated).not.toHaveBeenCalled()
      // The legacy opening message still lands ticket-parented.
      const rows = await testDb
        .select()
        .from(conversationMessages)
        .where(eq(conversationMessages.ticketId, dto.id as TicketId))
      expect(rows).toHaveLength(1)
    })

    it('back_office + flag stays standalone (non-customer types never pair)', async () => {
      await seedDefaultStatus()
      const agentP = await seedPrincipal({ role: 'member', type: 'service' })

      const dto = await createTicket(
        {
          type: 'back_office',
          title: 'internal task',
          withBackingConversation: true,
        },
        serviceActor(agentP)
      )

      expect(await readPairLink(dto.id as TicketId)).toBeNull()
      expect(await testDb.select().from(conversations)).toHaveLength(0)
      expect(convEmit.emitConversationCreated).not.toHaveBeenCalled()
    })

    it('customer + requester DEFAULTS to the pair (agent-only creation: the admin dialog is intake now)', async () => {
      await seedDefaultStatus()
      const requesterP = await seedPrincipal({})
      const agentP = await seedPrincipal({ role: 'member' })

      const dto = await createTicket(
        {
          type: 'customer',
          title: 'agent create, on behalf',
          description: 'x',
          requesterPrincipalId: requesterP,
        },
        serviceActor(agentP)
      )

      // Born as its conversation pair, so the requester's Messages surface
      // shows it — a standalone requester-holding customer ticket would be
      // invisible to its own requester.
      const link = await readPairLink(dto.id as TicketId)
      expect(link).not.toBeNull()
      expect(convEmit.emitConversationCreated).toHaveBeenCalledTimes(1)
    })

    it('customer + requester + a SOURCE conversation stays standalone (convert flow links its source right after)', async () => {
      await seedDefaultStatus()
      const requesterP = await seedPrincipal({})
      const agentP = await seedPrincipal({ role: 'member' })
      const sourceConversationId = createId('conversation') as ConversationId
      await testDb.insert(conversations).values({
        id: sourceConversationId,
        visitorPrincipalId: requesterP,
        channel: 'messenger',
      })

      const dto = await createTicket(
        {
          type: 'customer',
          title: 'convert shape',
          description: 'x',
          requesterPrincipalId: requesterP,
          sourceConversationId,
        },
        serviceActor(agentP)
      )

      // No backing conversation minted — linkTicketToConversation attaches the
      // SOURCE conversation as the pair immediately after this create, and the
      // pair unique would reject that link if one existed already.
      expect(await readPairLink(dto.id as TicketId)).toBeNull()
      expect(convEmit.emitConversationCreated).not.toHaveBeenCalled()
    })
  })
})
