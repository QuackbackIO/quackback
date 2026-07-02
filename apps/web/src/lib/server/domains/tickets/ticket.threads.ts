/**
 * Ticket threads — public replies, internal comments, and shared-team notes.
 *
 * Audience semantics:
 *   - `public`        visible to the requester / portal user; counts toward
 *                     first-response time
 *   - `internal`      agents only; never sent to the requester
 *   - `shared_team`   visible only to members of the explicitly-shared team
 *                     (uses `ticket_shares`)
 *
 * `firstResponseAt` is a one-shot side effect: the first PUBLIC thread by a
 * principal who is *not* the requester sets it. Internal-only threads never
 * trigger first-response tracking.
 */
import {
  db,
  eq,
  and,
  isNull,
  asc,
  inArray,
  tickets,
  ticketThreads,
  ticketShares,
  TICKET_THREAD_AUDIENCES,
  type TicketThread,
  type TicketThreadAudience,
  type TiptapContent,
} from '@/lib/server/db'
import type { TicketId, TicketThreadId, PrincipalId, TeamId } from '@quackback/ids'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/shared/errors'
import { recordEvent } from '../audit'
import { sanitizeTiptapContent } from '@/lib/server/sanitize-tiptap'
import { tiptapToPlainText } from './tiptap-text'
import { writeActivity } from './ticket.service'

const BODY_TEXT_MAX = 100_000

export interface AddThreadInput {
  ticketId: TicketId
  principalId: PrincipalId | null
  audience: TicketThreadAudience
  bodyJson?: TiptapContent | null
  bodyText?: string | null
  sharedWithTeamId?: TeamId | null
  syncSourceIntegrationId?: string | null
}

function threadPreview(bodyText: string): { bodyTextPreview: string; bodyTextTruncated: boolean } {
  const PREVIEW_MAX = 500
  return {
    bodyTextPreview: bodyText.length > PREVIEW_MAX ? bodyText.slice(0, PREVIEW_MAX) : bodyText,
    bodyTextTruncated: bodyText.length > PREVIEW_MAX,
  }
}

