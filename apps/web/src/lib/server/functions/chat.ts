/**
 * Server functions for live chat.
 *
 * Visitor-facing functions (send / read own thread) accept either the portal
 * cookie or the widget Bearer token — the better-auth bearer plugin resolves
 * both transparently, so a single set of endpoints serves portal and widget.
 * Agent-facing functions are gated to team roles and re-checked independently
 * of the admin route guard.
 */
import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import type {
  ConversationId,
  ChatMessageId,
  PrincipalId,
  PostId,
  BoardId,
  TagId,
} from '@quackback/ids'
import {
  MAX_CHAT_MESSAGE_LENGTH,
  MAX_CHAT_ATTACHMENTS,
  type ChatSenderType,
  type ChatAttachment,
} from '@/lib/shared/chat/types'
import { isWithinOfficeHours } from '@/lib/shared/chat/office-hours'
import {
  getOptionalAuth,
  requireAuth,
  policyActorFromAuth,
  hasAuthCredentials,
} from './auth-helpers'
import { isTeamMember } from '@/lib/shared/roles'

const attachmentSchema = z.object({
  url: z.string().min(1),
  name: z.string().max(255),
  contentType: z.string().max(128),
  size: z.number().int().nonnegative(),
})

// Content may be empty only when attachments are present (validated in the
// service); allow empty here and let the service enforce the real rule.
const sendMessageSchema = z.object({
  conversationId: z.string().optional(),
  content: z.string().max(MAX_CHAT_MESSAGE_LENGTH).default(''),
  attachments: z.array(attachmentSchema).max(MAX_CHAT_ATTACHMENTS).optional(),
  /** Optional pre-chat email capture (anonymous visitors). */
  visitorEmail: z.string().email().max(320).optional(),
})

const conversationIdSchema = z.object({ conversationId: z.string() })

const listMessagesSchema = z.object({
  conversationId: z.string(),
  before: z.string().optional(),
})

const listConversationsSchema = z.object({
  status: z.enum(['open', 'snoozed', 'closed']).optional(),
  assignedToMe: z.boolean().optional(),
  search: z.string().max(200).optional(),
  tagId: z.string().optional(),
  before: z.string().optional(),
})

const setTagsSchema = z.object({
  conversationId: z.string(),
  tagIds: z.array(z.string()).max(20),
})

const messageIdSchema = z.object({ messageId: z.string() })

const csatSchema = z.object({
  conversationId: z.string(),
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(2000).optional(),
})

const agentSendSchema = z.object({
  conversationId: z.string(),
  content: z.string().max(MAX_CHAT_MESSAGE_LENGTH).default(''),
  attachments: z.array(attachmentSchema).max(MAX_CHAT_ATTACHMENTS).optional(),
})

const agentNoteSchema = z.object({
  conversationId: z.string(),
  content: z.string().min(1).max(MAX_CHAT_MESSAGE_LENGTH),
})

const setStatusSchema = z.object({
  conversationId: z.string(),
  status: z.enum(['open', 'snoozed', 'closed']),
})

const assignSchema = z.object({
  conversationId: z.string(),
  /** null / omitted = unassign; 'me' = assign to the current agent. */
  assignTo: z.union([z.literal('me'), z.null()]).optional(),
})

async function assertChatEnabled(): Promise<void> {
  const { isLiveChatEnabled } = await import('@/lib/server/domains/settings/settings.widget')
  if (!(await isLiveChatEnabled())) {
    throw new Error('Live chat is not enabled')
  }
}

/**
 * Shared gate for every visitor-facing chat endpoint: chat must be enabled AND
 * the caller must have portal access. Team members (agents) bypass the portal
 * check — they reach these endpoints from the admin inbox. Throws on failure.
 */
async function assertVisitorChatAccess(role: string | null): Promise<void> {
  await assertChatEnabled()
  if (isTeamMember(role)) return
  const { resolvePortalAccessForRequest } = await import('./portal-access')
  const access = await resolvePortalAccessForRequest()
  if (!access.granted) throw new Error('Portal access required')
}

// ── Visitor functions ────────────────────────────────────────────────────

