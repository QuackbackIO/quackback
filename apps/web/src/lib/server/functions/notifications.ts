/**
 * Server functions for in-app notification operations
 */

import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import type { NotificationId, TicketId, PrincipalId, TeamId } from '@quackback/ids'
import { requireAuth, policyActorFromAuth } from './auth-helpers'
import {
  getNotificationsForMember,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  archiveNotification,
} from '@/lib/server/domains/notifications/notification.service'
import {
  subscribeToTicket,
  unsubscribeFromTicket,
  updateSubscriptionPrefs,
  muteTicket as muteTicketSubscription,
  unmuteTicket as unmuteTicketSubscription,
  listSubscribersForTicket,
  getSubscription,
  listSubscriptionsForPrincipalWithTickets,
} from '@/lib/server/domains/tickets/ticket.subscriptions'
import { getTicket } from '@/lib/server/domains/tickets/ticket.service'
import { listSharesForTicket } from '@/lib/server/domains/tickets/ticket.share'
import { canViewTicket, toResourceScope } from '@/lib/server/domains/tickets/ticket.permissions'
import { loadPermissionSet } from '@/lib/server/domains/authz/authz.service'
import { ForbiddenError, NotFoundError } from '@/lib/shared/errors'

// ============================================
// Schemas
// ============================================

const getNotificationsSchema = z.object({
  limit: z.number().min(1).max(100).optional().default(20),
  offset: z.number().min(0).optional().default(0),
  unreadOnly: z.boolean().optional().default(false),
})

const notificationIdSchema = z.object({
  notificationId: z.string(),
})

// ============================================
// Read Operations
// ============================================

/**
 * Get notifications for the current user with pagination
 */
export const getNotificationsFn = createServerFn({ method: 'GET' })
  .inputValidator(getNotificationsSchema)
  .handler(async ({ data }) => {
    console.log(
      `[fn:notifications] getNotificationsFn: limit=${data.limit}, offset=${data.offset}, unreadOnly=${data.unreadOnly}`
    )
    try {
      const auth = await requireAuth({ roles: ['admin', 'member', 'user'] })
      // Resolve the actor so audience-denied posts get their preview
      // hidden in the notification list.
      const actor = await policyActorFromAuth(auth)

      const result = await getNotificationsForMember(
        auth.principal.id,
        {
          limit: data.limit,
          offset: data.offset,
          unreadOnly: data.unreadOnly,
        },
        actor
      )

      // Serialize dates for JSON transport
      return {
        notifications: result.notifications.map((n) => ({
          id: n.id,
          principalId: n.principalId,
          type: n.type,
          title: n.title,
          body: n.body,
          postId: n.postId,
          commentId: n.commentId,
          ticketId: n.ticketId ?? null,
          readAt: n.readAt?.toISOString() ?? null,
          archivedAt: n.archivedAt?.toISOString() ?? null,
          createdAt: n.createdAt.toISOString(),
          post: n.post,
        })),
        total: result.total,
        unreadCount: result.unreadCount,
        hasMore: result.hasMore,
      }
    } catch (error) {
      console.error(`[fn:notifications] getNotificationsFn failed:`, error)
      throw error
    }
  })

/**
 * Get unread notification count for the current user (for badge display)
 */
export const getUnreadCountFn = createServerFn({ method: 'GET' }).handler(async () => {
  console.log(`[fn:notifications] getUnreadCountFn`)
  try {
    const auth = await requireAuth({ roles: ['admin', 'member', 'user'] })
    const count = await getUnreadCount(auth.principal.id)
    return { count }
  } catch (error) {
    console.error(`[fn:notifications] getUnreadCountFn failed:`, error)
    throw error
  }
})

// ============================================
// Write Operations
// ============================================

/**
 * Mark a single notification as read
 */
export const markNotificationAsReadFn = createServerFn({ method: 'POST' })
  .inputValidator(notificationIdSchema)
  .handler(async ({ data }) => {
    console.log(
      `[fn:notifications] markNotificationAsReadFn: notificationId=${data.notificationId}`
    )
    try {
      const auth = await requireAuth({ roles: ['admin', 'member', 'user'] })
      await markAsRead(auth.principal.id, data.notificationId as NotificationId)
      return { success: true }
    } catch (error) {
      console.error(`[fn:notifications] markNotificationAsReadFn failed:`, error)
      throw error
    }
  })

/**
 * Mark all notifications as read for the current user
 */