export async function addThread(input: AddThreadInput): Promise<TicketThread> {
  if (!TICKET_THREAD_AUDIENCES.includes(input.audience)) {
    throw new ValidationError('TICKET_THREAD_AUDIENCE_INVALID', 'invalid audience')
  }
  if (input.audience === 'shared_team' && !input.sharedWithTeamId) {
    throw new ValidationError(
      'TICKET_THREAD_SHARED_TEAM_REQUIRED',
      'sharedWithTeamId is required for shared_team audience'
    )
  }
  if (input.audience !== 'shared_team' && input.sharedWithTeamId) {
    throw new ValidationError(
      'TICKET_THREAD_SHARED_TEAM_NOT_ALLOWED',
      'sharedWithTeamId only valid for shared_team audience'
    )
  }

  const ticket = await db.query.tickets.findFirst({
    where: and(eq(tickets.id, input.ticketId), isNull(tickets.deletedAt)),
  })
  if (!ticket) throw new NotFoundError('TICKET_NOT_FOUND', `ticket ${input.ticketId} not found`)

  // For shared_team threads the team must actually have an active share grant.
  if (input.audience === 'shared_team') {
    const grant = await db.query.ticketShares.findFirst({
      where: and(
        eq(ticketShares.ticketId, input.ticketId),
        eq(ticketShares.teamId, input.sharedWithTeamId!),
        isNull(ticketShares.revokedAt)
      ),
    })
    if (!grant) {
      throw new ForbiddenError(
        'TICKET_THREAD_SHARE_MISSING',
        'cannot post a shared_team thread without an active share grant'
      )
    }
  }

  const sanitizedJson = input.bodyJson ? sanitizeTiptapContent(input.bodyJson) : null
  const bodyText =
    input.bodyText?.trim() || (sanitizedJson ? tiptapToPlainText(sanitizedJson) : '') || ''
  if (!bodyText) {
    throw new ValidationError('TICKET_THREAD_EMPTY', 'thread body cannot be empty')
  }
  if (bodyText.length > BODY_TEXT_MAX) {
    throw new ValidationError('TICKET_THREAD_TOO_LONG', `thread exceeds ${BODY_TEXT_MAX} chars`)
  }

  const [created] = await db
    .insert(ticketThreads)
    .values({
      ticketId: input.ticketId,
      principalId: input.principalId,
      audience: input.audience,
      bodyJson: sanitizedJson,
      bodyText,
      sharedWithTeamId: input.sharedWithTeamId ?? null,
    })
    .returning()

  // Maintain ticket header counters / first-response timestamp.
  const now = new Date()
  const headerPatch: Record<string, unknown> = { lastActivityAt: now }
  const firstResponseFired =
    input.audience === 'public' &&
    !ticket.firstResponseAt &&
    input.principalId !== null &&
    input.principalId !== ticket.requesterPrincipalId
  if (firstResponseFired) {
    headerPatch.firstResponseAt = now
  }
  await db.update(tickets).set(headerPatch).where(eq(tickets.id, input.ticketId))

  await writeActivity(input.ticketId, input.principalId, 'thread.added', {
    threadId: created.id,
    audience: input.audience,
  })
  void recordEvent({
    principalId: input.principalId,
    action: 'ticket.thread_added',
    targetType: 'ticket',
    targetId: input.ticketId,
    diff: { context: { threadId: created.id, audience: input.audience } },
  })

  // Phase 5: SLA hooks for public threads. Best-effort.
  if (input.audience === 'public') {
    try {
      const refreshedTicket = { ...ticket, ...headerPatch } as typeof ticket
      const isFromCustomer =
        input.principalId != null && input.principalId === ticket.requesterPrincipalId
      if (isFromCustomer) {
        const { onCustomerReply } = await import('../sla/sla.engine')
        await onCustomerReply(refreshedTicket, input.principalId)
      } else if (input.principalId) {
        const { onPublicAgentReply } = await import('../sla/sla.engine')
        await onPublicAgentReply(refreshedTicket, input.principalId)
      }
    } catch (err) {
      console.warn('[tickets] sla thread hook failed', err)
    }
  }

  // Phase 7: dispatch thread-added notification (audience-aware).
  try {
    const refreshedTicket = { ...ticket, ...headerPatch } as typeof ticket
    const { notifyThreadAdded } = await import('./ticket.notifications')
    await notifyThreadAdded(
      refreshedTicket,
      created.id,
      input.audience,
      input.sharedWithTeamId ?? null,
      { actorPrincipalId: input.principalId }
    )
  } catch (err) {
    console.warn('[tickets] notifyThreadAdded failed', err)
  }

  // Phase 7.5: outbound webhook event (internal threads are filtered out
  // inside getWebhookTargets so they never leave the workspace).
  try {
    const refreshedTicket = { ...ticket, ...headerPatch } as typeof ticket
    const { dispatchTicketThreadAdded, dispatchTicketFirstResponse, buildEventActor } =
      await import('@/lib/server/events/dispatch')
    const actor = input.principalId
      ? buildEventActor({ principalId: input.principalId, displayName: 'ticket-system' })
      : { type: 'service' as const, displayName: 'ticket-system' }
    if (firstResponseFired) {
      await dispatchTicketFirstResponse(
        actor,
        refreshedTicket as unknown as Record<string, unknown>,
        created.id,
        typeof now === 'string' ? now : now.toISOString(),
        { syncSourceIntegrationId: input.syncSourceIntegrationId }
      )
    }
    const isFromRequester =
      input.principalId !== null && input.principalId === ticket.requesterPrincipalId
    await dispatchTicketThreadAdded(
      actor,
      refreshedTicket as unknown as Record<string, unknown>,
      created.id,
      input.audience,
      input.sharedWithTeamId ?? null,
      {
        ...threadPreview(bodyText),
        bodyText,
        authorPrincipalId: input.principalId,
        isFromRequester,
        createdAt: created.createdAt ?? now,
      },
      { syncSourceIntegrationId: input.syncSourceIntegrationId }
    )
  } catch (err) {
    console.warn('[tickets] dispatchTicketThreadAdded failed', err)
  }

  return created
}