/** Send a visitor message; creates the conversation on the first message. */
export const sendChatMessageFn = createServerFn({ method: 'POST' })
  .inputValidator(sendMessageSchema)
  .handler(async ({ data }) => {
    try {
      const ctx = await requireAuth({ roles: ['admin', 'member', 'user'] })
      await assertVisitorChatAccess(ctx.principal.role)

      // Throttle per principal: bounds write/notify fanout and runaway
      // conversation creation. Agents (team) send via sendAgentMessageFn.
      if (!isTeamMember(ctx.principal.role)) {
        const { assertChatSendRate } = await import('@/lib/server/domains/chat/chat.ratelimit')
        await assertChatSendRate(ctx.principal.id)

        // Enforce required pre-chat email server-side (the widget gates the
        // button, but a direct call must not bypass it): only on the first
        // message of a new conversation, for a visitor with no email on file.
        if (!data.conversationId && !data.visitorEmail && !ctx.user?.email) {
          const { getLiveChatConfig } =
            await import('@/lib/server/domains/settings/settings.widget')
          const { preChatEmail } = await getLiveChatConfig()
          if (preChatEmail === 'required') {
            throw new Error('An email is required to start a conversation')
          }
        }
      }

      const actor = await policyActorFromAuth(ctx)

      const { sendVisitorMessage } = await import('@/lib/server/domains/chat/chat.service')
      return await sendVisitorMessage(
        {
          conversationId: data.conversationId as ConversationId | undefined,
          content: data.content,
          attachments: data.attachments as ChatAttachment[] | undefined,
          visitorEmail: data.visitorEmail,
        },
        {
          principalId: ctx.principal.id,
          displayName: ctx.user.name,
          avatarUrl: ctx.user.image,
          email: ctx.user.email,
        },
        actor
      )
    } catch (error) {
      console.error('[fn:chat] sendChatMessageFn failed:', error)
      throw error
    }
  })

/**
 * Lightweight presence read for polling: agent-online state + the office-hours
 * verdict, WITHOUT loading the conversation or messages. The widget polls this
 * so the online/offline indicator stays fresh (e.g. agents going offline
 * between messages) without re-fetching the whole thread.
 */
export const getChatPresenceFn = createServerFn({ method: 'GET' }).handler(async () => {
  const { getLiveChatConfig } = await import('@/lib/server/domains/settings/settings.widget')
  const { isAnyAgentOnline } = await import('@/lib/server/realtime/presence')
  const [chatConfig, agentsOnline] = await Promise.all([getLiveChatConfig(), isAnyAgentOnline()])
  const officeHours = chatConfig.officeHours
  return {
    agentsOnline,
    withinOfficeHours: officeHours?.enabled ? isWithinOfficeHours(officeHours, new Date()) : null,
  }
})

/** The current visitor's active conversation + first page of messages. */
export const getMyChatFn = createServerFn({ method: 'GET' }).handler(async () => {
  try {
    const { getLiveChatConfig, isLiveChatEnabled } =
      await import('@/lib/server/domains/settings/settings.widget')
    const [enabled, chatConfig] = await Promise.all([isLiveChatEnabled(), getLiveChatConfig()])
    const officeHours = chatConfig.officeHours
    const base = {
      enabled,
      welcomeMessage: chatConfig.welcomeMessage ?? null,
      offlineMessage: chatConfig.offlineMessage ?? null,
      teamName: chatConfig.teamName ?? null,
      preChatEmail: chatConfig.preChatEmail ?? 'off',
      // null = no office-hours schedule configured; the widget falls back to
      // live agent presence. true/false = the schedule's current verdict.
      withinOfficeHours: officeHours?.enabled ? isWithinOfficeHours(officeHours, new Date()) : null,
      // Whether we already have a contact email — the widget skips the pre-chat
      // prompt when true.
      visitorHasEmail: false,
    }

    if (!enabled || !hasAuthCredentials()) {
      return { ...base, conversation: null, messages: [], hasMore: false, agentsOnline: false }
    }

    const ctx = await getOptionalAuth()
    if (!ctx?.principal) {
      return { ...base, conversation: null, messages: [], hasMore: false, agentsOnline: false }
    }

    // Gate reads behind portal access for non-team callers (degrade gracefully
    // to the greeting-only state rather than throwing on the bootstrap path).
    if (!isTeamMember(ctx.principal.role)) {
      const { resolvePortalAccessForRequest } = await import('./portal-access')
      const access = await resolvePortalAccessForRequest()
      if (!access.granted) {
        return { ...base, conversation: null, messages: [], hasMore: false, agentsOnline: false }
      }
    }

    const { getActiveConversationForVisitor, conversationToDTO, listMessages } =
      await import('@/lib/server/domains/chat/chat.query')
    const { isAnyAgentOnline } = await import('@/lib/server/realtime/presence')

    const [conversation, agentsOnline] = await Promise.all([
      getActiveConversationForVisitor(ctx.principal.id),
      isAnyAgentOnline(),
    ])
    const visitorHasEmail = Boolean(ctx.user?.email) || Boolean(conversation?.visitorEmail)
    if (!conversation) {
      return {
        ...base,
        visitorHasEmail,
        conversation: null,
        messages: [],
        hasMore: false,
        agentsOnline,
      }
    }

    const [dto, page] = await Promise.all([
      conversationToDTO(conversation, 'visitor'),
      listMessages(conversation.id),
    ])
    return {
      ...base,
      visitorHasEmail,
      conversation: dto,
      messages: page.messages,
      hasMore: page.hasMore,
      agentsOnline,
    }
  } catch (error) {
    console.error('[fn:chat] getMyChatFn failed:', error)
    throw error
  }
})

