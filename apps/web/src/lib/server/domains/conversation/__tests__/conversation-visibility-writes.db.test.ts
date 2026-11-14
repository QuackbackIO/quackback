/**
 * Real-DB coverage for conversation visibility on every agent conversation
 * read and write in the conversation domain. A teammate whose role grants
 * team-scoped `conversation.view` reaches only conversations assigned to them
 * or to one of their teams. Every other conversation answers NotFound, exactly
 * like a missing one, and stays unchanged.
 *
 * The system paths keep working: a workspace-wide service actor reaches every
 * conversation, the visitor who owns a conversation still reads and writes it,
 * the read-state delegations of a ticket the caller already checked reach its
 * pair's conversation, a reply on a visible ticket lands in its hidden pair's
 * conversation, and a macro checked once at its start finishes all its actions
 * after one of them moves the conversation out of scope.
 *
 * Real here: the conversation writers, `conversationFilter` and the rows they
 * read and write. Stood in for: realtime fan-out, the webhook and notification
 * bridges, none of which decide visibility.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import {
  createId,
  type BoardId,
  type ConversationId,
  type ConversationMessageId,
  type PostId,
  type TicketId,
  type TicketStatusId,
} from '@quackback/ids'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('@/lib/server/config', async () =>
  (await import('@/lib/server/__tests__/conversation-visibility-mocks')).configMocks()
)
vi.mock('@/lib/server/realtime/conversation-channels', async () =>
  (await import('@/lib/server/__tests__/conversation-visibility-mocks')).channelMocks()
)
vi.mock('@/lib/server/domains/tickets/ticket.webhooks', async () =>
  (await import('@/lib/server/__tests__/conversation-visibility-mocks')).ticketWebhookMocks()
)
vi.mock('../conversation.webhooks', async () =>
  (await import('@/lib/server/__tests__/conversation-visibility-mocks')).conversationWebhookMocks()
)
vi.mock('../conversation.notify', async () =>
  (await import('@/lib/server/__tests__/conversation-visibility-mocks')).notifyMocks()
)

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  NOT_FOUND,
  agentMessagesOn,
  row,
  MESSAGE_NOT_FOUND,
  seedPerson,
  seedWorld,
  suffix,
  workspaceKey,
  SCOPED_PERMISSIONS,
  type World as W,
} from '@/lib/server/__tests__/conversation-visibility-world'
import {
  boards,
  conversationMessageFlags,
  conversationMessageReactions,
  conversationMessages,
  conversationParticipants,
  conversations,
  eq,
  posts,
  postExternalLinks,
  principal,
  ticketConversations,
  tickets,
  ticketStatuses,
  PERMISSIONS,
} from '@/lib/server/db'
import type { Actor } from '@/lib/server/policy/types'
import {
  addAgentNote,
  assignConversation,
  assignTeam,
  deleteConversationMessage,
  deleteConversationPermanently,
  endConversation,
  markConversationRead,
  markConversationUnreadAt,
  markConversationUnreadFromMessage,
  restoreConversationFromSpam,
  sendAgentMessage,
  setConversationPriority,
  setConversationStatus,
  signalTyping,
  snoozeConversation,
} from '../conversation.service'
import { editConversationMessage } from '../conversation.edit'
import { assertConversationVisible } from '../conversation-visibility'
import { suggestPost } from '../conversation.cards'
import { registerConversationTools } from '@/lib/server/mcp/tools/conversations'
import type { McpAuthContext } from '@/lib/server/mcp/types'
import {
  dismissInboxTranslationSuggestion,
  setInboxTranslationEnabled,
} from '../conversation-translation.service'
import { addMessageReaction, removeMessageReaction, setMessageFlag } from '../message.actions'
import {
  addConversationParticipantByEmail,
  listConversationParticipants,
  removeConversationParticipant,
} from '../conversation-participant.service'
import { getLinkedConversationsForPost, listFlaggedMessages } from '../conversation.query'
import { applyMacroActions } from '@/lib/server/domains/macros/macro.actions'
import { boundedServiceActor } from '@/lib/server/policy/service-actor'
import { AUTOMATION_PERMISSIONS } from '@/lib/server/domains/workflows/workflow-actor-permissions'
import { quinnActor } from '@/lib/server/domains/assistant/assistant.actor'
import { SWEEP_PERMISSIONS } from '@/lib/server/domains/workflows/workflow-sweep'
import { createTicket } from '@/lib/server/domains/tickets/ticket.service'
import { sendTicketMessage } from '@/lib/server/domains/tickets/ticket-message.service'
import {
  markTicketReadForAgent,
  markTicketUnreadFromMessage,
} from '@/lib/server/domains/tickets/ticket-unread.service'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db
      .select({ id: conversationParticipants.conversationId })
      .from(conversationParticipants)
      .limit(0)
    await db
      .select({ id: conversationMessageFlags.principalId })
      .from(conversationMessageFlags)
      .limit(0)
  },
})

describe('conversation writes check visibility (real DB, rolled back)', () => {
  beforeEach(async () => {
    expect(fixture.available).toBe(true)
    await fixture.begin()
  })
  // Writers start fire-and-forget work (events, triage) after they return.
  // Let it settle inside this test's transaction, so it cannot land in the
  // next test's and abort it.
  afterEach(async () => {
    await new Promise((resolve) => setTimeout(resolve, 150))
    await fixture.rollback()
  })
  afterAll(fixture.close)

  /** Each write: run it on a conversation, and say whether the row changed. */
  const writes: [string, (w: W, id: ConversationId) => Promise<unknown>][] = [
    ['setConversationStatus', (w, id) => setConversationStatus(id, 'closed', w.actor)],
    ['snoozeConversation', (w, id) => snoozeConversation(id, null, w.actor)],
    ['endConversation', (w, id) => endConversation(id, 'resolved', null, w.actor)],
    ['assignConversation', (w, id) => assignConversation(id, w.teammate, w.actor)],
    ['assignTeam', (w, id) => assignTeam(id, w.teamX, w.actor)],
    ['setConversationPriority', (w, id) => setConversationPriority(id, 'urgent', w.actor)],
    ['setInboxTranslationEnabled', (w, id) => setInboxTranslationEnabled(id, true, w.actor)],
    [
      'dismissInboxTranslationSuggestion',
      (w, id) => dismissInboxTranslationSuggestion(id, w.actor),
    ],
  ]

  it.each(writes)(
    '%s: NotFound on a hidden conversation, which stays unchanged; works on a visible one',
    async (_, write) => {
      const w = await seedWorld()
      const hidden = await w.conversation(w.teamY)
      const visible = await w.conversation(w.teamX)
      const before = await row(hidden.id)
      await expect(write(w, hidden.id)).rejects.toMatchObject(NOT_FOUND)
      expect(await row(hidden.id)).toEqual(before)
      await expect(write(w, visible.id)).resolves.toBeTruthy()
    }
  )

  it('a hidden conversation cannot be pulled into scope by assigning it to my team', async () => {
    const w = await seedWorld()
    const hidden = await w.conversation(w.teamY)
    await expect(assignTeam(hidden.id, w.teamX, w.actor)).rejects.toMatchObject(NOT_FOUND)
    expect((await row(hidden.id)).assignedTeamId).toBe(w.teamY)
  })

  it('a conversation with no assignee and no team is hidden from a scoped teammate', async () => {
    const w = await seedWorld()
    const unassigned = await w.conversation(null)
    await expect(setConversationStatus(unassigned.id, 'closed', w.actor)).rejects.toMatchObject(
      NOT_FOUND
    )
    await expect(assertConversationVisible(unassigned.id, w.actor)).rejects.toMatchObject(NOT_FOUND)
  })

  it('a teammate who moves their own conversation to another team gets success', async () => {
    const w = await seedWorld()
    const visible = await w.conversation(w.teamX)
    const updated = await assignTeam(visible.id, w.teamY, w.actor)
    expect(updated.assignedTeamId).toBe(w.teamY)
    // From then on it is out of scope like any other.
    await expect(setConversationPriority(visible.id, 'high', w.actor)).rejects.toMatchObject(
      NOT_FOUND
    )
  })

  it('restore from spam and permanent delete: NotFound on a hidden conversation, which stays', async () => {
    const w = await seedWorld()
    const hidden = await w.conversation(w.teamY, { status: 'closed', endReason: 'spam' })
    const visible = await w.conversation(w.teamX, { status: 'closed', endReason: 'spam' })
    await expect(restoreConversationFromSpam(hidden.id, w.actor)).rejects.toMatchObject(NOT_FOUND)
    await expect(deleteConversationPermanently(hidden.id, w.actor)).rejects.toMatchObject(NOT_FOUND)
    expect((await row(hidden.id)).endReason).toBe('spam')
    await deleteConversationPermanently(visible.id, w.actor)
    expect(await row(visible.id)).toBeUndefined()
  })

  it('reply: NotFound on a hidden conversation, no message, and it stays unassigned', async () => {
    const w = await seedWorld()
    // Hidden by team, no assignee: a reply would otherwise claim it.
    const hidden = await w.conversation(w.teamY)
    await expect(
      sendAgentMessage(hidden.id, 'Hello from Acme', w.author, w.actor)
    ).rejects.toMatchObject(NOT_FOUND)
    expect(await agentMessagesOn(hidden.id)).toEqual([])
    expect((await row(hidden.id)).assignedAgentPrincipalId).toBeNull()

    const visible = await w.conversation(w.teamX)
    await sendAgentMessage(visible.id, 'Hello from Acme', w.author, w.actor)
    expect(await agentMessagesOn(visible.id)).toHaveLength(1)
  })

  it('a workspace key still replies on any conversation', async () => {
    const w = await seedWorld()
    const hidden = await w.conversation(w.teamY)
    await sendAgentMessage(hidden.id, 'Hello from Acme', w.author, workspaceKey)
    expect(await agentMessagesOn(hidden.id)).toHaveLength(1)
  })

  it('a workspace key holding only conversation.view_all sees every conversation', async () => {
    const w = await seedWorld()
    const hidden = await w.conversation(w.teamY)
    const viewAllOnly: Actor = {
      ...workspaceKey,
      permissions: new Set([PERMISSIONS.CONVERSATION_VIEW_ALL]),
    }
    await expect(assertConversationVisible(hidden.id, viewAllOnly)).resolves.toMatchObject({
      id: hidden.id,
    })
  })

  it('a workspace key without conversation.view sees no conversation', async () => {
    const w = await seedWorld()
    const visible = await w.conversation(w.teamX)
    const assignOnly: Actor = {
      ...workspaceKey,
      permissions: new Set([PERMISSIONS.CONVERSATION_ASSIGN]),
    }
    await expect(assertConversationVisible(visible.id, assignOnly)).rejects.toMatchObject(NOT_FOUND)
  })

  it('the auto-close sweep still closes a conversation on any team', async () => {
    const w = await seedWorld()
    const hidden = await w.conversation(w.teamY)
    await setConversationStatus(hidden.id, 'closed', boundedServiceActor(SWEEP_PERMISSIONS))
    expect((await row(hidden.id)).status).toBe('closed')
  })

  it('a personal key follows its creator', async () => {
    const w = await seedWorld()
    const hidden = await w.conversation(w.teamY)
    const visible = await w.conversation(w.teamX)
    const key: Actor = { ...workspaceKey, scopePrincipalId: w.teammate }
    await expect(assertConversationVisible(hidden.id, key)).rejects.toMatchObject(NOT_FOUND)
    await expect(assertConversationVisible(visible.id, key)).resolves.toBeTruthy()
  })

  it('note: NotFound on a hidden conversation and no note is written', async () => {
    const w = await seedWorld()
    const hidden = await w.conversation(w.teamY)
    await expect(addAgentNote(hidden.id, 'Acme note', w.author, w.actor)).rejects.toMatchObject(
      NOT_FOUND
    )
    expect(await agentMessagesOn(hidden.id)).toEqual([])
    const visible = await w.conversation(w.teamX)
    await addAgentNote(visible.id, 'Acme note', w.author, w.actor)
    expect(await agentMessagesOn(visible.id)).toHaveLength(1)
  })

  it('read state: NotFound on a hidden conversation and the watermark stays', async () => {
    const w = await seedWorld()
    const hidden = await w.conversation(w.teamY)
    await expect(markConversationRead(hidden.id, w.actor)).rejects.toMatchObject(NOT_FOUND)
    await expect(markConversationUnreadAt(hidden.id, new Date(), w.actor)).rejects.toMatchObject(
      NOT_FOUND
    )
    await expect(
      markConversationUnreadFromMessage(hidden.id, hidden.messageId, w.actor)
    ).rejects.toMatchObject(NOT_FOUND)
    expect((await row(hidden.id)).agentLastReadAt).toBeNull()
    await expect(signalTyping(hidden.id, w.actor)).rejects.toMatchObject(NOT_FOUND)
    const visible = await w.conversation(w.teamX)
    await markConversationRead(visible.id, w.actor)
    expect((await row(visible.id)).agentLastReadAt).not.toBeNull()
  })

  it('the visitor who owns a conversation still reads it and marks it read', async () => {
    const w = await seedWorld()
    const own = await w.conversation(w.teamY)
    const visitorActor: Actor = {
      principalId: w.visitor,
      role: 'user',
      principalType: 'user',
      segmentIds: new Set(),
      permissions: new Set(),
    }
    await expect(assertConversationVisible(own.id, visitorActor)).resolves.toBeTruthy()
    await markConversationRead(own.id, visitorActor)
    expect((await row(own.id)).visitorLastReadAt).not.toBeNull()
  })

  it('message delete and edit: NotFound on a hidden conversation, nothing changes', async () => {
    const w = await seedWorld()
    const hidden = await w.conversation(w.teamY)
    const [mine] = await testDb
      .insert(conversationMessages)
      .values({
        conversationId: hidden.id,
        principalId: w.teammate,
        senderType: 'agent',
        content: 'My own Acme reply',
      })
      .returning()
    // The author who lost scope cannot delete their own message either, and the
    // answer is the missing-message one.
    await expect(
      deleteConversationMessage(mine.id as ConversationMessageId, w.actor)
    ).rejects.toMatchObject(MESSAGE_NOT_FOUND)
    await expect(
      editConversationMessage(mine.id as ConversationMessageId, 'Edited', null, w.actor)
    ).rejects.toMatchObject({ code: 'MESSAGE_NOT_FOUND', statusCode: 404 })
    const [after] = await testDb
      .select()
      .from(conversationMessages)
      .where(eq(conversationMessages.id, mine.id))
    expect(after.deletedAt).toBeNull()
    expect(after.content).toBe('My own Acme reply')
  })

  it('reactions and the flag: NotFound on a hidden conversation and nothing is written', async () => {
    const w = await seedWorld()
    const hidden = await w.conversation(w.teamY)
    await expect(addMessageReaction(hidden.messageId, '👍', w.actor)).rejects.toMatchObject(
      MESSAGE_NOT_FOUND
    )
    await expect(removeMessageReaction(hidden.messageId, '👍', w.actor)).rejects.toMatchObject(
      MESSAGE_NOT_FOUND
    )
    await expect(setMessageFlag(hidden.messageId, true, w.actor)).rejects.toMatchObject(
      MESSAGE_NOT_FOUND
    )
    expect(await testDb.select().from(conversationMessageReactions)).toEqual([])
    expect(await testDb.select().from(conversationMessageFlags)).toEqual([])
    const visible = await w.conversation(w.teamX)
    await addMessageReaction(visible.messageId, '👍', w.actor)
    await setMessageFlag(visible.messageId, true, w.actor)
    expect(await testDb.select().from(conversationMessageReactions)).toHaveLength(1)
  })

  it('a hidden message answers exactly like a missing one, before any other refusal', async () => {
    const w = await seedWorld()
    const hidden = await w.conversation(w.teamY)
    const missing = createId('conversation_message') as ConversationMessageId
    const insert = async (values: Partial<typeof conversationMessages.$inferInsert>) =>
      (
        await testDb
          .insert(conversationMessages)
          .values({ conversationId: hidden.id, content: 'Acme', senderType: 'agent', ...values })
          .returning()
      )[0].id as ConversationMessageId
    const system = await insert({ senderType: 'system' })
    const someoneElses = await insert({ principalId: w.visitor })
    const block = await insert({
      principalId: w.teammate,
      metadata: { block: { kind: 'csat' } } as never,
    })
    const refusalOf = (p: Promise<unknown>) =>
      p.then(
        () => null,
        (e: { code?: string; statusCode?: number; message?: string }) => ({
          code: e.code,
          statusCode: e.statusCode,
          message: e.message,
        })
      )
    const asMissing = await refusalOf(addMessageReaction(missing, '👍', w.actor))
    expect(asMissing).toMatchObject(MESSAGE_NOT_FOUND)
    // A system row would be refused as Forbidden once seen; hidden, it is missing.
    expect(await refusalOf(addMessageReaction(system, '👍', w.actor))).toEqual(asMissing)
    expect(await refusalOf(setMessageFlag(system, true, w.actor))).toEqual(asMissing)
    expect(await refusalOf(deleteConversationMessage(someoneElses, w.actor))).toEqual(asMissing)
    expect(await refusalOf(deleteConversationMessage(missing, w.actor))).toEqual(asMissing)
    expect(await refusalOf(editConversationMessage(block, 'x', null, w.actor))).toEqual(asMissing)
    expect(await refusalOf(editConversationMessage(missing, 'x', null, w.actor))).toEqual(asMissing)
  })

  it('a flag on a conversation that left my scope drops out of my saved list', async () => {
    const w = await seedWorld()
    const c = await w.conversation(w.teamX)
    await setMessageFlag(c.messageId, true, w.actor)
    expect((await listFlaggedMessages(w.actor)).map((f) => f.messageId)).toEqual([c.messageId])
    await testDb
      .update(conversations)
      .set({ assignedTeamId: w.teamY })
      .where(eq(conversations.id, c.id))
    expect(await listFlaggedMessages(w.actor)).toEqual([])
  })

  it('participants: add, remove and list are NotFound on a hidden conversation', async () => {
    const w = await seedWorld()
    const hidden = await w.conversation(w.teamY)
    await expect(
      addConversationParticipantByEmail(hidden.id, 'pat@example.com', w.actor)
    ).rejects.toMatchObject(NOT_FOUND)
    await expect(
      removeConversationParticipant(hidden.id, w.visitor, w.actor)
    ).rejects.toMatchObject(NOT_FOUND)
    await expect(listConversationParticipants(hidden.id, w.actor)).rejects.toMatchObject(NOT_FOUND)
    expect(await testDb.select().from(conversationParticipants)).toEqual([])
    // No system line was written either.
    expect(
      (
        await testDb
          .select()
          .from(conversationMessages)
          .where(eq(conversationMessages.conversationId, hidden.id))
      ).map((m) => m.senderType)
    ).toEqual(['visitor'])

    const visible = await w.conversation(w.teamX)
    await addConversationParticipantByEmail(visible.id, 'pat@example.com', w.actor)
    expect(await listConversationParticipants(visible.id, w.actor)).toHaveLength(1)
  })

  it('suggest a post: NotFound on a hidden resolved conversation, and no note is written', async () => {
    const w = await seedWorld()
    const hidden = await w.conversation(w.teamY, { status: 'closed' })
    const visible = await w.conversation(w.teamX, { status: 'closed' })
    const input = { boardId: createId('board') as BoardId, title: 'Acme idea', content: '' }
    const ctx = { agentActor: w.actor, agentPrincipalId: w.teammate, agent: w.author }
    await expect(suggestPost({ ...input, conversationId: hidden.id }, ctx)).rejects.toMatchObject(
      NOT_FOUND
    )
    expect(await agentMessagesOn(hidden.id)).toEqual([])
    await suggestPost({ ...input, conversationId: visible.id }, ctx)
    expect(await agentMessagesOn(visible.id)).toHaveLength(1)
  })

  it('the conversations linked to a post are only those in my scope', async () => {
    const w = await seedWorld()
    const boardId = createId('board') as BoardId
    await testDb.insert(boards).values({ id: boardId, name: 'Acme', slug: String(boardId) })
    const postId = createId('post') as PostId
    await testDb
      .insert(posts)
      .values({ id: postId, boardId, title: 'Acme idea', content: '', principalId: w.visitor })
    const hidden = await w.conversation(w.teamY)
    const visible = await w.conversation(w.teamX)
    for (const c of [hidden, visible]) {
      await testDb
        .insert(postExternalLinks)
        .values({ postId, integrationType: 'live_chat', externalId: c.id })
    }
    expect(
      (await getLinkedConversationsForPost(postId, w.actor)).map((c) => c.conversationId)
    ).toEqual([visible.id])
    expect(await getLinkedConversationsForPost(postId, workspaceKey)).toHaveLength(2)
  })

  describe('MCP conversation tools', () => {
    type ToolResult = { isError?: boolean; content: { type: string; text: string }[] }
    type Handler = (args: Record<string, unknown>) => Promise<ToolResult>

    /** The real tools, for the scoped teammate signed in over OAuth. */
    async function tools(w: W): Promise<Map<string, Handler>> {
      const [me] = await testDb
        .select({ userId: principal.userId })
        .from(principal)
        .where(eq(principal.id, w.teammate))
      const handlers = new Map<string, Handler>()
      const server = {
        tool: (name: string, _d: string, _s: unknown, _a: unknown, handler: Handler) => {
          handlers.set(name, handler)
          return { update: () => {} }
        },
      }
      const auth = {
        principalId: w.teammate,
        userId: me.userId,
        name: 'Ana',
        email: 'ana@example.com',
        role: 'member',
        authMethod: 'oauth',
        scopes: ['read:chat', 'write:chat'],
        permissions: new Set(SCOPED_PERMISSIONS),
      } as unknown as McpAuthContext
      registerConversationTools(server as never, auth)
      return handlers
    }

    const calls: [string, (c: ConversationId, w: W) => Record<string, unknown>][] = [
      ['get_conversation', (c) => ({ conversationId: c })],
      ['reply_to_conversation', (c) => ({ conversationId: c, content: 'Hello from Acme' })],
      ['set_conversation_status', (c) => ({ conversationId: c, status: 'closed' })],
      ['share_post', (c) => ({ conversationId: c, postId: createId('post') })],
      [
        'suggest_post',
        (c) => ({
          conversationId: c,
          boardId: createId('board'),
          title: 'Acme idea',
          content: 'Acme',
        }),
      ],
    ]

    it.each(calls)(
      '%s: a hidden conversation is not found and stays as it was',
      async (name, args) => {
        const w = await seedWorld()
        const hidden = await w.conversation(w.teamY, { status: 'closed' })
        const before = await row(hidden.id)
        const result = await (await tools(w)).get(name)!(args(hidden.id, w))
        expect(result.isError).toBe(true)
        expect(result.content[0].text).toMatch(/not found/i)
        expect(await row(hidden.id)).toEqual(before)
        expect(await agentMessagesOn(hidden.id)).toEqual([])
      }
    )

    it('get_conversation still reads a conversation of my team', async () => {
      const w = await seedWorld()
      const visible = await w.conversation(w.teamX)
      const result = await (await tools(w)).get('get_conversation')!({
        conversationId: visible.id,
      })
      expect(result.isError).toBeFalsy()
    })
  })

  describe('createTicket from a conversation', () => {
    async function seedStatus() {
      const id = createId('ticket_status') as TicketStatusId
      await testDb
        .insert(ticketStatuses)
        .values({ id, name: 'Acme open', slug: `cv-${suffix()}`, isDefault: true })
      return id
    }

    it('NotFound for a hidden source conversation, and no ticket is created', async () => {
      const w = await seedWorld()
      await seedStatus()
      const hidden = await w.conversation(w.teamY, { assignedAgentPrincipalId: w.teammate })
      // Unassign so only the team decides scope.
      await testDb
        .update(conversations)
        .set({ assignedAgentPrincipalId: null })
        .where(eq(conversations.id, hidden.id))
      const before = await testDb.select().from(tickets)
      await expect(
        createTicket(
          { type: 'back_office', title: 'Acme', sourceConversationId: hidden.id },
          w.actor
        )
      ).rejects.toMatchObject(NOT_FOUND)
      expect(await testDb.select().from(tickets)).toHaveLength(before.length)
    })

    it('takes the assignee of a visible source conversation', async () => {
      const w = await seedWorld()
      await seedStatus()
      const colleague = await seedPerson('member')
      const visible = await w.conversation(w.teamX, { assignedAgentPrincipalId: colleague })
      const ticket = await createTicket(
        { type: 'back_office', title: 'Acme', sourceConversationId: visible.id },
        w.actor
      )
      expect(ticket.assignee?.principalId ?? null).toBe(colleague)
    })
  })

  describe('system paths', () => {
    async function seedPair(w: W) {
      const statusId = createId('ticket_status') as TicketStatusId
      await testDb
        .insert(ticketStatuses)
        .values({ id: statusId, name: 'Acme open', slug: `cp-${suffix()}` })
      const ticketId = createId('ticket') as TicketId
      // A ticket I can see, paired with a conversation on another team.
      await testDb.insert(tickets).values({
        id: ticketId,
        title: 'Acme pair',
        statusId,
        type: 'customer',
        assigneeTeamId: w.teamX,
        requesterPrincipalId: w.visitor,
      })
      const conversation = await w.conversation(w.teamY)
      await testDb
        .insert(ticketConversations)
        .values({ ticketId, conversationId: conversation.id, ticketType: 'customer' })
      return { ticketId, conversation }
    }

    /** My own reply on the pair conversation, as the ticket thread shows it. */
    async function ownReplyOn(w: W, conversationId: ConversationId) {
      const [reply] = await testDb
        .insert(conversationMessages)
        .values({
          conversationId,
          principalId: w.teammate,
          senderType: 'agent',
          content: 'My Acme reply',
        })
        .returning()
      return reply.id as ConversationMessageId
    }

    it('on a visible ticket, my reply stored on its hidden pair can be edited, reacted to, flagged and deleted', async () => {
      const w = await seedWorld()
      const pair = await seedPair(w)
      const reply = await ownReplyOn(w, pair.conversation.id)
      await editConversationMessage(reply, 'My edited Acme reply', null, w.actor)
      await addMessageReaction(reply, '👍', w.actor)
      await removeMessageReaction(reply, '👍', w.actor)
      await setMessageFlag(reply, true, w.actor)
      await deleteConversationMessage(reply, w.actor)
      const [after] = await testDb
        .select()
        .from(conversationMessages)
        .where(eq(conversationMessages.id, reply))
      expect(after.content).toBe('My edited Acme reply')
      expect(after.deletedAt).not.toBeNull()
      expect(await testDb.select().from(conversationMessageFlags)).toHaveLength(1)
    })

    /** Every message action on `reply` answers like a missing message. */
    async function expectAllMissing(w: W, reply: ConversationMessageId) {
      await expect(editConversationMessage(reply, 'x', null, w.actor)).rejects.toMatchObject(
        MESSAGE_NOT_FOUND
      )
      await expect(addMessageReaction(reply, '👍', w.actor)).rejects.toMatchObject(
        MESSAGE_NOT_FOUND
      )
      await expect(setMessageFlag(reply, true, w.actor)).rejects.toMatchObject(MESSAGE_NOT_FOUND)
      await expect(deleteConversationMessage(reply, w.actor)).rejects.toMatchObject(
        MESSAGE_NOT_FOUND
      )
    }

    it('a visible back-office ticket opened from a hidden conversation admits none of its messages', async () => {
      const w = await seedWorld()
      const statusId = createId('ticket_status') as TicketStatusId
      await testDb
        .insert(ticketStatuses)
        .values({ id: statusId, name: 'Acme open', slug: `bo-${suffix()}` })
      const ticketId = createId('ticket') as TicketId
      await testDb.insert(tickets).values({
        id: ticketId,
        title: 'Acme back office',
        statusId,
        type: 'back_office',
        assigneeTeamId: w.teamX,
      })
      const conversation = await w.conversation(w.teamY)
      // A provenance link, not a pair.
      await testDb
        .insert(ticketConversations)
        .values({ ticketId, conversationId: conversation.id, ticketType: 'back_office' })
      await expectAllMissing(w, await ownReplyOn(w, conversation.id))
    })

    it("a deleted pair ticket admits none of its hidden conversation's messages", async () => {
      const w = await seedWorld()
      const pair = await seedPair(w)
      await testDb
        .update(tickets)
        .set({ deletedAt: new Date() })
        .where(eq(tickets.id, pair.ticketId))
      await expectAllMissing(w, await ownReplyOn(w, pair.conversation.id))
    })

    it('with only ticket keys, my reply stored on a hidden pair is mine to edit and delete', async () => {
      const w = await seedWorld()
      const pair = await seedPair(w)
      const reply = await ownReplyOn(w, pair.conversation.id)
      const ticketKeysOnly: Actor = {
        ...w.actor,
        permissions: new Set([PERMISSIONS.TICKET_VIEW, PERMISSIONS.TICKET_REPLY]),
      }
      await editConversationMessage(reply, 'Edited through the ticket', null, ticketKeysOnly)
      await deleteConversationMessage(reply, ticketKeysOnly)
      const [after] = await testDb
        .select()
        .from(conversationMessages)
        .where(eq(conversationMessages.id, reply))
      expect(after.content).toBe('Edited through the ticket')
      expect(after.deletedAt).not.toBeNull()
    })

    it('a hidden ticket with a hidden pair still answers like a missing message', async () => {
      const w = await seedWorld()
      const pair = await seedPair(w)
      await testDb
        .update(tickets)
        .set({ assigneeTeamId: w.teamY })
        .where(eq(tickets.id, pair.ticketId))
      const reply = await ownReplyOn(w, pair.conversation.id)
      await expect(editConversationMessage(reply, 'x', null, w.actor)).rejects.toMatchObject(
        MESSAGE_NOT_FOUND
      )
      await expect(deleteConversationMessage(reply, w.actor)).rejects.toMatchObject(
        MESSAGE_NOT_FOUND
      )
      await expect(addMessageReaction(reply, '👍', w.actor)).rejects.toMatchObject(
        MESSAGE_NOT_FOUND
      )
      await expect(setMessageFlag(reply, true, w.actor)).rejects.toMatchObject(MESSAGE_NOT_FOUND)
    })

    it('a reply on a visible ticket lands in its hidden pair, and claims it for the sender', async () => {
      const w = await seedWorld()
      const pair = await seedPair(w)
      await sendTicketMessage(w.actor, { ticketId: pair.ticketId, content: 'Acme reply' })
      expect(await agentMessagesOn(pair.conversation.id)).toHaveLength(1)
      expect((await row(pair.conversation.id)).assignedAgentPrincipalId).toBe(w.teammate)
      // On the conversation path the same conversation is NotFound: the reply
      // claimed it for the sender, so take that back first.
      await testDb
        .update(conversations)
        .set({ assignedAgentPrincipalId: null })
        .where(eq(conversations.id, pair.conversation.id))
      await expect(
        sendAgentMessage(pair.conversation.id, 'direct', w.author, w.actor)
      ).rejects.toMatchObject(NOT_FOUND)
    })

    it("marking a visible ticket read moves its hidden pair's watermark", async () => {
      const w = await seedWorld()
      const pair = await seedPair(w)
      await markTicketReadForAgent(pair.ticketId, w.actor)
      expect((await row(pair.conversation.id)).agentLastReadAt).not.toBeNull()
      // Directly, the hidden conversation is NotFound.
      await expect(markConversationRead(pair.conversation.id, w.actor)).rejects.toMatchObject(
        NOT_FOUND
      )
    })

    /** The pair's watermark set to now, so an unread-from-here must move it back. */
    async function markPairReadNow(id: ConversationId) {
      const now = new Date()
      await testDb
        .update(conversations)
        .set({ agentLastReadAt: now })
        .where(eq(conversations.id, id))
      return now
    }

    it('unread from a conversation message on a visible ticket rewinds its hidden pair', async () => {
      const w = await seedWorld()
      const pair = await seedPair(w)
      const readAt = await markPairReadNow(pair.conversation.id)
      await markTicketUnreadFromMessage(pair.ticketId, pair.conversation.messageId, w.actor)
      const after = (await row(pair.conversation.id)).agentLastReadAt
      expect(after === null || after < readAt).toBe(true)
    })

    it('unread from a ticket message on a visible ticket rewinds its hidden pair', async () => {
      const w = await seedWorld()
      const pair = await seedPair(w)
      // A legacy ticket-parented message on the paired ticket.
      const [anchor] = await testDb
        .insert(conversationMessages)
        .values({
          ticketId: pair.ticketId,
          principalId: w.visitor,
          senderType: 'visitor',
          content: 'Acme legacy reply',
          createdAt: new Date(Date.now() - 60_000),
        })
        .returning()
      const readAt = await markPairReadNow(pair.conversation.id)
      await markTicketUnreadFromMessage(pair.ticketId, anchor.id as ConversationMessageId, w.actor)
      const after = (await row(pair.conversation.id)).agentLastReadAt
      expect(after === null || after < readAt).toBe(true)
    })

    it('a macro finishes after an earlier action moves the conversation out of scope', async () => {
      const w = await seedWorld()
      const c = await w.conversation(w.teamX)
      const applied = await applyMacroActions(
        c.id,
        [
          { type: 'assign_team', teamId: w.teamY },
          { type: 'set_priority', priority: 'urgent' },
          { type: 'close' },
        ],
        w.actor
      )
      expect(applied).toHaveLength(3)
      const after = await row(c.id)
      expect(after.assignedTeamId).toBe(w.teamY)
      expect(after.priority).toBe('urgent')
      expect(after.status).toBe('closed')
      // A later direct write by the same teammate is checked as usual.
      await expect(setConversationStatus(c.id, 'open', w.actor)).rejects.toMatchObject(NOT_FOUND)
    })

    it('the real automation actors still reach a conversation on any team, or none', async () => {
      const w = await seedWorld()
      // Workflows, the spam close and the sweeps run as this bounded actor.
      const automation = boundedServiceActor(AUTOMATION_PERMISSIONS)
      const byTeam = await w.conversation(w.teamY)
      const unowned = await w.conversation(null)
      await setConversationStatus(byTeam.id, 'closed', automation)
      await setConversationPriority(unowned.id, 'high', automation)
      expect((await row(byTeam.id)).status).toBe('closed')
      expect((await row(unowned.id)).priority).toBe('high')
      // The assistant's own actor.
      const assistant = quinnActor(await seedPerson('member'))
      await expect(assertConversationVisible(byTeam.id, assistant)).resolves.toBeTruthy()
      await expect(assertConversationVisible(unowned.id, assistant)).resolves.toBeTruthy()
    })

    it('a workspace-wide service actor writes to any conversation', async () => {
      const w = await seedWorld()
      const hidden = await w.conversation(w.teamY)
      await setConversationStatus(hidden.id, 'closed', workspaceKey)
      expect((await row(hidden.id)).status).toBe('closed')
    })
  })
})
