/**
 * Server functions for the support inbox: the live-chat widget channel plus agent-side inbox operations.
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
  ChatTagId,
  SegmentId,
} from '@quackback/ids'
import {
  MAX_CHAT_MESSAGE_LENGTH,
  MAX_CHAT_ATTACHMENTS,
  type ChatSenderType,
  type ChatAttachment,
} from '@/lib/shared/chat/types'
import { officeHoursSnapshot } from '@/lib/shared/chat/office-hours'
import type { ChatPresence } from '@/lib/shared/chat/presence'
import { realEmail } from '@/lib/shared/anonymous-email'
import {
  CONVERSATION_STATUSES,
  CONVERSATION_END_REASONS,
  REACTION_EMOJIS,
} from '@/lib/shared/db-types'
import {
  getOptionalAuth,
  requireAuth,
  policyActorFromAuth,
  hasAuthCredentials,
  type AuthContext,
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
  // Rich-composer TipTap doc (inline embeds / images). Sanitized server-side;
  // the plain `content` is the doc's text, kept for previews/notifications/search.
  contentJson: z.unknown().nullable().optional(),
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
  status: z.enum(CONVERSATION_STATUSES).optional(),
  priority: z.enum(['none', 'low', 'medium', 'high', 'urgent']).optional(),
  // Assignee queue: 'mine' = assigned to the requesting agent, 'unassigned' =
  // no agent yet, 'all'/omitted = no assignee constraint.
  assignee: z.enum(['all', 'mine', 'unassigned']).optional(),
  search: z.string().max(200).optional(),
  // Filter to conversations carrying ANY of these labels.
  tagIds: z.array(z.string()).optional(),
  // Filter to conversations whose visitor is a member of ANY of these segments.
  segmentIds: z.array(z.string()).optional(),
  // 'mentions' = only conversations whose internal notes @-mention the
  // requesting agent (the principal is resolved server-side from auth).
  view: z.enum(['all', 'mentions']).optional(),
  before: z.string().optional(),
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
  // Rich-composer TipTap doc (inline embeds / images). Sanitized server-side;
  // the plain `content` is the doc's text, kept for previews/notifications/search.
  contentJson: z.unknown().nullable().optional(),
  attachments: z.array(attachmentSchema).max(MAX_CHAT_ATTACHMENTS).optional(),
})

const agentNoteSchema = z.object({
  conversationId: z.string(),
  content: z.string().min(1).max(MAX_CHAT_MESSAGE_LENGTH),
  // TipTap doc from the note editor (carries @-mention nodes). Validated +
  // mention-extracted server-side; omitted for a plain-text note.
  contentJson: z.unknown().nullable().optional(),
  // Image/file attachments on the note (agent-only, same pipeline as replies).
  attachments: z.array(attachmentSchema).max(MAX_CHAT_ATTACHMENTS).optional(),
})

const setStatusSchema = z.object({
  conversationId: z.string(),
  status: z.enum(CONVERSATION_STATUSES),
})

const endConversationSchema = z.object({
  conversationId: z.string(),
  reason: z.enum(CONVERSATION_END_REASONS),
  note: z.string().max(2000).optional(),
})

const assignSchema = z.object({
  conversationId: z.string(),
  /** null/omitted = unassign; 'me' = the current agent; otherwise a team
   *  member's principal id (validated server-side). */
  assignTo: z.union([z.string(), z.null()]).optional(),
})

const setPrioritySchema = z.object({
  conversationId: z.string(),
  priority: z.enum(['none', 'low', 'medium', 'high', 'urgent']),
})

const messageReactionSchema = z.object({
  messageId: z.string(),
  // Server-side allowlist: reactions are restricted to the curated set so a
  // direct API call can't store arbitrary unicode.
  emoji: z
    .string()
    .refine((e) => (REACTION_EMOJIS as readonly string[]).includes(e), 'Unsupported reaction'),
})

const messageFlagSchema = z.object({
  messageId: z.string(),
  flagged: z.boolean(),
})

const markUnreadFromMessageSchema = z.object({
  conversationId: z.string(),
  messageId: z.string(),
})

async function assertLiveChatEnabled(): Promise<void> {
  const { isLiveChatEnabled } = await import('@/lib/server/domains/settings/settings.widget')
  if (!(await isLiveChatEnabled())) {
    throw new Error('Chat is not enabled')
  }
}