/** Older messages for a conversation the caller can view (keyset pagination). */
export const listChatMessagesFn = createServerFn({ method: 'GET' })
  .inputValidator(listMessagesSchema)
  .handler(async ({ data }) => {
    try {
      const ctx = await requireAuth({ roles: ['admin', 'member', 'user'] })
      await assertVisitorChatAccess(ctx.principal.role)
      const actor = await policyActorFromAuth(ctx)
      const { assertConversationViewable } = await import('@/lib/server/domains/chat/chat.service')
      const { listMessages } = await import('@/lib/server/domains/chat/chat.query')
      await assertConversationViewable(data.conversationId as ConversationId, actor)
      // Agents keep seeing internal notes when paging older messages; visitors never do.
      return await listMessages(data.conversationId as ConversationId, {
        before: data.before,
        includeInternal: isTeamMember(ctx.principal.role),
      })
    } catch (error) {
      console.error('[fn:chat] listChatMessagesFn failed:', error)
      throw error
    }
  })

/** Mark a conversation read up to now for the caller's side. */
export const markChatReadFn = createServerFn({ method: 'POST' })
  .inputValidator(conversationIdSchema)
  .handler(async ({ data }) => {
    try {
      const ctx = await requireAuth({ roles: ['admin', 'member', 'user'] })
      await assertVisitorChatAccess(ctx.principal.role)
      const actor = await policyActorFromAuth(ctx)
      const side: ChatSenderType = isTeamMember(ctx.principal.role) ? 'agent' : 'visitor'
      const { markConversationRead } = await import('@/lib/server/domains/chat/chat.service')
      await markConversationRead(data.conversationId as ConversationId, side, actor)
      return { ok: true }
    } catch (error) {
      console.error('[fn:chat] markChatReadFn failed:', error)
      throw error
    }
  })

/** Broadcast that the caller is typing (ephemeral; client-throttled). */
export const sendChatTypingFn = createServerFn({ method: 'POST' })
  .inputValidator(conversationIdSchema)
  .handler(async ({ data }) => {
    try {
      const ctx = await requireAuth({ roles: ['admin', 'member', 'user'] })
      await assertVisitorChatAccess(ctx.principal.role)
      const actor = await policyActorFromAuth(ctx)
      const side: ChatSenderType = isTeamMember(ctx.principal.role) ? 'agent' : 'visitor'
      const { signalTyping } = await import('@/lib/server/domains/chat/chat.service')
      await signalTyping(data.conversationId as ConversationId, side, actor)
      return { ok: true }
    } catch (error) {
      console.error('[fn:chat] sendChatTypingFn failed:', error)
      throw error
    }
  })

/** Submit a CSAT rating for a conversation (visitor only). */
export const submitCsatFn = createServerFn({ method: 'POST' })
  .inputValidator(csatSchema)
  .handler(async ({ data }) => {
    try {
      const ctx = await requireAuth({ roles: ['admin', 'member', 'user'] })
      await assertVisitorChatAccess(ctx.principal.role)
      const actor = await policyActorFromAuth(ctx)
      const { recordCsat } = await import('@/lib/server/domains/chat/chat.service')
      await recordCsat(data.conversationId as ConversationId, data.rating, data.comment, actor)
      return { ok: true }
    } catch (error) {
      console.error('[fn:chat] submitCsatFn failed:', error)
      throw error
    }
  })