export const markAllNotificationsAsReadFn = createServerFn({ method: 'POST' }).handler(async () => {
  console.log(`[fn:notifications] markAllNotificationsAsReadFn`)
  try {
    const auth = await requireAuth({ roles: ['admin', 'member', 'user'] })
    await markAllAsRead(auth.principal.id)
    return { success: true }
  } catch (error) {
    console.error(`[fn:notifications] markAllNotificationsAsReadFn failed:`, error)
    throw error
  }
})

/**
 * Archive (soft delete) a notification
 */
export const archiveNotificationFn = createServerFn({ method: 'POST' })
  .inputValidator(notificationIdSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:notifications] archiveNotificationFn: notificationId=${data.notificationId}`)
    try {
      const auth = await requireAuth({ roles: ['admin', 'member', 'user'] })
      await archiveNotification(auth.principal.id, data.notificationId as NotificationId)
      return { success: true }
    } catch (error) {
      console.error(`[fn:notifications] archiveNotificationFn failed:`, error)
      throw error
    }
  })

// ============================================
// Phase 7: Ticket subscription server functions
// ============================================

/**
 * Assert the authed principal can view the given ticket. Throws NotFoundError
 * if missing, ForbiddenError if visible-but-not-permitted (404 vs 403 split
 * matches the rest of the API surface).
 */
async function assertCanViewTicket(ticketId: TicketId, principalId: PrincipalId): Promise<void> {
  const ticket = await getTicket(ticketId)
  if (!ticket) throw new NotFoundError('TICKET_NOT_FOUND', `ticket ${ticketId} not found`)
  const shares = await listSharesForTicket(ticketId)
  const scope = toResourceScope({
    primaryTeamId: ticket.primaryTeamId,
    assigneePrincipalId: ticket.assigneePrincipalId,
    assigneeTeamId: ticket.assigneeTeamId,
    shares: shares.map((s) => ({ teamId: s.teamId as TeamId, revokedAt: s.revokedAt })),
  })
  const set = await loadPermissionSet(principalId)
  if (!canViewTicket(set, scope)) {
    throw new ForbiddenError('TICKET_FORBIDDEN', 'cannot view ticket')
  }
}

const ticketIdInput = z.object({ ticketId: z.string() })

const ticketSubscribeInput = z.object({
  ticketId: z.string(),
  prefs: z
    .object({
      notifyThreads: z.boolean().optional(),
      notifyStatus: z.boolean().optional(),
      notifyAssignment: z.boolean().optional(),
      notifyParticipants: z.boolean().optional(),
      notifyShares: z.boolean().optional(),
      notifySla: z.boolean().optional(),
    })
    .optional(),
})

const ticketUpdatePrefsInput = z.object({
  ticketId: z.string(),
  patch: z.object({
    notifyThreads: z.boolean().optional(),
    notifyStatus: z.boolean().optional(),
    notifyAssignment: z.boolean().optional(),
    notifyParticipants: z.boolean().optional(),
    notifyShares: z.boolean().optional(),
    notifySla: z.boolean().optional(),
  }),
})

const ticketMuteInput = z.object({
  ticketId: z.string(),
  untilIso: z.string().datetime().optional(),
})

export const subscribeToTicketFn = createServerFn({ method: 'POST' })
  .inputValidator(ticketSubscribeInput)
  .handler(async ({ data }) => {
    const auth = await requireAuth({ roles: ['admin', 'member', 'user'] })
    const ticketId = data.ticketId as TicketId
    await assertCanViewTicket(ticketId, auth.principal.id)
    const row = await subscribeToTicket({
      ticketId,
      principalId: auth.principal.id,
      source: 'manual',
      prefs: data.prefs,
    })
    return { id: row.id, source: row.source }
  })

export const unsubscribeFromTicketFn = createServerFn({ method: 'POST' })
  .inputValidator(ticketIdInput)
  .handler(async ({ data }) => {
    const auth = await requireAuth({ roles: ['admin', 'member', 'user'] })
    const ticketId = data.ticketId as TicketId
    await assertCanViewTicket(ticketId, auth.principal.id)
    const removed = await unsubscribeFromTicket(ticketId, auth.principal.id)
    return { removed }
  })

export const updateTicketSubscriptionPrefsFn = createServerFn({ method: 'POST' })
  .inputValidator(ticketUpdatePrefsInput)
  .handler(async ({ data }) => {
    const auth = await requireAuth({ roles: ['admin', 'member', 'user'] })
    const ticketId = data.ticketId as TicketId
    await assertCanViewTicket(ticketId, auth.principal.id)
    const updated = await updateSubscriptionPrefs({
      ticketId,
      principalId: auth.principal.id,
      patch: data.patch,
      // Server-fns are user-driven manual writes; allow them to upgrade auto rows.
      force: true,
    })
    if (!updated) throw new NotFoundError('TICKET_SUB_NOT_FOUND', 'no subscription to update')
    return { id: updated.id, source: updated.source }
  })

export const muteTicketFn = createServerFn({ method: 'POST' })
  .inputValidator(ticketMuteInput)
  .handler(async ({ data }) => {
    const auth = await requireAuth({ roles: ['admin', 'member', 'user'] })
    const ticketId = data.ticketId as TicketId
    await assertCanViewTicket(ticketId, auth.principal.id)
    const until = data.untilIso ? new Date(data.untilIso) : null
    const row = await muteTicketSubscription(ticketId, auth.principal.id, until)
    return { mutedUntil: row?.mutedUntil?.toISOString() ?? null }
  })

export const unmuteTicketFn = createServerFn({ method: 'POST' })
  .inputValidator(ticketIdInput)
  .handler(async ({ data }) => {
    const auth = await requireAuth({ roles: ['admin', 'member', 'user'] })
    const ticketId = data.ticketId as TicketId
    await assertCanViewTicket(ticketId, auth.principal.id)
    await unmuteTicketSubscription(ticketId, auth.principal.id)
    return { success: true }
  })

export const listTicketSubscriptionsFn = createServerFn({ method: 'GET' })
  .inputValidator(ticketIdInput)
  .handler(async ({ data }) => {
    const auth = await requireAuth({ roles: ['admin', 'member', 'user'] })
    const ticketId = data.ticketId as TicketId
    await assertCanViewTicket(ticketId, auth.principal.id)
    const rows = await listSubscribersForTicket(ticketId)
    return rows.map((r) => ({
      id: r.id,
      principalId: r.principalId,
      source: r.source,
      notifyThreads: r.notifyThreads,
      notifyStatus: r.notifyStatus,
      notifyAssignment: r.notifyAssignment,
      notifyParticipants: r.notifyParticipants,
      notifyShares: r.notifyShares,
      notifySla: r.notifySla,
      mutedUntil: r.mutedUntil?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    }))
  })

export const getMyTicketSubscriptionFn = createServerFn({ method: 'GET' })
  .inputValidator(ticketIdInput)
  .handler(async ({ data }) => {
    const auth = await requireAuth({ roles: ['admin', 'member', 'user'] })
    const ticketId = data.ticketId as TicketId
    await assertCanViewTicket(ticketId, auth.principal.id)
    const row = await getSubscription(ticketId, auth.principal.id)
    if (!row) return null
    return {
      id: row.id,
      source: row.source,
      notifyThreads: row.notifyThreads,
      notifyStatus: row.notifyStatus,
      notifyAssignment: row.notifyAssignment,
      notifyParticipants: row.notifyParticipants,
      notifyShares: row.notifyShares,
      notifySla: row.notifySla,
      mutedUntil: row.mutedUntil?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    }
  })

const listMyTicketSubscriptionsInput = z.object({
  limit: z.number().min(1).max(100).optional(),
  cursor: z.object({ createdAt: z.string().datetime(), id: z.string() }).optional().nullable(),
})

export const listMyTicketSubscriptionsFn = createServerFn({ method: 'GET' })
  .inputValidator(listMyTicketSubscriptionsInput)
  .handler(async ({ data }) => {
    const auth = await requireAuth({ roles: ['admin', 'member', 'user'] })
    const limit = data.limit ?? 50
    const cursor = data.cursor
      ? {
          createdAt: new Date(data.cursor.createdAt),
          id: data.cursor.id as import('@quackback/ids').TicketSubscriptionId,
        }
      : null
    const rows = await listSubscriptionsForPrincipalWithTickets(auth.principal.id, {
      limit,
      cursor,
    })
    const last = rows.length === limit ? rows[rows.length - 1] : null
    return {
      subscriptions: rows.map((r) => ({
        id: r.id,
        ticketId: r.ticketId,
        source: r.source,
        notifyThreads: r.notifyThreads,
        notifyStatus: r.notifyStatus,
        notifyAssignment: r.notifyAssignment,
        notifyParticipants: r.notifyParticipants,
        notifyShares: r.notifyShares,
        notifySla: r.notifySla,
        mutedUntil: r.mutedUntil?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
        ticket: {
          id: r.ticket.id,
          subject: r.ticket.subject,
          statusId: r.ticket.statusId,
          priority: r.ticket.priority,
          channel: r.ticket.channel,
          updatedAt: r.ticket.updatedAt.toISOString(),
        },
      })),
      nextCursor: last ? { createdAt: last.createdAt.toISOString(), id: last.id } : null,
    }
  })