/**
 * Shared gate for every visitor-facing chat endpoint: chat must be enabled AND
 * the caller must have portal access. Team members (agents) bypass the portal
 * check — they reach these endpoints from the admin inbox. Throws on failure.
 */
async function assertVisitorChatAccess(role: string | null): Promise<void> {
  await assertLiveChatEnabled()
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
        if (!data.conversationId && !data.visitorEmail && !realEmail(ctx.user?.email)) {
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
        actor,
        (data.contentJson ?? null) as import('@/lib/shared/db-types').TiptapContent | null
      )
    } catch (error) {
      console.error('[fn:chat] sendChatMessageFn failed:', error)
      throw error
    }
  })

/**
 * The team's availability verdict (live presence + office-hours snapshot),
 * WITHOUT loading the conversation or messages. Tenant-global — no visitor auth
 * needed. The widget polls this to keep the online/offline indicator fresh, and
 * the widget loader calls it server-side to SSR-seed the same value so the first
 * paint matches what the poll reports.
 *
 * The Redis/DB reads stay INSIDE the handler so the server-fn transform strips
 * them — and their transitive `ioredis` import — from the client bundle. A plain
 * exported helper holding these dynamic imports would leak ioredis client-side
 * and break the build, so callers (incl. the loader) must go through this fn.
 */
export const getChatPresenceFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<ChatPresence> => {
    const { getLiveChatConfig } = await import('@/lib/server/domains/settings/settings.widget')
    const { isAnyAgentAvailable } = await import('@/lib/server/realtime/presence')
    const [liveChatConfig, agentsOnline] = await Promise.all([
      getLiveChatConfig(),
      isAnyAgentAvailable(),
    ])
    return {
      agentsOnline,
      // withinOfficeHours + (when closed) the ISO instant we're next back.
      ...officeHoursSnapshot(liveChatConfig.officeHours, new Date()),
    }
  }
)

// getMyChat optionally targets a specific conversation:
//  - omitted        → the visitor's active/most-recent thread (default)
//  - a conversation → that thread, if the caller owns it (else greeting state)
//  - null           → "new": config + greeting with no thread
const myChatSchema = z.object({ conversationId: z.string().nullish() }).optional()

