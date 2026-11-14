/**
 * Real-DB matrix for conversation visibility on every server function that
 * takes a conversation id or a conversation message id, called through the
 * handlers. A teammate whose role grants team-scoped `conversation.view` gets
 * NotFound for a conversation outside their teams, exactly like a missing
 * one, and nothing about it changes. The same teammate still reaches a
 * conversation of their own team.
 *
 * Checks that run before a guard which would otherwise answer something else
 * (the close guard's field names, the one-pair rule, the reply translation,
 * an inline tag create, a macro's render) each have their own discriminator.
 *
 * Real here: the handlers, the services they call, `conversationFilter` and
 * the rows. Stood in for: the session (each test sets the actor), realtime,
 * the webhook and notification bridges.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import {
  createId,
  type ConversationId,
  type ConversationTagId,
  type MacroId,
  type TeamId,
  type TicketId,
  type TicketStatusId,
} from '@quackback/ids'
import type { Actor } from '@/lib/server/policy/types'
import type { PermissionKey } from '@/lib/shared/permissions'

const session = vi.hoisted(() => ({ actor: null as unknown as Actor }))
const translation = vi.hoisted(() => ({ calls: 0 }))

vi.mock('@tanstack/react-start', async (importOriginal) => {
  const { withServerFnsInProcess } = await import('@/test/server-fns-in-process')
  return withServerFnsInProcess(await importOriginal<typeof import('@tanstack/react-start')>())
})

/** The session stand-in: the caller is `session.actor`, and a permission gate
 *  refuses exactly as the real one does when the actor lacks the key. */
vi.mock('@/lib/server/functions/auth-helpers', async () => {
  const { ForbiddenError } = await import('@/lib/shared/errors')
  const ctxFor = (actor: Actor) => ({
    principal: { id: actor.principalId, role: actor.role, type: 'user' },
    user: { id: 'user_stub', name: 'Ana', image: null },
    permissions: [...(actor.permissions ?? [])],
  })
  const check = (permission?: PermissionKey) => {
    if (permission && !session.actor.permissions?.has(permission)) {
      throw new ForbiddenError('FORBIDDEN', 'You do not have permission')
    }
  }
  return {
    requireAuth: async (opts?: { permission?: PermissionKey }) => {
      check(opts?.permission)
      return ctxFor(session.actor)
    },
    getOptionalAuth: async () => ctxFor(session.actor),
    hasAuthCredentials: () => true,
    policyActorFromAuth: async () => session.actor,
    assertPermission: (_ctx: unknown, permission: PermissionKey) => check(permission),
  }
})

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
vi.mock('@/lib/server/domains/conversation/conversation.webhooks', async () =>
  (await import('@/lib/server/__tests__/conversation-visibility-mocks')).conversationWebhookMocks()
)
vi.mock('@/lib/server/domains/conversation/conversation.notify', async () =>
  (await import('@/lib/server/__tests__/conversation-visibility-mocks')).notifyMocks()
)

/** Conversations are on, so the shared visitor and agent reads reach their
 *  visibility check instead of stopping at the feature gate. */
vi.mock('@/lib/server/domains/settings/settings.support', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/domains/settings/settings.support')>()),
  isConversationsEnabled: async () => true,
  isConversationsEnabledFor: async () => true,
}))

/** The reply translation is real, but counted: a hidden conversation must
 *  answer NotFound before it runs. */