export interface EditThreadInput {
  threadId: TicketThreadId
  actorPrincipalId: PrincipalId | null
  bodyJson?: TiptapContent | null
  bodyText?: string | null
  syncSourceIntegrationId?: string | null
}

export async function editThread(input: EditThreadInput): Promise<TicketThread> {
  const existing = await db.query.ticketThreads.findFirst({
    where: eq(ticketThreads.id, input.threadId),
  })
  if (!existing || existing.deletedAt) {
    throw new NotFoundError('TICKET_THREAD_NOT_FOUND', `thread ${input.threadId} not found`)
  }
  if (existing.principalId && existing.principalId !== input.actorPrincipalId) {
    throw new ForbiddenError('TICKET_THREAD_NOT_OWNER', "cannot edit another user's thread")
  }
  const sanitizedJson = input.bodyJson ? sanitizeTiptapContent(input.bodyJson) : existing.bodyJson
  const bodyText =
    input.bodyText?.trim() ||
    (sanitizedJson ? tiptapToPlainText(sanitizedJson) : '') ||
    existing.bodyText
  if (!bodyText) {
    throw new ValidationError('TICKET_THREAD_EMPTY', 'thread body cannot be empty')
  }
  const [updated] = await db
    .update(ticketThreads)
    .set({
      bodyJson: sanitizedJson,
      bodyText,
      editedAt: new Date(),
      editedByPrincipalId: input.actorPrincipalId,
    })
    .where(eq(ticketThreads.id, input.threadId))
    .returning()
  await writeActivity(existing.ticketId as TicketId, input.actorPrincipalId, 'thread.edited', {
    threadId: existing.id,
  })
  try {
    const ticket = await db.query.tickets.findFirst({
      where: and(eq(tickets.id, existing.ticketId as TicketId), isNull(tickets.deletedAt)),
    })
    if (ticket) {
      const { dispatchTicketThreadUpdated, buildEventActor } =
        await import('@/lib/server/events/dispatch')
      const actor = input.actorPrincipalId
        ? buildEventActor({
            principalId: input.actorPrincipalId,
            displayName: 'ticket-system',
          })
        : { type: 'service' as const, displayName: 'ticket-system' }
      const isFromRequester =
        existing.principalId !== null && existing.principalId === ticket.requesterPrincipalId
      await dispatchTicketThreadUpdated(
        actor,
        ticket as unknown as Record<string, unknown>,
        updated.id,
        updated.audience,
        (updated.sharedWithTeamId as TeamId | null) ?? null,
        {
          ...threadPreview(bodyText),
          bodyText,
          authorPrincipalId: (updated.principalId as PrincipalId | null) ?? null,
          isFromRequester,
          createdAt: updated.createdAt,
          editedAt: updated.editedAt ?? null,
        },
        { syncSourceIntegrationId: input.syncSourceIntegrationId }
      )
    }
  } catch (err) {
    console.warn('[tickets] dispatchTicketThreadUpdated failed', err)
  }
  return updated
}

