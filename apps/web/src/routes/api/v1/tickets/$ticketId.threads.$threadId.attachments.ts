/**
 * GET  /api/v1/tickets/:ticketId/threads/:threadId/attachments
 * POST /api/v1/tickets/:ticketId/threads/:threadId/attachments
 *
 * File attachments with flexible auth:
 * - Session-based: web users with browser cookies
 * - API key: programmatic access with Authorization: Bearer header
 *
 * POST is multipart/form-data with a `file` field. Returns the created
 * `ticket_attachment` row.
 */
import { createFileRoute } from '@tanstack/react-router'
import { auth } from '@/lib/server/auth'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import { db, eq, principal } from '@/lib/server/db'
import {
  successResponse,
  createdResponse,
  forbiddenResponse,
  notFoundResponse,
  badRequestResponse,
  internalErrorResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { parseTypeId } from '@/lib/server/domains/api/validation'
import { loadPermissionSet } from '@/lib/server/domains/authz/authz.service'
import { getTicketForPortalUser } from '@/lib/server/domains/tickets/ticket.portal-query'
import {
  getTicket,
  getThread,
  attachToThread,
  listForThread,
  listSharesForTicket,
  toResourceScope,
  canViewTicket,
  canReplyPublic,
  canCommentInternal,
  canShareCrossTeam,
} from '@/lib/server/domains/tickets'
import {
  isS3Configured,
  isAllowedAttachmentType,
  MAX_ATTACHMENT_FILE_SIZE,
  generateStorageKey,
  uploadObject,
} from '@/lib/server/storage/s3'
import { getPublicOriginFromRequest } from '@/lib/server/integrations/oauth'
import type { TicketId, TicketThreadId, TeamId, PrincipalId, UserId } from '@quackback/ids'

const STORAGE_PREFIX = 'ticket-attachments'

async function loadTicketScope(ticketId: TicketId) {
  const ticket = await getTicket(ticketId)
  if (!ticket) return null
  const shares = await listSharesForTicket(ticketId)
  return {
    ticket,
    scope: toResourceScope({
      primaryTeamId: ticket.primaryTeamId as TeamId | null,
      assigneePrincipalId: ticket.assigneePrincipalId as PrincipalId | null,
      assigneeTeamId: ticket.assigneeTeamId as TeamId | null,
      shares: shares.map((s) => ({ teamId: s.teamId as TeamId, revokedAt: s.revokedAt })),
    }),
  }
}

/**
 * Try to authenticate via session (for web users) or API key (for programmatic access).
 * Returns { principalId, isSession: true } for web auth, { principalId, isSession: false } for API key.
 * Throws on auth failure.
 */
async function getAuthPrincipal(
  request: Request
): Promise<{ principalId: PrincipalId; isSession: boolean; userId: UserId | null }> {
  // Try session auth first (web users)
  const session = await auth.api.getSession({ headers: request.headers })
  if (session?.user) {
    const principalRow = await db.query.principal.findFirst({
      where: eq(principal.userId, session.user.id as UserId),
    })
    if (principalRow) {
      return {
        principalId: principalRow.id as PrincipalId,
        isSession: true,
        userId: session.user.id as UserId,
      }
    }
  }

  // Fall back to API key auth (programmatic access)
  const apiAuth = await withApiKeyAuth(request, { role: 'team' })
  return { principalId: apiAuth.principalId, isSession: false, userId: null }
}

async function canPortalUserAccessPublicThread(
  auth: { principalId: PrincipalId; isSession: boolean; userId: UserId | null },
  ticketId: TicketId,
  thread: Awaited<ReturnType<typeof getThread>>
): Promise<boolean> {
  if (!auth.isSession || !auth.userId || !thread) return false
  try {
    await getTicketForPortalUser({
      userId: auth.userId,
      ticketId,
    })
    return thread.audience === 'public'
  } catch {
    return false
  }
}

async function resolveSessionPrincipalForTicket(
  userId: UserId,
  scope: ReturnType<typeof toResourceScope>
): Promise<{ principalId: PrincipalId; canView: boolean }> {
  const principalRows = await db.query.principal.findMany({
    where: eq(principal.userId, userId),
    columns: { id: true },
  })

  if (principalRows.length === 0) {
    throw new Error('No principal found for session user')
  }

  for (const row of principalRows) {
    const set = await loadPermissionSet(row.id as PrincipalId)
    if (canViewTicket(set, scope)) {
      return { principalId: row.id as PrincipalId, canView: true }
    }
  }

  return { principalId: principalRows[0].id as PrincipalId, canView: false }
}

function serialize(row: {
  id: string
  threadId: string
  uploadedByPrincipalId: string | null
  filename: string
  mimeType: string
  sizeBytes: number
  storageKey: string
  publicUrl: string | null
  createdAt: Date
}) {
  return {
    id: row.id,
    threadId: row.threadId,
    uploadedByPrincipalId: row.uploadedByPrincipalId,
    filename: row.filename,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    storageKey: row.storageKey,
    publicUrl: row.publicUrl,
    createdAt: row.createdAt.toISOString(),
  }
}

export const Route = createFileRoute('/api/v1/tickets/$ticketId/threads/$threadId/attachments')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        try {
          const auth = await getAuthPrincipal(request)
          const ticketId = parseTypeId<TicketId>(params.ticketId, 'ticket', 'ticket ID')
          const threadId = parseTypeId<TicketThreadId>(
            params.threadId,
            'ticket_thread',
            'thread ID'
          )

          const loaded = await loadTicketScope(ticketId)
          if (!loaded) return notFoundResponse('Ticket')
          const thread = await getThread(threadId)
          if (!thread || thread.ticketId !== ticketId) return notFoundResponse('Thread')

          const effectivePrincipal =
            auth.isSession && auth.userId
              ? await resolveSessionPrincipalForTicket(auth.userId, loaded.scope)
              : {
                  principalId: auth.principalId,
                  canView: canViewTicket(await loadPermissionSet(auth.principalId), loaded.scope),
                }

          const canViewViaPermissions = effectivePrincipal.canView
          const canViewViaPortal = await canPortalUserAccessPublicThread(auth, ticketId, thread)
          if (!canViewViaPermissions && !canViewViaPortal) {
            return forbiddenResponse('Cannot view this ticket')
          }

          const rows = await listForThread(threadId)
          return successResponse(rows.map(serialize))
        } catch (error) {
          return handleDomainError(error)
        }
      },
      POST: async ({ request, params }) => {
        try {
          const auth = await getAuthPrincipal(request)
          const ticketId = parseTypeId<TicketId>(params.ticketId, 'ticket', 'ticket ID')
          const threadId = parseTypeId<TicketThreadId>(
            params.threadId,
            'ticket_thread',
            'thread ID'
          )

          const loaded = await loadTicketScope(ticketId)
          if (!loaded) return notFoundResponse('Ticket')
          const thread = await getThread(threadId)
          if (!thread || thread.deletedAt || thread.ticketId !== ticketId) {
            return notFoundResponse('Thread')
          }

          const effectivePrincipal =
            auth.isSession && auth.userId
              ? await resolveSessionPrincipalForTicket(auth.userId, loaded.scope)
              : {
                  principalId: auth.principalId,
                  canView: canViewTicket(await loadPermissionSet(auth.principalId), loaded.scope),
                }

          const set = await loadPermissionSet(effectivePrincipal.principalId)
          const canViewViaPermissions = effectivePrincipal.canView

          if (!canViewViaPermissions) {
            const canAttachViaPortal = await canPortalUserAccessPublicThread(auth, ticketId, thread)
            if (!canAttachViaPortal) {
              return forbiddenResponse('Cannot view this ticket')
            }
            if (thread.principalId !== effectivePrincipal.principalId) {
              return forbiddenResponse("Cannot attach to another author's thread")
            }
          }

          // Audience-aware reply permission gate matches the create-thread
          // route at $ticketId.threads.ts.
          if (
            canViewViaPermissions &&
            thread.audience === 'public' &&
            !canReplyPublic(set, loaded.scope)
          ) {
            return forbiddenResponse('ticket.reply_public required')
          }
          if (
            canViewViaPermissions &&
            thread.audience === 'internal' &&
            !canCommentInternal(set, loaded.scope)
          ) {
            return forbiddenResponse('ticket.comment_internal required')
          }
          if (
            canViewViaPermissions &&
            thread.audience === 'shared_team' &&
            !canShareCrossTeam(set, loaded.scope)
          ) {
            return forbiddenResponse('ticket.share_cross_team required')
          }

          if (!isS3Configured()) {
            return internalErrorResponse('Storage not configured')
          }

          let formData: FormData
          try {
            formData = await request.formData()
          } catch {
            return badRequestResponse('expected multipart/form-data')
          }
          const file = formData.get('file')
          if (!(file instanceof File)) {
            return badRequestResponse('missing "file" field')
          }
          if (!isAllowedAttachmentType(file.type)) {
            return badRequestResponse(`unsupported file type: ${file.type}`)
          }
          if (file.size === 0) {
            return badRequestResponse('file is empty')
          }
          if (file.size > MAX_ATTACHMENT_FILE_SIZE) {
            return badRequestResponse(`file exceeds ${MAX_ATTACHMENT_FILE_SIZE / 1024 / 1024}MB`)
          }

          const ext = file.name.split('.').pop() || 'bin'
          const filename = file.name || `upload-${Date.now()}.${ext}`
          const key = generateStorageKey(STORAGE_PREFIX, filename)
          const buffer = Buffer.from(await file.arrayBuffer())
          const requestOrigin = getPublicOriginFromRequest(request)
          const publicUrl = await uploadObject(key, buffer, file.type, requestOrigin)

          const created = await attachToThread({
            threadId,
            uploadedByPrincipalId: effectivePrincipal.principalId,
            filename,
            mimeType: file.type,
            sizeBytes: file.size,
            storageKey: key,
            publicUrl,
          })
          return createdResponse(serialize(created))
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