vi.mock(
  '@/lib/server/domains/conversation/conversation-translation.service',
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import('@/lib/server/domains/conversation/conversation-translation.service')
      >()
    return {
      ...actual,
      resolveOutgoingReplyTranslation: async (
        ...args: Parameters<typeof actual.resolveOutgoingReplyTranslation>
      ) => {
        translation.calls++
        return actual.resolveOutgoingReplyTranslation(...args)
      },
    }
  }
)

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  MESSAGE_NOT_FOUND,
  NOT_FOUND,
  messagesOn,
  row,
  seedWorld as seedVisibilityWorld,
  suffix,
} from '@/lib/server/__tests__/conversation-visibility-world'
import {
  conversationAttributeDefinitions,
  conversationMessageFlags,
  conversationMessageReactions,
  conversationParticipants,
  conversations,
  conversationTagAssignments,
  conversationTags,
  eq,
  macros,
  ticketConversations,
  tickets,
  ticketStatuses,
} from '@/lib/server/db'
import {
  listConversationsFn,
  addConversationNoteFn,
  addConversationParticipantFn,
  addMessageReactionFn,
  assignConversationFn,
  bulkUpdateConversationsFn,
  captureVisitorContactEmailFn,
  createPostFromConversationFn,
  deleteConversationMessageFn,
  dismissInboxTranslationSuggestionFn,
  editConversationMessageFn,
  endConversationFn,
  exportConversationTranscriptFn,
  getConversationAssistantActivityFn,
  getConversationFn,
  getLinkedPostsForConversationFn,
  listConversationMessagesFn,
  listConversationParticipantsFn,
  markConversationReadFn,
  markConversationUnreadFromMessageFn,
  removeConversationParticipantFn,
  removeMessageReactionFn,
  restoreConversationFromSpamFn,
  sendAgentMessageFn,
  sendConversationTypingFn,
  setConversationPriorityFn,
  setConversationStatusFn,
  setInboxTranslationEnabledFn,
  setMessageFlagFn,
  sharePostFn,
  snoozeConversationFn,
  translateConversationMessagesFn,
} from '../conversation'
import { setConversationAttributeValueFn } from '../conversation-attributes'
import { listConversationFilesFn } from '../conversation-files'
import { addConversationTagFn, removeConversationTagFn } from '../conversation-tags'
import { getConversationTicketLinkFn } from '../inbox'
import { applyMacroFn } from '../macros'
import { removeConversationSlaFn } from '../sla'
import { assignConversationTeamFn } from '../teams'
import { createTicketFn, suggestTicketFieldValuesFn } from '../tickets'
import { previewWorkflowFn, runWorkflowManuallyFn } from '../workflows'
import { retryGitHubAgentMessageFn } from '@/integrations/github/server/functions'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: conversations.id }).from(conversations).limit(0)
    await db.select({ id: macros.id }).from(macros).limit(0)
  },
})

/** The world, with the scoped teammate signed in. */
async function seedWorld() {
  const w = await seedVisibilityWorld({ withOwnReply: true })
  session.actor = w.actor
  return w
}

type W = Awaited<ReturnType<typeof seedWorld>>
type C = Awaited<ReturnType<W['conversation']>>