/** Mint a short-lived token authorizing this principal's SSE stream. */
export const mintChatStreamTokenFn = createServerFn({ method: 'GET' }).handler(async () => {
  try {
    const ctx = await requireAuth({ roles: ['admin', 'member', 'user'] })
    await assertVisitorChatAccess(ctx.principal.role)
    const { mintStreamToken } = await import('@/lib/server/realtime/stream-token')
    return { token: mintStreamToken(ctx.principal.id) }
  } catch (error) {
    console.error('[fn:chat] mintChatStreamTokenFn failed:', error)
    throw error
  }
})

/** Soft-delete a message (team members; or a visitor deleting their own). */
export const deleteChatMessageFn = createServerFn({ method: 'POST' })
  .inputValidator(messageIdSchema)
  .handler(async ({ data }) => {
    try {
      const ctx = await requireAuth({ roles: ['admin', 'member', 'user'] })
      await assertVisitorChatAccess(ctx.principal.role)
      const actor = await policyActorFromAuth(ctx)
      const { deleteChatMessage } = await import('@/lib/server/domains/chat/chat.service')
      await deleteChatMessage(data.messageId as ChatMessageId, actor)
      return { ok: true }
    } catch (error) {
      console.error('[fn:chat] deleteChatMessageFn failed:', error)
      throw error
    }
  })

// ── Agent functions ──────────────────────────────────────────────────────

/** Saved replies for the agent composer (team-gated; agent-only, not public). */
export const getCannedRepliesFn = createServerFn({ method: 'GET' }).handler(async () => {
  try {
    await requireAuth({ roles: ['admin', 'member'] })
    const { getLiveChatConfig } = await import('@/lib/server/domains/settings/settings.widget')
    const chat = await getLiveChatConfig()
    return { cannedReplies: chat.cannedReplies ?? [] }
  } catch (error) {
    console.error('[fn:chat] getCannedRepliesFn failed:', error)
    throw error
  }
})

/** Inbox feed for the support team. */
export const listConversationsFn = createServerFn({ method: 'GET' })
  .inputValidator(listConversationsSchema)
  .handler(async ({ data }) => {
    try {
      const ctx = await requireAuth({ roles: ['admin', 'member'] })
      const { listConversationsForAgent } = await import('@/lib/server/domains/chat/chat.query')
      return await listConversationsForAgent({
        status: data.status,
        assignedAgentPrincipalId: data.assignedToMe ? ctx.principal.id : undefined,
        search: data.search,
        tagId: data.tagId as TagId | undefined,
        before: data.before,
      })
    } catch (error) {
      console.error('[fn:chat] listConversationsFn failed:', error)
      throw error
    }
  })

/** A single conversation (agent view) + first page of messages. */
export const getConversationFn = createServerFn({ method: 'GET' })
  .inputValidator(listMessagesSchema)
  .handler(async ({ data }) => {
    try {
      const ctx = await requireAuth({ roles: ['admin', 'member'] })
      const actor = await policyActorFromAuth(ctx)
      const { assertConversationViewable } = await import('@/lib/server/domains/chat/chat.service')
      const { conversationToDTO, listMessages } =
        await import('@/lib/server/domains/chat/chat.query')
      const conversation = await assertConversationViewable(
        data.conversationId as ConversationId,
        actor
      )
      const [dto, page] = await Promise.all([
        conversationToDTO(conversation, 'agent'),
        // Agents see internal notes inline.
        listMessages(conversation.id, { before: data.before, includeInternal: true }),
      ])
      return { conversation: dto, messages: page.messages, hasMore: page.hasMore }
    } catch (error) {
      console.error('[fn:chat] getConversationFn failed:', error)
      throw error
    }
  })

