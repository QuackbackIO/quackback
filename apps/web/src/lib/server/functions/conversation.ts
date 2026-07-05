/**
 * Server functions for the support inbox: the messenger widget channel plus agent-side inbox operations.
 *
 * Visitor-facing functions (send / read own thread) accept either the portal
 * cookie or the widget Bearer token — the better-auth bearer plugin resolves
 * both transparently, so a single set of endpoints serves portal and widget.
 * Agent-facing functions are gated to team roles and re-checked independently
 * of the admin route guard.
 */
import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import { isValidTypeId } from '@quackback/ids'
import type {
  ConversationId,
  ConversationMessageId,
  PrincipalId,
  PostId,
  BoardId,
  ConversationTagId,
  SegmentId,
  CompanyId,
  TeamId,
} from '@quackback/ids'
import {
  MAX_CONVERSATION_MESSAGE_LENGTH,
  MAX_CONVERSATION_ATTACHMENTS,
  type ConversationAttachment,
  type ConversationAssistantActivity,
} from '@/lib/shared/conversation/types'
import { officeHoursSnapshot } from '@/lib/shared/office-hours'
import type { ConversationPresence } from '@/lib/shared/conversation/presence'
import { realEmail } from '@/lib/shared/anonymous-email'
import {
  CONVERSATION_STATUSES,
  CONVERSATION_END_REASONS,
  REACTION_EMOJIS,
} from '@/lib/shared/db-types'
import {
  getOptionalAuth,
  requireAuth,
  assertPermission,
  policyActorFromAuth,
  hasAuthCredentials,
  type AuthContext,
} from './auth-helpers'
import { isTeamMember } from '@/lib/shared/roles'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { AI_INBOX_BUCKETS } from '@/lib/server/domains/assistant/assistant.involvement'
import { ConflictError, ForbiddenError } from '@/lib/shared/errors'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'conversation' })

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
  content: z.string().max(MAX_CONVERSATION_MESSAGE_LENGTH).default(''),
  // Rich-composer TipTap doc (inline embeds / images). Sanitized server-side;
  // the plain `content` is the doc's text, kept for previews/notifications/search.
  contentJson: z.unknown().nullable().optional(),
  attachments: z.array(attachmentSchema).max(MAX_CONVERSATION_ATTACHMENTS).optional(),
  /** Optional pre-chat email capture (anonymous visitors). */
})

const conversationIdSchema = z.object({ conversationId: z.string() })

const listMessagesSchema = z.object({
  conversationId: z.string(),
  before: z.string().optional(),
})

const listConversationsSchema = z.object({
  status: z.enum(CONVERSATION_STATUSES).optional(),
  priority: z.enum(['none', 'low', 'medium', 'high', 'urgent']).optional(),
  // Assignee queue: 'mine' = the requesting agent, 'unassigned' = no agent yet,
  // 'all'/omitted = no constraint. A custom view can also target a specific
  // teammate — any other value is treated as that teammate's principal id
  // (validated to a real principal id server-side).
  assignee: z.string().max(64).optional(),
  // Per-team inbox: only conversations assigned to this team.
  teamId: z.string().optional(),
  // Inbound source discriminator (e.g. 'widget', 'email').
  source: z.string().max(32).optional(),
  // "Waiting" scope: only conversations a customer is currently waiting on.
  waitingOnly: z.boolean().optional(),
  // Inbox ordering; omitted = 'recent'.
  sort: z.enum(['recent', 'oldest', 'created', 'waiting', 'priority']).optional(),
  search: z.string().max(200).optional(),
  // Filter to conversations carrying ANY of these labels.
  tagIds: z.array(z.string()).optional(),
  // Filter to conversations whose visitor is a member of ANY of these segments.
  segmentIds: z.array(z.string()).optional(),
  // Restrict to conversations whose visitor belongs to this company.
  companyId: z.string().optional(),
  // 'mentions' = only conversations whose internal notes @-mention the
  // requesting agent (the principal is resolved server-side from auth).
  // 'quinn' = only conversations Quinn engaged (see the `ai` bucket).
  view: z.enum(['all', 'mentions', 'quinn']).optional(),
  // Quinn-inbox sub-filter by involvement outcome; omitted = any Quinn-engaged.
  ai: z.enum(['resolved', 'escalated', 'pending']).optional(),
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
  content: z.string().max(MAX_CONVERSATION_MESSAGE_LENGTH).default(''),
  // Rich-composer TipTap doc (inline embeds / images). Sanitized server-side;
  // the plain `content` is the doc's text, kept for previews/notifications/search.
  contentJson: z.unknown().nullable().optional(),
  attachments: z.array(attachmentSchema).max(MAX_CONVERSATION_ATTACHMENTS).optional(),
})

const startConversationSchema = z.object({
  targetPrincipalId: z.string(),
  content: z.string().min(1).max(MAX_CONVERSATION_MESSAGE_LENGTH),
})

const agentNoteSchema = z.object({
  conversationId: z.string(),
  content: z.string().min(1).max(MAX_CONVERSATION_MESSAGE_LENGTH),
  // TipTap doc from the note editor (carries @-mention nodes). Validated +
  // mention-extracted server-side; omitted for a plain-text note.
  contentJson: z.unknown().nullable().optional(),
  // Image/file attachments on the note (agent-only, same pipeline as replies).
  attachments: z.array(attachmentSchema).max(MAX_CONVERSATION_ATTACHMENTS).optional(),
})

const setStatusSchema = z.object({
  conversationId: z.string(),
  status: z.enum(CONVERSATION_STATUSES),
})