describe('conversation server functions check visibility (real DB, rolled back)', () => {
  beforeEach(async () => {
    expect(fixture.available).toBe(true)
    translation.calls = 0
    await fixture.begin()
  })
  // Writers start fire-and-forget work (events, triage) after they return.
  // Let it settle inside this test's transaction, so it cannot land in the
  // next test's and abort it.
  afterEach(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50))
    await fixture.rollback()
  })
  afterAll(fixture.close)

  /**
   * Each entry: the call, and the NotFound shape it answers for a hidden
   * conversation. Every one also succeeds on a visible conversation, and the
   * hidden row and its thread stay as they were.
   */
  const calls: [string, (w: W, c: C) => Promise<unknown>, object?][] = [
    ['getConversationFn', (_, c) => getConversationFn({ data: { conversationId: c.id } })],
    [
      'listConversationMessagesFn',
      (_, c) => listConversationMessagesFn({ data: { conversationId: c.id } }),
    ],
    [
      'exportConversationTranscriptFn',
      (_, c) => exportConversationTranscriptFn({ data: { conversationId: c.id } }),
    ],
    [
      'markConversationReadFn',
      (_, c) => markConversationReadFn({ data: { conversationId: c.id } }),
    ],
    [
      'sendConversationTypingFn',
      (_, c) => sendConversationTypingFn({ data: { conversationId: c.id } }),
    ],
    [
      'editConversationMessageFn',
      (_, c) =>
        editConversationMessageFn({ data: { messageId: c.ownReplyId, content: 'Fixed it' } }),
      MESSAGE_NOT_FOUND,
    ],
    [
      'deleteConversationMessageFn',
      (_, c) => deleteConversationMessageFn({ data: { messageId: c.ownReplyId } }),
      MESSAGE_NOT_FOUND,
    ],
    [
      'getConversationAssistantActivityFn',
      (_, c) => getConversationAssistantActivityFn({ data: { conversationId: c.id } }),
    ],
    [
      'sendAgentMessageFn',
      (_, c) =>
        sendAgentMessageFn({
          data: { conversationId: c.id, content: 'Hello from Acme', skipTranslation: true },
        }),
    ],
    [
      'addConversationNoteFn',
      (_, c) => addConversationNoteFn({ data: { conversationId: c.id, content: 'Acme note' } }),
    ],
    [
      'captureVisitorContactEmailFn',
      (_, c) =>
        captureVisitorContactEmailFn({
          data: { conversationId: c.id, email: 'pat@example.com' },
        }),
    ],
    [
      'sharePostFn',
      (_, c) => sharePostFn({ data: { conversationId: c.id, postId: createId('post') as string } }),
    ],
    [
      'setConversationStatusFn',
      (_, c) => setConversationStatusFn({ data: { conversationId: c.id, status: 'closed' } }),
    ],
    [
      'snoozeConversationFn',
      (_, c) => snoozeConversationFn({ data: { conversationId: c.id, until: null } }),
    ],
    [
      'endConversationFn',
      (_, c) => endConversationFn({ data: { conversationId: c.id, reason: 'resolved' } }),
    ],
    [
      'assignConversationFn',
      (_, c) => assignConversationFn({ data: { conversationId: c.id, assignTo: 'me' } }),
    ],
    [
      'setConversationPriorityFn',
      (_, c) => setConversationPriorityFn({ data: { conversationId: c.id, priority: 'urgent' } }),
    ],
    [
      'assignConversationTeamFn',
      (w, c) => assignConversationTeamFn({ data: { conversationId: c.id, teamId: w.teamX } }),
    ],
    [
      'addMessageReactionFn',
      (_, c) => addMessageReactionFn({ data: { messageId: c.messageId, emoji: '👍' } }),
      MESSAGE_NOT_FOUND,
    ],
    [
      'removeMessageReactionFn',
      (_, c) => removeMessageReactionFn({ data: { messageId: c.messageId, emoji: '👍' } }),
      MESSAGE_NOT_FOUND,
    ],
    [
      'setMessageFlagFn',
      (_, c) => setMessageFlagFn({ data: { messageId: c.messageId, flagged: true } }),
      MESSAGE_NOT_FOUND,
    ],
    [
      'markConversationUnreadFromMessageFn',
      (_, c) =>
        markConversationUnreadFromMessageFn({
          data: { conversationId: c.id, messageId: c.messageId },
        }),
    ],
    [
      'addConversationParticipantFn',
      (_, c) =>
        addConversationParticipantFn({ data: { conversationId: c.id, email: 'pat@example.com' } }),
    ],
    [
      'removeConversationParticipantFn',
      (w, c) =>
        removeConversationParticipantFn({ data: { conversationId: c.id, principalId: w.visitor } }),
    ],
    [
      'listConversationParticipantsFn',
      (_, c) => listConversationParticipantsFn({ data: { conversationId: c.id } }),
    ],
    [
      'getLinkedPostsForConversationFn',
      (_, c) => getLinkedPostsForConversationFn({ data: { conversationId: c.id } }),
    ],
    [
      'translateConversationMessagesFn',
      (_, c) =>
        translateConversationMessagesFn({
          data: { conversationId: c.id, messageIds: [c.messageId] },
        }),
    ],
    [
      'setInboxTranslationEnabledFn',
      (_, c) => setInboxTranslationEnabledFn({ data: { conversationId: c.id, enabled: true } }),
    ],
    [
      'dismissInboxTranslationSuggestionFn',
      (_, c) => dismissInboxTranslationSuggestionFn({ data: { conversationId: c.id } }),
    ],
    [
      'getConversationTicketLinkFn',
      (_, c) => getConversationTicketLinkFn({ data: { conversationId: c.id } }),
    ],
    [
      'removeConversationSlaFn',
      (_, c) => removeConversationSlaFn({ data: { conversationId: c.id } }),
    ],
    [
      'listConversationFilesFn',
      (_, c) => listConversationFilesFn({ data: { conversationId: c.id } }),
    ],
    [
      'addConversationTagFn',
      (_, c) => addConversationTagFn({ data: { conversationId: c.id, name: `Acme ${suffix()}` } }),
    ],
    [
      'retryGitHubAgentMessageFn',
      (_, c) => retryGitHubAgentMessageFn({ data: { messageId: c.ownReplyId } }),
      MESSAGE_NOT_FOUND,
    ],
  ]

  it.each(calls)(
    '%s: NotFound for a hidden conversation, which stays as it was',
    async (_, call, notFound = NOT_FOUND) => {
      const w = await seedWorld()
      // The same channel as the visible case, so only scope tells them apart.
      const hidden = await w.conversation(w.teamY, { channel: 'github' })
      const before = await row(hidden.id)
      const thread = await messagesOn(hidden.id)
      await expect(call(w, hidden)).rejects.toMatchObject(notFound)
      expect(await row(hidden.id)).toEqual(before)
      expect(await messagesOn(hidden.id)).toEqual(thread)
      expect(await testDb.select().from(conversationParticipants)).toEqual([])
      expect(await testDb.select().from(conversationMessageReactions)).toEqual([])
      expect(await testDb.select().from(conversationMessageFlags)).toEqual([])
      expect(await testDb.select().from(conversationTagAssignments)).toEqual([])
    }
  )

  /** The calls that go on to reach an outside provider, which is not set up
   *  here; on a visible conversation they only have to get past the check. */
  const REACHES_A_PROVIDER = new Set(['retryGitHubAgentMessageFn'])

  it.each(calls)('%s: the same call on a visible conversation succeeds', async (name, call) => {
    const w = await seedWorld()
    const visible = await w.conversation(w.teamX, { channel: 'github' })
    const outcome = await call(w, visible).then(
      () => null,
      (err: { statusCode?: number; code?: string }) => err
    )
    if (REACHES_A_PROVIDER.has(name)) {
      expect(outcome?.statusCode).not.toBe(404)
      expect(outcome?.statusCode).not.toBe(403)
    } else {
      expect(outcome).toBeNull()
    }
  })

  it('a hidden conversation as the list cursor reads like an unknown one (relevance search)', async () => {
    const w = await seedWorld()
    const hour = 3_600_000
    const newer = await w.conversation(w.teamX, { lastMessageAt: new Date(Date.now() - hour) })
    const older = await w.conversation(w.teamX, { lastMessageAt: new Date(Date.now() - 2 * hour) })
    // The oldest match, so a cursor on it would leave nothing after it.
    const hidden = await w.conversation(w.teamY, {
      lastMessageAt: new Date(Date.now() - 30 * 24 * hour),
    })
    const page = (before?: string) =>
      listConversationsFn({ data: { search: 'Acme', sort: 'relevance', before } }).then((r) =>
        r.conversations.map((c: { id: string }) => c.id)
      )
    const first = await page()
    expect(first).toEqual(expect.arrayContaining([newer.id, older.id]))
    expect(first).not.toContain(hidden.id)
    expect(await page(hidden.id)).toEqual(first)
  })

  it('a reply to a hidden conversation is NotFound before it is translated, and stays unassigned', async () => {
    const w = await seedWorld()
    const hidden = await w.conversation(w.teamY)
    await expect(
      sendAgentMessageFn({ data: { conversationId: hidden.id, content: 'Hello from Acme' } })
    ).rejects.toMatchObject(NOT_FOUND)
    expect(translation.calls).toBe(0)
    expect((await row(hidden.id)).assignedAgentPrincipalId).toBeNull()
  })

  it('restore from spam: NotFound for a hidden conversation, which stays spam; works on a visible one', async () => {
    const w = await seedWorld()
    const hidden = await w.conversation(w.teamY, { status: 'closed', endReason: 'spam' })
    const visible = await w.conversation(w.teamX, { status: 'closed', endReason: 'spam' })
    await expect(
      restoreConversationFromSpamFn({ data: { conversationId: hidden.id } })
    ).rejects.toMatchObject(NOT_FOUND)
    expect((await row(hidden.id)).endReason).toBe('spam')
    await restoreConversationFromSpamFn({ data: { conversationId: visible.id } })
    expect((await row(visible.id)).endReason).not.toBe('spam')
  })

  it('ticket field suggestions for a hidden conversation are NotFound before any read', async () => {
    const w = await seedWorld()
    const hidden = await w.conversation(w.teamY)
    await expect(
      suggestTicketFieldValuesFn({
        data: { conversationId: hidden.id, ticketTypeId: createId('ticket_type') },
      })
    ).rejects.toMatchObject(NOT_FOUND)
  })

  it('an inline tag on a hidden conversation mints no tag', async () => {
    const w = await seedWorld()
    const hidden = await w.conversation(w.teamY)
    const name = `Acme ${suffix()}`
    await expect(
      addConversationTagFn({ data: { conversationId: hidden.id, name } })
    ).rejects.toMatchObject(NOT_FOUND)
    expect(
      await testDb.select().from(conversationTags).where(eq(conversationTags.name, name))
    ).toEqual([])
  })

  it('removing a tag from a hidden conversation is NotFound and the tag stays', async () => {
    const w = await seedWorld()
    const hidden = await w.conversation(w.teamY)
    const [tag] = await testDb
      .insert(conversationTags)
      .values({ name: `Acme ${suffix()}` })
      .returning()
    await testDb
      .insert(conversationTagAssignments)
      .values({ conversationId: hidden.id, conversationTagId: tag.id as ConversationTagId })
    await expect(
      removeConversationTagFn({ data: { conversationId: hidden.id, tagId: tag.id } })
    ).rejects.toMatchObject(NOT_FOUND)
    expect(await testDb.select().from(conversationTagAssignments)).toHaveLength(1)
  })

  it('a conversation attribute on a hidden conversation is NotFound and not written', async () => {
    const w = await seedWorld()
    const hidden = await w.conversation(w.teamY)
    const visible = await w.conversation(w.teamX)
    const key = `plan_${suffix()}`
    await testDb
      .insert(conversationAttributeDefinitions)
      .values({ key, label: 'Plan', fieldType: 'text' })
    await expect(
      setConversationAttributeValueFn({ data: { conversationId: hidden.id, key, value: 'Gold' } })
    ).rejects.toMatchObject(NOT_FOUND)
    expect((await row(hidden.id)).customAttributes ?? {}).toEqual({})
    await setConversationAttributeValueFn({
      data: { conversationId: visible.id, key, value: 'Gold' },
    })
    expect((await row(visible.id)).customAttributes).toHaveProperty(key)
  })

  it('a close of a hidden conversation missing a required field is NotFound, not the field names', async () => {
    const w = await seedWorld()
    const hidden = await w.conversation(w.teamY)
    await testDb.insert(conversationAttributeDefinitions).values({
      key: `reason_${suffix()}`,
      label: 'Close reason',
      fieldType: 'text',
      requiredToClose: true,
    })
    await expect(
      setConversationStatusFn({ data: { conversationId: hidden.id, status: 'closed' } })
    ).rejects.toMatchObject(NOT_FOUND)
    const bulk = await bulkUpdateConversationsFn({
      data: { conversationIds: [hidden.id], action: { type: 'close' } },
    })
    expect(bulk.failed).toEqual([{ id: hidden.id, reason: 'Conversation not found' }])
  })

  describe('bulk actions', () => {
    const actions = [
      { type: 'assign', assignTo: 'me' },
      { type: 'priority', priority: 'urgent' },
      { type: 'snooze', until: null },
      { type: 'close' },
      { type: 'reopen' },
      { type: 'restore_spam' },
      { type: 'delete_forever' },
    ] as const

    it.each(actions)(
      '$type: a hidden id fails like a missing id and stays unchanged',
      async (action) => {
        const w = await seedWorld()
        const hidden = await w.conversation(w.teamY, { status: 'closed', endReason: 'spam' })
        const missing = createId('conversation') as ConversationId
        const before = await row(hidden.id)
        const result = await bulkUpdateConversationsFn({
          data: { conversationIds: [hidden.id, missing], action },
        })
        expect(result.succeeded).toEqual([])
        expect(result.failed.map((f) => f.reason)).toEqual([
          'Conversation not found',
          'Conversation not found',
        ])
        expect(await row(hidden.id)).toEqual(before)
      }
    )

    it('tag: the visible id is tagged, the hidden id fails like a missing one and is not', async () => {
      const w = await seedWorld()
      const visible = await w.conversation(w.teamX)
      const hidden = await w.conversation(w.teamY)
      const missing = createId('conversation') as ConversationId
      const [tag] = await testDb
        .insert(conversationTags)
        .values({ name: `Acme ${suffix()}` })
        .returning()
      const result = await bulkUpdateConversationsFn({
        data: {
          conversationIds: [visible.id, hidden.id, missing],
          action: { type: 'tag', tagId: tag.id },
        },
      })
      expect(result.succeeded).toEqual([visible.id])
      expect(result.failed).toEqual([
        { id: hidden.id, reason: 'Conversation not found' },
        { id: missing, reason: 'Conversation not found' },
      ])
      const assigned = await testDb.select().from(conversationTagAssignments)
      expect(assigned.map((a) => a.conversationId)).toEqual([visible.id])
    })

    it('macro: the visible id gets the reply and actions, the hidden id gets nothing', async () => {
      const w = await seedWorld()
      const visible = await w.conversation(w.teamX)
      const hidden = await w.conversation(w.teamY)
      const macroId = createId('macro') as MacroId
      await testDb.insert(macros).values({
        id: macroId,
        name: 'Acme close',
        body: 'Thanks from Acme',
        actions: [{ type: 'set_priority', priority: 'urgent' }],
      })
      const result = await bulkUpdateConversationsFn({
        data: { conversationIds: [visible.id, hidden.id], action: { type: 'macro', macroId } },
      })
      expect(result.succeeded).toEqual([visible.id])
      expect(result.failed).toEqual([{ id: hidden.id, reason: 'Conversation not found' }])
      expect((await row(visible.id)).priority).toBe('urgent')
      const hiddenRow = await row(hidden.id)
      expect(hiddenRow.priority).not.toBe('urgent')
      expect(hiddenRow.assignedAgentPrincipalId).toBeNull()
      expect((await messagesOn(hidden.id)).map((m) => m.content)).not.toContain('Thanks from Acme')
    })
  })

  describe('macros', () => {
    async function seedMacro(actions: unknown[]) {
      const macroId = createId('macro') as MacroId
      await testDb
        .insert(macros)
        .values({ id: macroId, name: 'Acme', body: 'Hi from Acme', actions: actions as never })
      return macroId
    }

    it('applyMacroFn on a hidden conversation is NotFound and applies nothing', async () => {
      const w = await seedWorld()
      const hidden = await w.conversation(w.teamY)
      const macroId = await seedMacro([{ type: 'set_priority', priority: 'urgent' }])
      await expect(
        applyMacroFn({ data: { conversationId: hidden.id, macroId } })
      ).rejects.toMatchObject(NOT_FOUND)
      expect((await row(hidden.id)).priority).not.toBe('urgent')
    })

    it('applyMacroFn checks the conversation before it reads the macro or renders it', async () => {
      const w = await seedWorld()
      const hidden = await w.conversation(w.teamY)
      // A missing macro would otherwise answer first, with its own NotFound.
      await expect(
        applyMacroFn({ data: { conversationId: hidden.id, macroId: createId('macro') } })
      ).rejects.toMatchObject(NOT_FOUND)
    })

    it('a macro that moves the conversation to another team still finishes, then the teammate is out', async () => {
      const w = await seedWorld()
      const visible = await w.conversation(w.teamX)
      const macroId = await seedMacro([
        { type: 'assign_team', teamId: w.teamY },
        { type: 'set_priority', priority: 'high' },
        { type: 'snooze', preset: 'until_reply' },
      ])
      const result = await applyMacroFn({ data: { conversationId: visible.id, macroId } })
      expect(result.applied).toHaveLength(3)
      const after = await row(visible.id)
      expect(after.assignedTeamId).toBe(w.teamY)
      expect(after.priority).toBe('high')
      expect(after.status).toBe('snoozed')
      await expect(
        setConversationPriorityFn({ data: { conversationId: visible.id, priority: 'low' } })
      ).rejects.toMatchObject(NOT_FOUND)
    })
  })

  describe('workflows', () => {
    it('a manual run and a preview on a hidden conversation are NotFound', async () => {
      const w = await seedWorld()
      const hidden = await w.conversation(w.teamY)
      const workflowId = createId('workflow')
      await expect(
        runWorkflowManuallyFn({ data: { workflowId, conversationId: hidden.id } })
      ).rejects.toMatchObject(NOT_FOUND)
      await expect(
        previewWorkflowFn({ data: { workflowId, conversationId: hidden.id } })
      ).rejects.toMatchObject(NOT_FOUND)
    })

    it('on a visible conversation they get past the check (an unknown workflow is not live)', async () => {
      const w = await seedWorld()
      const visible = await w.conversation(w.teamX)
      const workflowId = createId('workflow')
      await expect(
        runWorkflowManuallyFn({ data: { workflowId, conversationId: visible.id } })
      ).resolves.toEqual({ ok: false, reason: 'not_live' })
    })
  })

  describe('createPostFromConversationFn', () => {
    it('is NotFound for a hidden conversation, and reaches the board check for a visible one', async () => {
      const w = await seedWorld()
      const hidden = await w.conversation(w.teamY)
      const visible = await w.conversation(w.teamX)
      const boardId = createId('board')
      await expect(
        createPostFromConversationFn({
          data: { conversationId: hidden.id, boardId, title: 'Acme idea' },
        })
      ).rejects.toMatchObject(NOT_FOUND)
      const outcome = await createPostFromConversationFn({
        data: { conversationId: visible.id, boardId, title: 'Acme idea' },
      }).then(
        () => null,
        (err: { code?: string }) => err
      )
      expect(outcome?.code).not.toBe('CONVERSATION_NOT_FOUND')
    })
  })

  describe('a conversation with a paired ticket', () => {
    async function seedPair(w: W, conversationTeam: TeamId) {
      const statusId = createId('ticket_status') as TicketStatusId
      await testDb
        .insert(ticketStatuses)
        .values({ id: statusId, name: 'Acme open', slug: `cvf-${suffix()}`, isDefault: true })
      const ticketId = createId('ticket') as TicketId
      await testDb.insert(tickets).values({
        id: ticketId,
        title: 'Acme pair',
        statusId,
        type: 'customer',
        assigneeTeamId: conversationTeam,
        requesterPrincipalId: w.visitor,
      })
      const conversation = await w.conversation(conversationTeam)
      await testDb
        .insert(ticketConversations)
        .values({ ticketId, conversationId: conversation.id, ticketType: 'customer' })
      return { ticketId, conversation }
    }

    it('getConversationTicketLinkFn is NotFound for a hidden conversation, never "hidden ticket"', async () => {
      const w = await seedWorld()
      const pair = await seedPair(w, w.teamY)
      await expect(
        getConversationTicketLinkFn({ data: { conversationId: pair.conversation.id } })
      ).rejects.toMatchObject(NOT_FOUND)
    })

    it('createTicketFn is NotFound for a hidden conversation, never "already has a ticket"', async () => {
      const w = await seedWorld()
      const pair = await seedPair(w, w.teamY)
      const before = await testDb.select().from(tickets)
      await expect(
        createTicketFn({
          data: { title: 'Acme second', type: 'customer', conversationId: pair.conversation.id },
        })
      ).rejects.toMatchObject(NOT_FOUND)
      expect(await testDb.select().from(tickets)).toHaveLength(before.length)
    })

    it('createTicketFn on a visible conversation with a pair still says it already has one', async () => {
      const w = await seedWorld()
      const pair = await seedPair(w, w.teamX)
      await expect(
        createTicketFn({
          data: { title: 'Acme second', type: 'customer', conversationId: pair.conversation.id },
        })
      ).rejects.toMatchObject({ code: 'ALREADY_LINKED' })
    })

    it('createTicketFn on a hidden conversation without a pair creates no ticket', async () => {
      const w = await seedWorld()
      const hidden = await w.conversation(w.teamY)
      const before = await testDb.select().from(tickets)
      await expect(
        createTicketFn({
          data: { title: 'Acme task', type: 'back_office', conversationId: hidden.id },
        })
      ).rejects.toMatchObject(NOT_FOUND)
      expect(await testDb.select().from(tickets)).toHaveLength(before.length)
    })
  })
})