/** The current visitor's active conversation + first page of messages. */
export const getMyChatFn = createServerFn({ method: 'GET' })
  .inputValidator(myChatSchema)
  .handler(async ({ data }) => {
    try {
      const { getLiveChatConfig, isLiveChatEnabled } =
        await import('@/lib/server/domains/settings/settings.widget')
      const { getSettings } = await import('./workspace')
      const { isEmailConfigured } = await import('@quackback/email')
      const { canEmailVisitor } = await import('@/lib/shared/chat/reply-capability')
      const [enabled, liveChatConfig, appSettings] = await Promise.all([
        isLiveChatEnabled(),
        getLiveChatConfig(),
        getSettings(),
      ])
      const preChatEmail = liveChatConfig.preChatEmail ?? 'off'
      const emailConfigured = isEmailConfigured()
      // Note: team-availability presence is NOT returned here. The widget reads it
      // from the shared useChatPresence query (getChatPresenceFn) so every surface
      // agrees and only one poll runs — this fn is just the visitor's thread.
      const base = {
        enabled,
        welcomeMessage: liveChatConfig.welcomeMessage ?? null,
        offlineMessage: liveChatConfig.offlineMessage ?? null,
        // Falls back to the workspace name (as the settings help text promises)
        // when no team name is set.
        teamName: liveChatConfig.teamName?.trim() || appSettings?.name || null,
        preChatEmail,
        // Whether we already have a contact email — the widget skips the pre-chat
        // prompt when true.
        visitorHasEmail: false,
        // Whether an offline reply could actually reach this visitor by email —
        // the widget shows a non-promising offline message when false.
        canEmailVisitor: canEmailVisitor({ emailConfigured, preChatEmail, visitorHasEmail: false }),
        // Whether the surfaced conversation is closed (read-only) — the widget
        // then offers "start a new conversation" instead of a composer (P1.9).
        isReadOnly: false,
      }

      if (!enabled || !hasAuthCredentials()) {
        return { ...base, conversation: null, messages: [], hasMore: false }
      }

      const ctx = await getOptionalAuth()
      if (!ctx?.principal) {
        return { ...base, conversation: null, messages: [], hasMore: false }
      }

      // Gate reads behind portal access for non-team callers (degrade gracefully
      // to the greeting-only state rather than throwing on the bootstrap path).
      if (!isTeamMember(ctx.principal.role)) {
        const { resolvePortalAccessForRequest } = await import('./portal-access')
        const access = await resolvePortalAccessForRequest()
        if (!access.granted) {
          return { ...base, conversation: null, messages: [], hasMore: false }
        }
      }

      const target = data?.conversationId

      // "New conversation": config + greeting, no thread. The first send creates
      // it (sendVisitorMessage with no conversationId).
      if (target === null) {
        const visitorHasEmail = Boolean(realEmail(ctx.user?.email))
        return {
          ...base,
          visitorHasEmail,
          canEmailVisitor: canEmailVisitor({ emailConfigured, preChatEmail, visitorHasEmail }),
          conversation: null,
          messages: [],
          hasMore: false,
        }
      }

      const {
        getActiveConversationForVisitor,
        getConversationForVisitor,
        conversationToDTO,
        listMessages,
      } = await import('@/lib/server/domains/chat/chat.query')

      // A specific thread (history row / ?c= deep link) or the active one (default).
      const active = target
        ? await getConversationForVisitor(target as ConversationId, ctx.principal.id)
        : await getActiveConversationForVisitor(ctx.principal.id)
      const conversation = active.conversation
      // Anonymous visitors carry a synthetic placeholder email — it must not count
      // as a real address (else the widget promises an email reply it can't send).
      const visitorHasEmail =
        Boolean(realEmail(ctx.user?.email)) || Boolean(realEmail(conversation?.visitorEmail))
      const canEmail = canEmailVisitor({ emailConfigured, preChatEmail, visitorHasEmail })
      if (!conversation) {
        return {
          ...base,
          visitorHasEmail,
          canEmailVisitor: canEmail,
          conversation: null,
          messages: [],
          hasMore: false,
        }
      }

      const [dto, page] = await Promise.all([
        conversationToDTO(conversation, 'visitor'),
        listMessages(conversation.id),
      ])
      return {
        ...base,
        visitorHasEmail,
        canEmailVisitor: canEmail,
        isReadOnly: active.isReadOnly,
        conversation: dto,
        messages: page.messages,
        hasMore: page.hasMore,
      }
    } catch (error) {
      console.error('[fn:chat] getMyChatFn failed:', error)
      throw error
    }
  })

/**
 * The current visitor's own conversations (newest-first) so they can browse and
 * resume prior threads — useful once an anonymous visitor identifies and their
 * history is merged onto the account (P2.4). Visitor-side DTOs (no agent-only
 * fields). Returns an empty list rather than throwing on the bootstrap path.
 */