export async function softDeleteThread(
  threadId: TicketThreadId,
  actorPrincipalId: PrincipalId | null,
  syncSourceIntegrationId?: string | null
): Promise<TicketThread> {
  const existing = await db.query.ticketThreads.findFirst({
    where: eq(ticketThreads.id, threadId),
  })
  if (!existing) throw new NotFoundError('TICKET_THREAD_NOT_FOUND', `thread ${threadId} not found`)
  if (existing.deletedAt) {
    throw new ConflictError('TICKET_THREAD_ALREADY_DELETED', 'thread already deleted')
  }
  const [updated] = await db
    .update(ticketThreads)
    .set({ deletedAt: new Date() })
    .where(eq(ticketThreads.id, threadId))
    .returning()
  await writeActivity(existing.ticketId as TicketId, actorPrincipalId, 'thread.deleted', {
    threadId: existing.id,
  })
  try {
    const ticket = await db.query.tickets.findFirst({
      where: and(eq(tickets.id, existing.ticketId as TicketId), isNull(tickets.deletedAt)),
    })
    if (ticket) {
      const { dispatchTicketThreadDeleted, buildEventActor } =
        await import('@/lib/server/events/dispatch')
      const actor = actorPrincipalId
        ? buildEventActor({ principalId: actorPrincipalId, displayName: 'ticket-system' })
        : { type: 'service' as const, displayName: 'ticket-system' }
      await dispatchTicketThreadDeleted(
        actor,
        ticket as unknown as Record<string, unknown>,
        updated.id,
        updated.audience,
        (updated.sharedWithTeamId as TeamId | null) ?? null,
        actorPrincipalId,
        {
          ...threadPreview(existing.bodyText ?? ''),
          bodyText: existing.bodyText ?? '',
          authorPrincipalId: (existing.principalId as PrincipalId | null) ?? null,
          isFromRequester:
            existing.principalId !== null && existing.principalId === ticket.requesterPrincipalId,
          createdAt: existing.createdAt,
        },
        { syncSourceIntegrationId }
      )
    }
  } catch (err) {
    console.warn('[tickets] dispatchTicketThreadDeleted failed', err)
  }
  return updated
}

export interface ListThreadsOptions {
  /** Caller's team memberships — used to filter shared_team audience rows. */
  viewerTeamIds: readonly TeamId[]
  /** True if the viewer can see internal comments. */
  canSeeInternal: boolean
  /** True if the viewer is the requester (sees public-only). */
  isRequester?: boolean
  includeDeleted?: boolean
}

export async function listThreads(
  ticketId: TicketId,
  options: ListThreadsOptions
): Promise<TicketThread[]> {
  const conditions = [eq(ticketThreads.ticketId, ticketId)]
  if (!options.includeDeleted) conditions.push(isNull(ticketThreads.deletedAt))
  const rows = await db
    .select()
    .from(ticketThreads)
    .where(and(...conditions))
    .orderBy(asc(ticketThreads.createdAt))

  return rows.filter((row) => {
    if (row.audience === 'public') return true
    if (options.isRequester) return false
    if (row.audience === 'internal') return options.canSeeInternal
    if (row.audience === 'shared_team') {
      if (!row.sharedWithTeamId) return false
      return options.viewerTeamIds.includes(row.sharedWithTeamId as TeamId)
    }
    return false
  })
}

export async function getThread(threadId: TicketThreadId): Promise<TicketThread | null> {
  const row = await db.query.ticketThreads.findFirst({
    where: eq(ticketThreads.id, threadId),
  })
  return row ?? null
}

export async function loadThreadsByTicketIds(
  ticketIds: readonly TicketId[]
): Promise<TicketThread[]> {
  if (ticketIds.length === 0) return []
  return db
    .select()
    .from(ticketThreads)
    .where(
      and(inArray(ticketThreads.ticketId, ticketIds as TicketId[]), isNull(ticketThreads.deletedAt))
    )
    .orderBy(asc(ticketThreads.createdAt))
}

/**
 * Portal-safe thread fetch — returns ONLY `audience='public'` rows for a ticket.
 *
 * Delegates to `listThreads` with `isRequester: true`, which the existing
 * audience filter already collapses to public-only. Keeps the audience policy
 * defined in exactly one place.
 */
export async function listPublicThreadsForTicket(ticketId: TicketId): Promise<TicketThread[]> {
  return listThreads(ticketId, {
    viewerTeamIds: [],
    canSeeInternal: false,
    isRequester: true,
  })
}