const snoozeConversationSchema = z.object({
  conversationId: z.string(),
  // ISO wake time, or null = snooze until the customer next replies.
  until: z.string().datetime().nullable(),
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

async function assertConversationsEnabled(): Promise<void> {
  const { isConversationsEnabled } = await import('@/lib/server/domains/settings/settings.support')
  if (!(await isConversationsEnabled())) {
    throw new Error('Conversations are not enabled')
  }
}

/**
 * Shared gate for every visitor-facing conversation endpoint: conversations must be
 * reachable from some surface (widget messenger or portal Support tab) AND the
 * caller must have portal access. Team members (agents) bypass the portal
 * check — they reach these endpoints from the admin inbox. Throws on failure.
 */
async function assertVisitorConversationAccess(role: string | null): Promise<void> {
  await assertConversationsEnabled()
  if (isTeamMember(role)) return
  const { resolvePortalAccessForRequest } = await import('./portal-access')
  const access = await resolvePortalAccessForRequest()
  if (!access.granted) throw new Error('Portal access required')
}

// ── Visitor functions ────────────────────────────────────────────────────

/** Send a visitor message; creates the conversation on the first message. */
export const sendConversationMessageFn = createServerFn({ method: 'POST' })
  .validator(sendMessageSchema)
  .handler(async ({ data }) => {
    try {
      const ctx = await requireAuth()
      await assertVisitorConversationAccess(ctx.principal.role)

      // Visitor-only ingress checks (agents send via sendAgentMessageFn).
      if (!isTeamMember(ctx.principal.role)) {
        // Blocked people cannot send (support platform §4.6). The same
        // isBlocked read backs the widget identify gate and, per the integrator
        // TODO in blocking.ts, the email-inbound boundary.
        const { isBlocked } = await import('@/lib/server/domains/principals/blocking')
        if (await isBlocked(ctx.principal.id)) {
          throw new ForbiddenError('BLOCKED', 'You are not able to send messages here.')
        }

        // "Prevent replies to closed conversations" (§4.3) — Messenger/portal
        // only, opt-in. When on, a visitor reply to a CLOSED thread is refused
        // rather than reopening it. Email replies bypass this: they arrive via
        // conversation.email-inbound.service.ts (a different boundary that never
        // reaches this function) and ALWAYS reopen, the only viable behavior on
        // email mid-thread.
        if (data.conversationId) {
          const { getMessengerConfig } =
            await import('@/lib/server/domains/settings/settings.widget')
          const messenger = await getMessengerConfig()
          if (messenger.preventRepliesWhenClosed) {
            const { getConversationForVisitor } =
              await import('@/lib/server/domains/conversation/conversation.query')
            const { conversation } = await getConversationForVisitor(
              data.conversationId as ConversationId,
              ctx.principal.id
            )
            if (conversation?.status === 'closed') {
              throw new ConflictError(
                'CONVERSATION_CLOSED',
                'This conversation has been closed. Please start a new one.'
              )
            }
          }
        }

        // Throttle per principal: bounds write/notify fanout and runaway
        // conversation creation.
        const { assertConversationSendRate } =
          await import('@/lib/server/domains/conversation/conversation.ratelimit')
        await assertConversationSendRate(ctx.principal.id)
      }

      const actor = await policyActorFromAuth(ctx)

      const { sendVisitorMessage } =
        await import('@/lib/server/domains/conversation/conversation.service')
      return await sendVisitorMessage(
        {
          conversationId: data.conversationId as ConversationId | undefined,
          content: data.content,
          attachments: data.attachments as ConversationAttachment[] | undefined,
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
      log.error({ err: error }, 'send conversation message failed')
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
export const getConversationPresenceFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<ConversationPresence> => {
    const { getOfficeHoursSchedule } =
      await import('@/lib/server/domains/settings/settings.office-hours')
    const { isAnyAgentAvailable } = await import('@/lib/server/realtime/presence')
    const [schedule, agentsOnline] = await Promise.all([
      getOfficeHoursSchedule(),
      isAnyAgentAvailable(),
    ])
    return {
      agentsOnline,
      // withinOfficeHours + (when closed) the ISO instant we're next back.
      ...officeHoursSnapshot(schedule, new Date()),
    }
  }
)

/**
 * Teammate avatars for the widget Home header cluster. Tenant-global and
 * public-safe by construction — the domain query exposes only name + image for
 * genuine teammates (never portal users, anonymous visitors, or service
 * principals), so no visitor auth is needed.
 */
export const getWidgetTeamAvatarsFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<{ name: string; avatarUrl: string | null }[]> => {
    const { listTeamAvatars } = await import('@/lib/server/domains/principals/principal.service')
    return listTeamAvatars(3)
  }
)

// getMyConversationFn optionally targets a specific conversation:
//  - omitted        → the visitor's active/most-recent thread (default)
//  - a conversation → that thread, if the caller owns it (else greeting state)
//  - null           → "new": config + greeting with no thread
const myConversationSchema = z
  .object({ conversationId: z.string().nullish(), locale: z.string().max(20).optional() })
  .optional()

/** The current visitor's active conversation + first page of messages. */
export const getMyConversationFn = createServerFn({ method: 'GET' })
  .validator(myConversationSchema)
  .handler(async ({ data }) => {
    try {
      const { getMessengerConfig, getWidgetConfig } =
        await import('@/lib/server/domains/settings/settings.widget')
      const { isConversationsEnabled } =
        await import('@/lib/server/domains/settings/settings.support')
      const { getSettings } = await import('./workspace')
      const { isEmailConfigured } = await import('@quackback/email')
      const { canEmailVisitor } = await import('@/lib/shared/conversation/reply-capability')
      const { widgetTranslationFor } = await import('@/lib/shared/widget/translations')
      const [enabled, messengerConfig, appSettings, widgetConfig] = await Promise.all([
        isConversationsEnabled(),
        getMessengerConfig(),
        getSettings(),
        getWidgetConfig(),
      ])
      // Per-locale copy override for this visitor's language (base copy is the
      // fallback).
      const t = widgetTranslationFor(widgetConfig.translations, data?.locale)
      const emailConfigured = isEmailConfigured()
      // Note: team-availability presence is NOT returned here. The widget reads it
      // from the shared useConversationPresence query (getConversationPresenceFn) so every surface
      // agrees and only one poll runs — this fn is just the visitor's thread.
      const base = {
        enabled,
        welcomeMessage: t.welcomeMessage || messengerConfig.welcomeMessage || null,
        offlineMessage: t.offlineMessage || messengerConfig.offlineMessage || null,
        // Falls back to the workspace name (as the settings help text promises)
        // when no team name is set.
        teamName: messengerConfig.teamName?.trim() || appSettings?.name || null,
        // AI-assistant display identity: fronts new conversations (greeting
        // author + thread header) when enabled. Identity only — replies still
        // come from the team until the integrated agent lands.
        assistant: messengerConfig.assistant?.enabled
          ? {
              name: messengerConfig.assistant.name?.trim() || 'Quinn',
              avatarUrl: messengerConfig.assistant.avatarUrl || null,
            }
          : null,
        // Whether we already have a contact email for this visitor.
        visitorHasEmail: false,
        // Whether an offline reply could actually reach this visitor by email —
        // the widget shows a non-promising offline message when false.
        canEmailVisitor: canEmailVisitor({ emailConfigured, visitorHasEmail: false }),
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
          canEmailVisitor: canEmailVisitor({ emailConfigured, visitorHasEmail }),
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
      } = await import('@/lib/server/domains/conversation/conversation.query')

      // A specific thread (history row / ?c= deep link) or the active one (default).
      const active = target
        ? await getConversationForVisitor(target as ConversationId, ctx.principal.id)
        : await getActiveConversationForVisitor(ctx.principal.id)
      const conversation = active.conversation
      // Anonymous visitors carry a synthetic placeholder email — it must not count
      // as a real address (else the widget promises an email reply it can't send).
      const visitorHasEmail =
        Boolean(realEmail(ctx.user?.email)) || Boolean(realEmail(conversation?.visitorEmail))
      const canEmail = canEmailVisitor({ emailConfigured, visitorHasEmail })
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
      log.error({ err: error }, 'get my conversation failed')
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
    const { isConversationsEnabled } =
      await import('@/lib/server/domains/settings/settings.support')
    if (!(await isConversationsEnabled()) || !hasAuthCredentials()) return { conversations: [] }

    const ctx = await getOptionalAuth()
    if (!ctx?.principal) return { conversations: [] }

    // Non-team callers must hold portal access (mirrors getMyConversationFn gating).
    if (!isTeamMember(ctx.principal.role)) {
      const { resolvePortalAccessForRequest } = await import('./portal-access')
      const access = await resolvePortalAccessForRequest()
      if (!access.granted) return { conversations: [] }
    }

    const { listConversationsForVisitor } =
      await import('@/lib/server/domains/conversation/conversation.query')
    return { conversations: await listConversationsForVisitor(ctx.principal.id, 50, 'visitor') }
  } catch (error) {
    log.error({ err: error }, 'get my conversations failed')
    throw error
  }
})

/**
 * Total unread across ALL of the caller's conversations — the messenger badge
 * aggregate (the launcher/tab shows one number, not the most-recent thread's).
 * Same gating as getMyConversationsFn: portal access for non-team callers;
 * returns 0 when conversations are off or the caller is unauthenticated. `total`
 * is a separate field so ticket/other unread can fold in later without a shape
 * change.
 */
export const getMessengerUnreadFn = createServerFn({ method: 'GET' }).handler(async () => {
  const zero = { conversations: 0, total: 0 }
  try {
    const { isConversationsEnabled } =
      await import('@/lib/server/domains/settings/settings.support')
    if (!(await isConversationsEnabled()) || !hasAuthCredentials()) return zero

    const ctx = await getOptionalAuth()
    if (!ctx?.principal) return zero

    // Non-team callers must hold portal access (mirrors getMyConversationsFn).
    if (!isTeamMember(ctx.principal.role)) {
      const { resolvePortalAccessForRequest } = await import('./portal-access')
      const access = await resolvePortalAccessForRequest()
      if (!access.granted) return zero
    }

    const { countVisitorUnreadMessages } =
      await import('@/lib/server/domains/conversation/conversation.query')
    const conversationUnread = await countVisitorUnreadMessages(ctx.principal.id)
    return { conversations: conversationUnread, total: conversationUnread }
  } catch (error) {
    log.error({ err: error }, 'get messenger unread failed')
    throw error
  }
})

/** Older messages for a conversation the caller can view (keyset pagination). */
export const listConversationMessagesFn = createServerFn({ method: 'GET' })
  .validator(listMessagesSchema)
  .handler(async ({ data }) => {
    try {
      const ctx = await requireAuth()
      await assertVisitorConversationAccess(ctx.principal.role)
      const actor = await policyActorFromAuth(ctx)
      const { assertConversationViewable } =
        await import('@/lib/server/domains/conversation/conversation.service')
      const { listMessages, enrichMessagesForAgent } =
        await import('@/lib/server/domains/conversation/conversation.query')
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
      log.error({ err: error }, 'list conversation messages failed')
      throw error
    }
  })

/**
 * Export a conversation as a markdown transcript (agent-only — the transcript
 * includes internal notes). Pages the full history oldest-first and renders it
 * with the pure transcript renderer. Returns the file body for the client to
 * download; nothing is written server-side.
 */
export const exportConversationTranscriptFn = createServerFn({ method: 'GET' })
  .validator((d: unknown) => z.object({ conversationId: z.string() }).parse(d))
  .handler(async ({ data }) => {
    try {
      const ctx = await requireAuth({ permission: PERMISSIONS.CONVERSATION_VIEW })
      // Belt-and-suspenders with the permission gate: internal notes must never
      // reach a non-team principal, whatever a custom role was granted.
      if (!isTeamMember(ctx.principal.role)) {
        throw new ForbiddenError('FORBIDDEN', 'Only team members can export a transcript')
      }
      const conversationId = data.conversationId as ConversationId
      const actor = await policyActorFromAuth(ctx)
      const { assertConversationViewable } =
        await import('@/lib/server/domains/conversation/conversation.service')
      const conversation = await assertConversationViewable(conversationId, actor)
      const { listMessages } = await import('@/lib/server/domains/conversation/conversation.query')

      // Assemble the full history oldest-first. Each page (before-cursor) is a
      // block older than the last, so prepend it. Bounded loop — even a very
      // long thread is only a handful of 100-message pages.
      const all: Awaited<ReturnType<typeof listMessages>>['messages'] = []
      let before: string | undefined
      for (let i = 0; i < 500; i++) {
        const page = await listMessages(conversationId, {
          includeInternal: true,
          limit: 100,
          before,
        })
        all.unshift(...page.messages)
        if (!page.hasMore || !page.nextCursor) break
        before = page.nextCursor
      }

      const { renderConversationTranscript } =
        await import('@/lib/server/domains/conversation/conversation.transcript')
      const content = renderConversationTranscript(
        {
          id: conversationId,
          subject: conversation.subject,
          status: conversation.status,
          channel: conversation.channel,
          createdAt: conversation.createdAt,
        },
        all
      )
      return { filename: `conversation-${conversationId}.md`, content, mimeType: 'text/markdown' }
    } catch (error) {
      log.error({ err: error }, 'export conversation transcript failed')
      throw error
    }
  })

/** Mark a conversation read up to now for the caller's side. */
export const markConversationReadFn = createServerFn({ method: 'POST' })
  .validator(conversationIdSchema)
  .handler(async ({ data }) => {
    try {
      const ctx = await requireAuth()
      await assertVisitorConversationAccess(ctx.principal.role)
      const actor = await policyActorFromAuth(ctx)
      // The service derives the side from the actor's relationship to the
      // conversation (a team member in a thread they own is the visitor).
      const { markConversationRead } =
        await import('@/lib/server/domains/conversation/conversation.service')
      await markConversationRead(data.conversationId as ConversationId, actor)
      return { ok: true }
    } catch (error) {
      log.error({ err: error }, 'mark conversation read failed')
      throw error
    }
  })

/** Broadcast that the caller is typing (ephemeral; client-throttled). */
export const sendConversationTypingFn = createServerFn({ method: 'POST' })
  .validator(conversationIdSchema)
  .handler(async ({ data }) => {
    try {
      const ctx = await requireAuth()
      await assertVisitorConversationAccess(ctx.principal.role)
      const actor = await policyActorFromAuth(ctx)
      // Side derived in the service from conversation ownership, not role.
      const { signalTyping } =
        await import('@/lib/server/domains/conversation/conversation.service')
      await signalTyping(data.conversationId as ConversationId, actor)
      return { ok: true }
    } catch (error) {
      log.error({ err: error }, 'send conversation typing failed')
      throw error
    }
  })

/** Submit a CSAT rating for a conversation (visitor only). */
export const submitCsatFn = createServerFn({ method: 'POST' })
  .validator(csatSchema)
  .handler(async ({ data }) => {
    try {
      const ctx = await requireAuth()
      await assertVisitorConversationAccess(ctx.principal.role)
      const actor = await policyActorFromAuth(ctx)
      const { recordCsat } = await import('@/lib/server/domains/conversation/conversation.service')
      await recordCsat(data.conversationId as ConversationId, data.rating, data.comment, actor)
      return { ok: true }
    } catch (error) {
      log.error({ err: error }, 'submit csat failed')
      throw error
    }
  })

const agentAvailabilitySchema = z.object({ availability: z.enum(['online', 'away']) })

/** Agent action: set my manual chat availability ('online' | 'away'). */
export const setAgentAvailabilityFn = createServerFn({ method: 'POST' })
  .validator(agentAvailabilitySchema)
  .handler(async ({ data }) => {
    try {
      const ctx = await requireAuth({ permission: PERMISSIONS.CONVERSATION_VIEW })
      const { setAgentAvailability } = await import('@/lib/server/realtime/presence')
      await setAgentAvailability(ctx.principal.id, data.availability)
      return { availability: data.availability }
    } catch (error) {
      log.error({ err: error }, 'set agent availability failed')
      throw error
    }
  })

/** Mint a short-lived token authorizing this principal's SSE stream. */
export const mintConversationStreamTokenFn = createServerFn({ method: 'GET' }).handler(async () => {
  try {
    const ctx = await requireAuth()
    await assertVisitorConversationAccess(ctx.principal.role)
    const { mintStreamToken } = await import('@/lib/server/realtime/stream-token')
    return { token: mintStreamToken(ctx.principal.id) }
  } catch (error) {
    log.error({ err: error }, 'mint conversation stream token failed')
    throw error
  }
})

/** Soft-delete a message (team members; or a visitor deleting their own). */
export const deleteConversationMessageFn = createServerFn({ method: 'POST' })
  .validator(messageIdSchema)
  .handler(async ({ data }) => {
    try {
      const ctx = await requireAuth()
      await assertVisitorConversationAccess(ctx.principal.role)
      const actor = await policyActorFromAuth(ctx)
      const { deleteConversationMessage } =
        await import('@/lib/server/domains/conversation/conversation.service')
      await deleteConversationMessage(data.messageId as ConversationMessageId, actor)
      return { ok: true }
    } catch (error) {
      log.error({ err: error }, 'delete conversation message failed')
      throw error
    }
  })

/** Build the agent-author object used by conversation convert/share operations. */
function agentFromCtx(ctx: AuthContext) {
  return {
    principalId: ctx.principal.id,
    displayName: ctx.user.name,
    avatarUrl: ctx.user.image,
    email: ctx.user.email,
  }
}

// ── Agent functions ──────────────────────────────────────────────────────

/** Inbox feed for the support team. */
export const listConversationsFn = createServerFn({ method: 'GET' })
  .validator(listConversationsSchema)
  .handler(async ({ data }) => {
    try {
      const ctx = await requireAuth({ permission: PERMISSIONS.CONVERSATION_VIEW })
      const { listConversationsForAgent } =
        await import('@/lib/server/domains/conversation/conversation.query')
      // assignee is 'all' | 'mine' | 'unassigned' | a teammate principal id. A
      // specific id is honored only when it's a well-formed principal id, so a
      // junk value can't reach the uuid-backed query and 500 the list.
      const assignee = data.assignee
      const assignedAgentPrincipalId =
        assignee === 'mine'
          ? ctx.principal.id
          : assignee &&
              assignee !== 'all' &&
              assignee !== 'unassigned' &&
              isValidTypeId(assignee, 'principal')
            ? (assignee as PrincipalId)
            : undefined
      return await listConversationsForAgent({
        status: data.status,
        priority: data.priority,
        assignedAgentPrincipalId,
        unassignedOnly: assignee === 'unassigned',
        teamId:
          data.teamId && isValidTypeId(data.teamId, 'team') ? (data.teamId as TeamId) : undefined,
        source: data.source,
        waitingOnly: data.waitingOnly,
        sort: data.sort,
        search: data.search,
        tagIds: data.tagIds as ConversationTagId[] | undefined,
        segmentIds: data.segmentIds as SegmentId[] | undefined,
        companyId: data.companyId as CompanyId | undefined,
        // Always the requesting agent — never trust a client-supplied id here.
        mentionedPrincipalId: data.view === 'mentions' ? ctx.principal.id : undefined,
        // Quinn view: a chosen bucket narrows to its statuses; none = any Quinn
        // involvement (every bucket).
        assistantStatuses:
          data.view === 'quinn'
            ? data.ai
              ? AI_INBOX_BUCKETS[data.ai]
              : Object.values(AI_INBOX_BUCKETS).flat()
            : undefined,
        before: data.before,
      })
    } catch (error) {
      log.error({ err: error }, 'list conversations failed')
      throw error
    }
  })

/** Conversation counts per Quinn-inbox bucket (Resolved / Escalated / Pending),
 *  for the inbox nav badges. */
export const fetchAssistantInboxCountsFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuth({ permission: PERMISSIONS.CONVERSATION_VIEW })
  const { countAssistantInboxBuckets } =
    await import('@/lib/server/domains/assistant/assistant.involvement')
  return countAssistantInboxBuckets()
})

/** Quinn's activity on one conversation for the agent details panel: outcome,
 *  KB sources cited, escalation reason, CSAT. Null when Quinn never engaged. */
export const getConversationAssistantActivityFn = createServerFn({ method: 'GET' })
  .validator(z.object({ conversationId: z.string() }))
  .handler(async ({ data }): Promise<ConversationAssistantActivity | null> => {
    await requireAuth({ permission: PERMISSIONS.CONVERSATION_VIEW })
    const { getLatestInvolvement } =
      await import('@/lib/server/domains/assistant/assistant.involvement')
    const inv = await getLatestInvolvement(data.conversationId as ConversationId)
    if (!inv) return null
    return {
      outcome: inv.status,
      handoffReason: inv.handoffReason,
      sources: inv.sources.map((s) => ({
        type: s.type,
        id: s.id,
        title: s.title ?? '',
        url: s.url ?? '',
      })),
      rating: inv.rating,
      answeredAt: inv.lastAssistantAnswerAt?.toISOString() ?? null,
    }
  })

const userConversationsSchema = z.object({
  principalId: z.string(),
  status: z.enum(CONVERSATION_STATUSES).optional(),
  before: z.string().optional(),
})

/** A single visitor's conversation history (status-filterable, paginated) — admin user profile. */
export const listConversationsForUserFn = createServerFn({ method: 'GET' })
  .validator(userConversationsSchema)
  .handler(async ({ data }) => {
    try {
      await requireAuth({ permission: PERMISSIONS.CONVERSATION_VIEW })
      const { listConversationsForAgent } =
        await import('@/lib/server/domains/conversation/conversation.query')
      return await listConversationsForAgent({
        visitorPrincipalId: data.principalId as PrincipalId,
        status: data.status,
        before: data.before,
      })
    } catch (error) {
      log.error({ err: error }, 'list conversations for user failed')
      throw error
    }
  })

/** A single conversation (agent view) + first page of messages. */
export const getConversationFn = createServerFn({ method: 'GET' })
  .validator(listMessagesSchema)
  .handler(async ({ data }) => {
    try {
      const ctx = await requireAuth({ permission: PERMISSIONS.CONVERSATION_VIEW })
      const actor = await policyActorFromAuth(ctx)
      const { assertConversationViewable } =
        await import('@/lib/server/domains/conversation/conversation.service')
      const { conversationToDTO, listMessages, enrichMessagesForAgent } =
        await import('@/lib/server/domains/conversation/conversation.query')
      const conversation = await assertConversationViewable(
        data.conversationId as ConversationId,
        actor
      )
      const [dto, page] = await Promise.all([
        conversationToDTO(conversation, 'agent'),
        // Agents see internal notes inline.
        listMessages(conversation.id, { before: data.before, includeInternal: true }),
      ])
      // Upgrade to AgentConversationMessageDTO[] by attaching the agent-only reaction +
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
      log.error({ err: error }, 'get conversation failed')
      throw error
    }
  })

/** Agent reply. */
export const sendAgentMessageFn = createServerFn({ method: 'POST' })
  .validator(agentSendSchema)
  .handler(async ({ data }) => {
    try {
      const ctx = await requireAuth({ permission: PERMISSIONS.CONVERSATION_REPLY })
      const actor = await policyActorFromAuth(ctx)
      const { sendAgentMessage } =
        await import('@/lib/server/domains/conversation/conversation.service')
      return await sendAgentMessage(
        data.conversationId as ConversationId,
        data.content,
        {
          principalId: ctx.principal.id,
          displayName: ctx.user.name,
          avatarUrl: ctx.user.image,
        },
        actor,
        data.attachments as ConversationAttachment[] | undefined,
        (data.contentJson ?? null) as import('@/lib/shared/db-types').TiptapContent | null
      )
    } catch (error) {
      log.error({ err: error }, 'send agent message failed')
      throw error
    }
  })

/**
 * Start a new conversation with a portal user (outbound compose). Gated on the
 * supportInbox flag only — the recipient can reply by email alone, so neither
 * visitor surface needs to be on. The first message is always emailed.
 */
export const startAgentConversationFn = createServerFn({ method: 'POST' })
  .validator(startConversationSchema)
  .handler(async ({ data }) => {
    try {
      const ctx = await requireAuth({ permission: PERMISSIONS.CONVERSATION_REPLY })
      const { isFeatureEnabled } = await import('@/lib/server/domains/settings/settings.service')
      if (!(await isFeatureEnabled('supportInbox'))) {
        throw new Error('Support inbox is not enabled')
      }
      const actor = await policyActorFromAuth(ctx)
      const { startAgentConversation } =
        await import('@/lib/server/domains/conversation/conversation.service')
      return await startAgentConversation(
        {
          targetPrincipalId: data.targetPrincipalId as PrincipalId,
          content: data.content,
        },
        {
          principalId: ctx.principal.id,
          displayName: ctx.user.name,
          avatarUrl: ctx.user.image,
        },
        actor
      )
    } catch (error) {
      log.error({ err: error }, 'start agent conversation failed')
      throw error
    }
  })

/** Add an agent-only internal note (never sent to the visitor). */
export const addConversationNoteFn = createServerFn({ method: 'POST' })
  .validator(agentNoteSchema)
  .handler(async ({ data }) => {
    try {
      const ctx = await requireAuth({ permission: PERMISSIONS.CONVERSATION_NOTE })
      const actor = await policyActorFromAuth(ctx)
      const { addAgentNote } =
        await import('@/lib/server/domains/conversation/conversation.service')
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
        data.attachments as ConversationAttachment[] | undefined
      )
    } catch (error) {
      log.error({ err: error }, 'add conversation note failed')
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
  .validator(convertSchema)
  .handler(async ({ data }) => {
    try {
      const ctx = await requireAuth({ permission: PERMISSIONS.POST_CREATE })
      const actor = await policyActorFromAuth(ctx)
      const { createPostFromConversation } =
        await import('@/lib/server/domains/conversation/conversation.convert')
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
      log.error({ err: error }, 'create post from conversation failed')
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
  .validator(captureContactEmailSchema)
  .handler(async ({ data }) => {
    try {
      const ctx = await requireAuth({ permission: PERMISSIONS.CONVERSATION_MANAGE })
      const actor = await policyActorFromAuth(ctx)
      const { captureVisitorContactEmail } =
        await import('@/lib/server/domains/conversation/conversation.service')
      return await captureVisitorContactEmail(
        data.conversationId as ConversationId,
        data.email,
        actor
      )
    } catch (error) {
      log.error({ err: error }, 'capture visitor contact email failed')
      throw error
    }
  })

const sharePostSchema = z.object({
  conversationId: z.string(),
  postId: z.string(),
})

/** Agent action: embed an existing feedback post into the conversation (visitor can upvote it). */
export const sharePostFn = createServerFn({ method: 'POST' })
  .validator(sharePostSchema)
  .handler(async ({ data }) => {
    try {
      const ctx = await requireAuth({ permission: PERMISSIONS.CONVERSATION_REPLY })
      const actor = await policyActorFromAuth(ctx)
      const { sharePost } = await import('@/lib/server/domains/conversation/conversation.cards')
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
      log.error({ err: error }, 'share post failed')
      throw error
    }
  })

export const setConversationStatusFn = createServerFn({ method: 'POST' })
  .validator(setStatusSchema)
  .handler(async ({ data }) => {
    try {
      const ctx = await requireAuth({ permission: PERMISSIONS.CONVERSATION_SET_STATUS })
      const actor = await policyActorFromAuth(ctx)
      const { setConversationStatus } =
        await import('@/lib/server/domains/conversation/conversation.service')
      await setConversationStatus(data.conversationId as ConversationId, data.status, actor)
      return { ok: true }
    } catch (error) {
      log.error({ err: error }, 'set conversation status failed')
      throw error
    }
  })

/** Agent action: snooze a conversation until a wake time (or until the customer replies). */
export const snoozeConversationFn = createServerFn({ method: 'POST' })
  .validator(snoozeConversationSchema)
  .handler(async ({ data }) => {
    try {
      const ctx = await requireAuth({ permission: PERMISSIONS.CONVERSATION_SET_STATUS })
      const actor = await policyActorFromAuth(ctx)
      const { snoozeConversation } =
        await import('@/lib/server/domains/conversation/conversation.service')
      await snoozeConversation(
        data.conversationId as ConversationId,
        data.until ? new Date(data.until) : null,
        actor
      )
      return { ok: true }
    } catch (error) {
      log.error({ err: error }, 'snooze conversation failed')
      throw error
    }
  })

/** Agent action: end a conversation with a reason (+ optional note). */
export const endConversationFn = createServerFn({ method: 'POST' })
  .validator(endConversationSchema)
  .handler(async ({ data }) => {
    try {
      const ctx = await requireAuth({ permission: PERMISSIONS.CONVERSATION_SET_STATUS })
      const actor = await policyActorFromAuth(ctx)
      const { endConversation } =
        await import('@/lib/server/domains/conversation/conversation.service')
      return await endConversation(
        data.conversationId as ConversationId,
        data.reason,
        data.note,
        actor
      )
    } catch (error) {
      log.error({ err: error }, 'end conversation failed')
      throw error
    }
  })

export const assignConversationFn = createServerFn({ method: 'POST' })
  .validator(assignSchema)
  .handler(async ({ data }) => {
    try {
      const ctx = await requireAuth({ permission: PERMISSIONS.CONVERSATION_ASSIGN })
      const actor = await policyActorFromAuth(ctx)
      const { assignConversation } =
        await import('@/lib/server/domains/conversation/conversation.service')
      const assignTo: PrincipalId | null =
        data.assignTo === 'me'
          ? ctx.principal.id
          : ((data.assignTo as PrincipalId | null | undefined) ?? null)
      await assignConversation(data.conversationId as ConversationId, assignTo, actor)
      return { ok: true }
    } catch (error) {
      log.error({ err: error }, 'assign conversation failed')
      throw error
    }
  })

export const setConversationPriorityFn = createServerFn({ method: 'POST' })
  .validator(setPrioritySchema)
  .handler(async ({ data }) => {
    try {
      const ctx = await requireAuth({ permission: PERMISSIONS.CONVERSATION_SET_STATUS })
      const actor = await policyActorFromAuth(ctx)
      const { setConversationPriority } =
        await import('@/lib/server/domains/conversation/conversation.service')
      await setConversationPriority(data.conversationId as ConversationId, data.priority, actor)
      return { ok: true }
    } catch (error) {
      log.error({ err: error }, 'set conversation priority failed')
      throw error
    }
  })

/** Add an emoji reaction to a message (agent-only, team-internal). */
export const addMessageReactionFn = createServerFn({ method: 'POST' })
  .validator(messageReactionSchema)
  .handler(async ({ data }) => {
    try {
      const ctx = await requireAuth({ permission: PERMISSIONS.CONVERSATION_NOTE })
      const actor = await policyActorFromAuth(ctx)
      const { addMessageReaction } =
        await import('@/lib/server/domains/conversation/message.actions')
      return await addMessageReaction(data.messageId as ConversationMessageId, data.emoji, actor)
    } catch (error) {
      log.error({ err: error }, 'add message reaction failed')
      throw error
    }
  })

/** Remove the caller's own emoji reaction from a message. */
export const removeMessageReactionFn = createServerFn({ method: 'POST' })
  .validator(messageReactionSchema)
  .handler(async ({ data }) => {
    try {
      const ctx = await requireAuth({ permission: PERMISSIONS.CONVERSATION_NOTE })
      const actor = await policyActorFromAuth(ctx)
      const { removeMessageReaction } =
        await import('@/lib/server/domains/conversation/message.actions')
      return await removeMessageReaction(data.messageId as ConversationMessageId, data.emoji, actor)
    } catch (error) {
      log.error({ err: error }, 'remove message reaction failed')
      throw error
    }
  })

/** Set or clear the team-wide flag on a message. */
export const setMessageFlagFn = createServerFn({ method: 'POST' })
  .validator(messageFlagSchema)
  .handler(async ({ data }) => {
    try {
      const ctx = await requireAuth({ permission: PERMISSIONS.CONVERSATION_NOTE })
      const actor = await policyActorFromAuth(ctx)
      const { setMessageFlag } = await import('@/lib/server/domains/conversation/message.actions')
      return await setMessageFlag(data.messageId as ConversationMessageId, data.flagged, actor)
    } catch (error) {
      log.error({ err: error }, 'set message flag failed')
      throw error
    }
  })

/** Mark a conversation unread for the agent side, starting at a message. */
export const markConversationUnreadFromMessageFn = createServerFn({ method: 'POST' })
  .validator(markUnreadFromMessageSchema)
  .handler(async ({ data }) => {
    try {
      const ctx = await requireAuth({ permission: PERMISSIONS.CONVERSATION_VIEW })
      const actor = await policyActorFromAuth(ctx)
      const { markConversationUnreadFromMessage } =
        await import('@/lib/server/domains/conversation/conversation.service')
      await markConversationUnreadFromMessage(
        data.conversationId as ConversationId,
        data.messageId as ConversationMessageId,
        actor
      )
      return { ok: true }
    } catch (error) {
      log.error({ err: error }, 'mark conversation unread from message failed')
      throw error
    }
  })

// ── Bulk inbox actions ─────────────────────────────────────────────────────

/**
 * One inbox bulk action, discriminated on `type`. Each variant maps 1:1 onto the
 * single-conversation service op its non-bulk fn calls, so a bulk apply is
 * exactly N individual applies (identical realtime publish + webhook + triage-wake).
 */
const bulkConversationActionSchema = z.discriminatedUnion('type', [
  // assignTo: 'me' = the acting agent, a principal id, or null to unassign.
  z.object({ type: z.literal('assign'), assignTo: z.string().nullable() }),
  z.object({ type: z.literal('assign_team'), teamId: z.string().nullable() }),
  z.object({
    type: z.literal('priority'),
    priority: z.enum(['none', 'low', 'medium', 'high', 'urgent']),
  }),
  // until: ISO wake time, or null = snooze until the customer next replies.
  z.object({ type: z.literal('snooze'), until: z.string().datetime().nullable() }),
  z.object({ type: z.literal('close') }),
  z.object({ type: z.literal('reopen') }),
])

type BulkConversationAction = z.infer<typeof bulkConversationActionSchema>

const bulkUpdateConversationsSchema = z.object({
  // Cap the batch so a single call can't fan out unbounded writes/publishes.
  conversationIds: z.array(z.string()).min(1).max(200),
  action: bulkConversationActionSchema,
})

/** Gate a bulk action on the SAME permission its single-conversation fn uses:
 *  (re)assignment mirrors assignConversationFn/assignConversationTeamFn
 *  (conversation.assign); status/priority/snooze mirror the set-status fns. */
function permissionForBulkAction(type: BulkConversationAction['type']) {
  return type === 'assign' || type === 'assign_team'
    ? PERMISSIONS.CONVERSATION_ASSIGN
    : PERMISSIONS.CONVERSATION_SET_STATUS
}

/**
 * Apply one inbox action to many conversations in a single call (support platform
 * §4.6: assign, priority, snooze, close). The required permission depends on the
 * action (assign vs status), so the gate is bare and the per-action permission is
 * asserted at runtime — matching the field-scoped PATCH pattern; the closed set is
 * declared in the authz-matrix classifications. Per-item isolation: each
 * conversation is applied independently, so one failure (missing thread, invalid
 * assignee, a race) lands in `failed` and never aborts the rest of the batch. Every
 * success reuses the single-conversation service op, so it fires the same realtime
 * publish + webhook + triage-wake — this fn adds no side effects of its own.
 */
export const bulkUpdateConversationsFn = createServerFn({ method: 'POST' })
  .validator(bulkUpdateConversationsSchema)
  .handler(async ({ data }) => {
    try {
      const ctx = await requireAuth()
      assertPermission(ctx.principal.role, permissionForBulkAction(data.action.type))
      const actor = await policyActorFromAuth(ctx)
      const {
        assignConversation,
        assignTeam,
        setConversationPriority,
        setConversationStatus,
        snoozeConversation,
      } = await import('@/lib/server/domains/conversation/conversation.service')

      // Resolve the action into a single per-conversation op once, up front — the
      // acting agent, snooze wake-time, and assignee are computed a single time,
      // not per conversation.
      const action = data.action
      const apply: (id: ConversationId) => Promise<unknown> = (() => {
        switch (action.type) {
          case 'assign': {
            const assignTo: PrincipalId | null =
              action.assignTo === 'me'
                ? ctx.principal.id
                : ((action.assignTo as PrincipalId | null) ?? null)
            return (id) => assignConversation(id, assignTo, actor)
          }
          case 'assign_team':
            return (id) => assignTeam(id, (action.teamId as TeamId | null) ?? null, actor)
          case 'priority':
            return (id) => setConversationPriority(id, action.priority, actor)
          case 'snooze': {
            const until = action.until ? new Date(action.until) : null
            return (id) => snoozeConversation(id, until, actor)
          }
          case 'close':
            return (id) => setConversationStatus(id, 'closed', actor)
          case 'reopen':
            return (id) => setConversationStatus(id, 'open', actor)
        }
      })()

      const succeeded: string[] = []
      const failed: { id: string; reason: string }[] = []
      for (const rawId of data.conversationIds) {
        try {
          await apply(rawId as ConversationId)
          succeeded.push(rawId)
        } catch (error) {
          failed.push({
            id: rawId,
            reason: error instanceof Error ? error.message : 'Unknown error',
          })
        }
      }
      return { succeeded, failed }
    } catch (error) {
      log.error({ err: error }, 'bulk update conversations failed')
      throw error
    }
  })

/** The caller's "Saved for later" feed — their flagged messages, newest first. */
export const listFlaggedMessagesFn = createServerFn({ method: 'GET' }).handler(async () => {
  try {
    const ctx = await requireAuth({ permission: PERMISSIONS.CONVERSATION_VIEW })
    const { listFlaggedMessages } =
      await import('@/lib/server/domains/conversation/conversation.query')
    return await listFlaggedMessages(ctx.principal.id)
  } catch (error) {
    log.error({ err: error }, 'list flagged messages failed')
    throw error
  }
})

export const getLinkedPostsForConversationFn = createServerFn({ method: 'GET' })
  .validator(conversationIdSchema)
  .handler(async ({ data }) => {
    try {
      await requireAuth({ permission: PERMISSIONS.CONVERSATION_VIEW })
      const { getLinkedPostsForConversation } =
        await import('@/lib/server/domains/conversation/conversation.query')
      return await getLinkedPostsForConversation(data.conversationId as ConversationId)
    } catch (error) {
      log.error({ err: error }, 'get linked posts for conversation failed')
      throw error
    }
  })

export const getLinkedConversationsForPostFn = createServerFn({ method: 'GET' })
  .validator(z.object({ postId: z.string() }))
  .handler(async ({ data }) => {
    try {
      await requireAuth({ permission: PERMISSIONS.CONVERSATION_VIEW })
      const { getLinkedConversationsForPost } =
        await import('@/lib/server/domains/conversation/conversation.query')
      return await getLinkedConversationsForPost(data.postId as PostId)
    } catch (error) {
      log.error({ err: error }, 'get linked conversations for post failed')
      throw error
    }
  })