export const getMyConversationsFn = createServerFn({ method: 'GET' }).handler(async () => {
  try {
    const { isLiveChatEnabled } = await import('@/lib/server/domains/settings/settings.widget')
    if (!(await isLiveChatEnabled()) || !hasAuthCredentials()) return { conversations: [] }

    const ctx = await getOptionalAuth()
    if (!ctx?.principal) return { conversations: [] }

    // Non-team callers must hold portal access (mirrors getMyChatFn gating).
    if (!isTeamMember(ctx.principal.role)) {
      const { resolvePortalAccessForRequest } = await import('./portal-access')
      const access = await resolvePortalAccessForRequest()
      if (!access.granted) return { conversations: [] }
    }

    const { listConversationsForVisitor } = await import('@/lib/server/domains/chat/chat.query')
    return { conversations: await listConversationsForVisitor(ctx.principal.id, 50, 'visitor') }
  } catch (error) {
    console.error('[fn:chat] getMyConversationsFn failed:', error)
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
      const { listMessages, enrichMessagesForAgent } =
        await import('@/lib/server/domains/chat/chat.query')
      await assertConversationViewable(data.conversationId as ConversationId, actor)
      const isTeam = isTeamMember(ctx.principal.role)
      // Agents keep seeing internal notes when paging older messages; visitors never do.
      // The agent-only `postSuggestions` map is pulled out here so it's consumed by
      // the enrichment and never serialized into the response.
      const { postSuggestions, ...page } = await listMessages(
        data.conversationId as ConversationId,
        { before: data.before, includeInternal: isTeam }
      )
      // Team members get the agent-only reaction/flag/suggestion enrichment on
      // older messages too; the visitor path returns the clean base DTOs.
      if (isTeam) {
        return {
          ...page,
          messages: await enrichMessagesForAgent(page.messages, ctx.principal.id, postSuggestions),
        }
      }
      return page
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

const agentAvailabilitySchema = z.object({ availability: z.enum(['online', 'away']) })

/** Agent action: set my manual chat availability ('online' | 'away'). */
export const setAgentAvailabilityFn = createServerFn({ method: 'POST' })
  .inputValidator(agentAvailabilitySchema)
  .handler(async ({ data }) => {
    try {
      const ctx = await requireAuth({ roles: ['admin', 'member'] })
      const { setAgentAvailability } = await import('@/lib/server/realtime/presence')
      await setAgentAvailability(ctx.principal.id, data.availability)
      return { availability: data.availability }
    } catch (error) {
      console.error('[fn:chat] setAgentAvailabilityFn failed:', error)
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

/** Build the agent-author object used by chat convert/share operations. */
function agentFromCtx(ctx: AuthContext) {
  return {
    principalId: ctx.principal.id,
    displayName: ctx.user.name,
    avatarUrl: ctx.user.image,
    email: ctx.user.email,
  }
}

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
        priority: data.priority,
        assignedAgentPrincipalId: data.assignee === 'mine' ? ctx.principal.id : undefined,
        unassignedOnly: data.assignee === 'unassigned',
        search: data.search,
        tagIds: data.tagIds as ChatTagId[] | undefined,
        segmentIds: data.segmentIds as SegmentId[] | undefined,
        // Always the requesting agent — never trust a client-supplied id here.
        mentionedPrincipalId: data.view === 'mentions' ? ctx.principal.id : undefined,
        before: data.before,
      })
    } catch (error) {
      console.error('[fn:chat] listConversationsFn failed:', error)
      throw error
    }
  })

const userConversationsSchema = z.object({
  principalId: z.string(),
  status: z.enum(CONVERSATION_STATUSES).optional(),
  before: z.string().optional(),
})

/** A single visitor's chat history (status-filterable, paginated) — admin user profile. */
export const listConversationsForUserFn = createServerFn({ method: 'GET' })
  .inputValidator(userConversationsSchema)
  .handler(async ({ data }) => {
    try {
      await requireAuth({ roles: ['admin', 'member'] })
      const { listConversationsForAgent } = await import('@/lib/server/domains/chat/chat.query')
      return await listConversationsForAgent({
        visitorPrincipalId: data.principalId as PrincipalId,
        status: data.status,
        before: data.before,
      })
    } catch (error) {
      console.error('[fn:chat] listConversationsForUserFn failed:', error)
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
      const { conversationToDTO, listMessages, enrichMessagesForAgent } =
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
      // Upgrade to AgentChatMessageDTO[] by attaching the agent-only reaction +
      // flag + post-suggestion fields. This enrichment runs ONLY on the agent
      // thread path; no visitor path calls it, so those fields can't reach the
      // widget. The suggestion map rides in-memory off `listMessages` (no re-read).
      const messages = await enrichMessagesForAgent(
        page.messages,
        ctx.principal.id,
        page.postSuggestions
      )
      return { conversation: dto, messages, hasMore: page.hasMore }
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
        data.attachments as ChatAttachment[] | undefined,
        (data.contentJson ?? null) as import('@/lib/shared/db-types').TiptapContent | null
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
        actor,
        (data.contentJson ?? null) as import('@/lib/shared/db-types').TiptapContent | null,
        data.attachments as ChatAttachment[] | undefined
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
  sourceMessageContent: z.string().max(10000).optional(),
})

/** Create a feedback post from a conversation (create new, or upvote existing). */
export const createPostFromConversationFn = createServerFn({ method: 'POST' })
  .inputValidator(convertSchema)
  .handler(async ({ data }) => {
    try {
      const ctx = await requireAuth({ roles: ['admin', 'member'] })
      const actor = await policyActorFromAuth(ctx)
      const { createPostFromConversation } = await import('@/lib/server/domains/chat/chat.convert')
      const agent = agentFromCtx(ctx)
      return await createPostFromConversation(
        {
          conversationId: data.conversationId as ConversationId,
          boardId: data.boardId as BoardId,
          title: data.title,
          content: data.content,
          asUpvoteOfPostId: data.asUpvoteOfPostId as PostId | undefined,
          sourceMessageContent: data.sourceMessageContent,
        },
        { agentActor: actor, agentPrincipalId: ctx.principal.id, agent }
      )
    } catch (error) {
      console.error('[fn:chat] createPostFromConversationFn failed:', error)
      throw error
    }
  })

// Loose on the email (max-length only, not `.email()`): a malformed value must
// be ignored server-side rather than rejected, so capturing an email can never
// block the track action it rides alongside.
const captureContactEmailSchema = z.object({
  conversationId: z.string(),
  email: z.string().max(320),
})

/** Agent action: store a contact email for a conversation's anonymous visitor. */
export const captureVisitorContactEmailFn = createServerFn({ method: 'POST' })
  .inputValidator(captureContactEmailSchema)
  .handler(async ({ data }) => {
    try {
      const ctx = await requireAuth({ roles: ['admin', 'member'] })
      const actor = await policyActorFromAuth(ctx)
      const { captureVisitorContactEmail } = await import('@/lib/server/domains/chat/chat.service')
      return await captureVisitorContactEmail(
        data.conversationId as ConversationId,
        data.email,
        actor
      )
    } catch (error) {
      console.error('[fn:chat] captureVisitorContactEmailFn failed:', error)
      throw error
    }
  })

const sharePostSchema = z.object({
  conversationId: z.string(),
  postId: z.string(),
})

/** Agent action: embed an existing feedback post into the conversation (visitor can upvote it). */
export const sharePostFn = createServerFn({ method: 'POST' })
  .inputValidator(sharePostSchema)
  .handler(async ({ data }) => {
    try {
      const ctx = await requireAuth({ roles: ['admin', 'member'] })
      const actor = await policyActorFromAuth(ctx)
      const { sharePost } = await import('@/lib/server/domains/chat/chat.cards')
      const agent = agentFromCtx(ctx)
      const r = await sharePost(
        {
          conversationId: data.conversationId as ConversationId,
          postId: data.postId as PostId,
        },
        { agentActor: actor, agentPrincipalId: ctx.principal.id, agent }
      )
      return { messageId: r.message.id }
    } catch (error) {
      console.error('[fn:chat] sharePostFn failed:', error)
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

/** Agent action: end a conversation with a reason (+ optional note). */
export const endConversationFn = createServerFn({ method: 'POST' })
  .inputValidator(endConversationSchema)
  .handler(async ({ data }) => {
    try {
      const ctx = await requireAuth({ roles: ['admin', 'member'] })
      const actor = await policyActorFromAuth(ctx)
      const { endConversation } = await import('@/lib/server/domains/chat/chat.service')
      return await endConversation(
        data.conversationId as ConversationId,
        data.reason,
        data.note,
        actor
      )
    } catch (error) {
      console.error('[fn:chat] endConversationFn failed:', error)
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
      const assignTo: PrincipalId | null =
        data.assignTo === 'me'
          ? ctx.principal.id
          : ((data.assignTo as PrincipalId | null | undefined) ?? null)
      await assignConversation(data.conversationId as ConversationId, assignTo, actor)
      return { ok: true }
    } catch (error) {
      console.error('[fn:chat] assignConversationFn failed:', error)
      throw error
    }
  })

export const setConversationPriorityFn = createServerFn({ method: 'POST' })
  .inputValidator(setPrioritySchema)
  .handler(async ({ data }) => {
    try {
      const ctx = await requireAuth({ roles: ['admin', 'member'] })
      const actor = await policyActorFromAuth(ctx)
      const { setConversationPriority } = await import('@/lib/server/domains/chat/chat.service')
      await setConversationPriority(data.conversationId as ConversationId, data.priority, actor)
      return { ok: true }
    } catch (error) {
      console.error('[fn:chat] setConversationPriorityFn failed:', error)
      throw error
    }
  })

/** Add an emoji reaction to a message (agent-only, team-internal). */
export const addMessageReactionFn = createServerFn({ method: 'POST' })
  .inputValidator(messageReactionSchema)
  .handler(async ({ data }) => {
    try {
      const ctx = await requireAuth({ roles: ['admin', 'member'] })
      const actor = await policyActorFromAuth(ctx)
      const { addMessageReaction } = await import('@/lib/server/domains/chat/message.actions')
      return await addMessageReaction(data.messageId as ChatMessageId, data.emoji, actor)
    } catch (error) {
      console.error('[fn:chat] addMessageReactionFn failed:', error)
      throw error
    }
  })

/** Remove the caller's own emoji reaction from a message. */
export const removeMessageReactionFn = createServerFn({ method: 'POST' })
  .inputValidator(messageReactionSchema)
  .handler(async ({ data }) => {
    try {
      const ctx = await requireAuth({ roles: ['admin', 'member'] })
      const actor = await policyActorFromAuth(ctx)
      const { removeMessageReaction } = await import('@/lib/server/domains/chat/message.actions')
      return await removeMessageReaction(data.messageId as ChatMessageId, data.emoji, actor)
    } catch (error) {
      console.error('[fn:chat] removeMessageReactionFn failed:', error)
      throw error
    }
  })

/** Set or clear the team-wide flag on a message. */
export const setMessageFlagFn = createServerFn({ method: 'POST' })
  .inputValidator(messageFlagSchema)
  .handler(async ({ data }) => {
    try {
      const ctx = await requireAuth({ roles: ['admin', 'member'] })
      const actor = await policyActorFromAuth(ctx)
      const { setMessageFlag } = await import('@/lib/server/domains/chat/message.actions')
      return await setMessageFlag(data.messageId as ChatMessageId, data.flagged, actor)
    } catch (error) {
      console.error('[fn:chat] setMessageFlagFn failed:', error)
      throw error
    }
  })

/** Mark a conversation unread for the agent side, starting at a message. */
export const markConversationUnreadFromMessageFn = createServerFn({ method: 'POST' })
  .inputValidator(markUnreadFromMessageSchema)
  .handler(async ({ data }) => {
    try {
      const ctx = await requireAuth({ roles: ['admin', 'member'] })
      const actor = await policyActorFromAuth(ctx)
      const { markConversationUnreadFromMessage } =
        await import('@/lib/server/domains/chat/chat.service')
      await markConversationUnreadFromMessage(
        data.conversationId as ConversationId,
        data.messageId as ChatMessageId,
        actor
      )
      return { ok: true }
    } catch (error) {
      console.error('[fn:chat] markConversationUnreadFromMessageFn failed:', error)
      throw error
    }
  })

/** The caller's "Saved for later" feed — their flagged messages, newest first. */
export const listFlaggedMessagesFn = createServerFn({ method: 'GET' }).handler(async () => {
  try {
    const ctx = await requireAuth({ roles: ['admin', 'member'] })
    const { listFlaggedMessages } = await import('@/lib/server/domains/chat/chat.query')
    return await listFlaggedMessages(ctx.principal.id)
  } catch (error) {
    console.error('[fn:chat] listFlaggedMessagesFn failed:', error)
    throw error
  }
})

export const getLinkedPostsForConversationFn = createServerFn({ method: 'GET' })
  .inputValidator(conversationIdSchema)
  .handler(async ({ data }) => {
    try {
      await requireAuth({ roles: ['admin', 'member'] })
      const { getLinkedPostsForConversation } = await import('@/lib/server/domains/chat/chat.query')
      return await getLinkedPostsForConversation(data.conversationId as ConversationId)
    } catch (error) {
      console.error('[fn:chat] getLinkedPostsForConversationFn failed:', error)
      throw error
    }
  })

export const getLinkedConversationsForPostFn = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ postId: z.string() }))
  .handler(async ({ data }) => {
    try {
      await requireAuth({ roles: ['admin', 'member'] })
      const { getLinkedConversationsForPost } = await import('@/lib/server/domains/chat/chat.query')
      return await getLinkedConversationsForPost(data.postId as PostId)
    } catch (error) {
      console.error('[fn:chat] getLinkedConversationsForPostFn failed:', error)
      throw error
    }
  })