/** Agent reply. */
export const sendAgentMessageFn = createServerFn({ method: 'POST' })
  .inputValidator(agentSendSchema)
  .handler(async ({ data }) => {
    try {
      const ctx = await requireAuth({ roles: ['admin', 'member'] })
      const actor = await policyActorFromAuth(ctx)
      const { sendAgentMessage } = await import('@/lib/server/domains/chat/chat.service')
      return await sendAgentMessage(
        data.conversationId as ConversationId,
        data.content,
        {
          principalId: ctx.principal.id,
          displayName: ctx.user.name,
          avatarUrl: ctx.user.image,
        },
        actor,
        data.attachments as ChatAttachment[] | undefined
      )
    } catch (error) {
      console.error('[fn:chat] sendAgentMessageFn failed:', error)
      throw error
    }
  })

/** Add an agent-only internal note (never sent to the visitor). */
export const addChatNoteFn = createServerFn({ method: 'POST' })
  .inputValidator(agentNoteSchema)
  .handler(async ({ data }) => {
    try {
      const ctx = await requireAuth({ roles: ['admin', 'member'] })
      const actor = await policyActorFromAuth(ctx)
      const { addAgentNote } = await import('@/lib/server/domains/chat/chat.service')
      return await addAgentNote(
        data.conversationId as ConversationId,
        data.content,
        {
          principalId: ctx.principal.id,
          displayName: ctx.user.name,
          avatarUrl: ctx.user.image,
        },
        actor
      )
    } catch (error) {
      console.error('[fn:chat] addChatNoteFn failed:', error)
      throw error
    }
  })

const convertSchema = z.object({
  conversationId: z.string(),
  boardId: z.string(),
  title: z.string().max(200).optional(),
  content: z.string().max(10000).optional(),
  asUpvoteOfPostId: z.string().optional(),
})

/** Convert a conversation into a feedback post (create new, or upvote existing). */
export const convertChatToPostFn = createServerFn({ method: 'POST' })
  .inputValidator(convertSchema)
  .handler(async ({ data }) => {
    try {
      const ctx = await requireAuth({ roles: ['admin', 'member'] })
      const actor = await policyActorFromAuth(ctx)
      const { convertConversationToPost } = await import('@/lib/server/domains/chat/chat.convert')
      return await convertConversationToPost(
        {
          conversationId: data.conversationId as ConversationId,
          boardId: data.boardId as BoardId,
          title: data.title,
          content: data.content,
          asUpvoteOfPostId: data.asUpvoteOfPostId as PostId | undefined,
        },
        { agentActor: actor, agentPrincipalId: ctx.principal.id }
      )
    } catch (error) {
      console.error('[fn:chat] convertChatToPostFn failed:', error)
      throw error
    }
  })

export const setConversationStatusFn = createServerFn({ method: 'POST' })
  .inputValidator(setStatusSchema)
  .handler(async ({ data }) => {
    try {
      const ctx = await requireAuth({ roles: ['admin', 'member'] })
      const actor = await policyActorFromAuth(ctx)
      const { setConversationStatus } = await import('@/lib/server/domains/chat/chat.service')
      await setConversationStatus(data.conversationId as ConversationId, data.status, actor)
      return { ok: true }
    } catch (error) {
      console.error('[fn:chat] setConversationStatusFn failed:', error)
      throw error
    }
  })

export const assignConversationFn = createServerFn({ method: 'POST' })
  .inputValidator(assignSchema)
  .handler(async ({ data }) => {
    try {
      const ctx = await requireAuth({ roles: ['admin', 'member'] })
      const actor = await policyActorFromAuth(ctx)
      const { assignConversation } = await import('@/lib/server/domains/chat/chat.service')
      const assignTo: PrincipalId | null = data.assignTo === 'me' ? ctx.principal.id : null
      await assignConversation(data.conversationId as ConversationId, assignTo, actor)
      return { ok: true }
    } catch (error) {
      console.error('[fn:chat] assignConversationFn failed:', error)
      throw error
    }
  })

/** Replace a conversation's labels (agent-only). */
export const setConversationTagsFn = createServerFn({ method: 'POST' })
  .inputValidator(setTagsSchema)
  .handler(async ({ data }) => {
    try {
      const ctx = await requireAuth({ roles: ['admin', 'member'] })
      const actor = await policyActorFromAuth(ctx)
      const { setConversationTags } = await import('@/lib/server/domains/chat/chat.service')
      return await setConversationTags(
        data.conversationId as ConversationId,
        data.tagIds as TagId[],
        actor
      )
    } catch (error) {
      console.error('[fn:chat] setConversationTagsFn failed:', error)
      throw error
    }
  })
