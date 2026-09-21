import {
  db,
  eq,
  integrations,
  posts,
  tickets,
  boards,
  principal,
  postComments,
  changelogEntries,
  userSegments,
  conversations,
  conversationMessages,
} from '@/lib/server/db'
import type {
  IntegrationId,
  PostId,
  TicketId,
  PrincipalId,
  PostCommentId,
  ChangelogId,
} from '@quackback/ids'
import { installationIdentity, syncHash } from './identity'
import { permissionsForPrincipal } from '@/lib/server/policy/permissions'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { canViewPost } from '@/lib/server/policy/posts'
import { ticketFilter } from '@/lib/server/policy/tickets'
import { conversationFilter } from '@/lib/server/policy/conversations'
import { and } from '@/lib/server/db'
import type { Actor } from '@/lib/server/policy/types'
import type { SyncOperation, SyncOutcome } from './types'
import {
  getCategoriesForEntries,
  categoryGateAllows,
} from '@/lib/server/domains/changelog/changelog-category.service'

export async function currentSyncIntegration(operation: SyncOperation) {
  const integration = await db.query.integrations.findFirst({
    where: eq(integrations.id, operation.integrationId as IntegrationId),
  })
  if (
    !integration ||
    integration.status !== 'active' ||
    installationIdentity(integration) !== operation.installation
  )
    return null
  return integration
}

/** Recheck after credential refresh/network reads, immediately before dispatch. */
export async function canDispatchSync(
  operation: SyncOperation,
  expected: typeof integrations.$inferSelect,
  sourceUpdatedAt?: Date
): Promise<boolean> {
  const current = await currentSyncIntegration(operation)
  if (!current || (await validateSyncSource(operation))) return false
  const stableConfig = (value: unknown) => {
    const { tokenExpiresAt: _expiry, ...rest } = (value ?? {}) as Record<string, unknown>
    return rest
  }
  if (syncHash(stableConfig(current.config)) !== syncHash(stableConfig(expected.config)))
    return false
  if (sourceUpdatedAt && operation.sourceType === 'post') {
    const post = await db.query.posts.findFirst({
      where: eq(posts.id, operation.sourceId as PostId),
    })
    if (!post || post.updatedAt.getTime() !== sourceUpdatedAt.getTime()) return false
  }
  return true
}

export async function syncSourceForActor(
  operation: Pick<SyncOperation, 'sourceType' | 'sourceId'> & Partial<Pick<SyncOperation, 'kind'>>,
  actor: Actor
): Promise<{ id: string; title: string } | null> {
  if (operation.sourceType === 'message') {
    const message = await db.query.conversationMessages.findFirst({
      where: eq(conversationMessages.id, operation.sourceId as never),
    })
    if (!message?.conversationId || message.deletedAt || message.isInternal) return null
    return syncSourceForActor(
      { sourceType: 'conversation', sourceId: message.conversationId },
      actor
    )
  }
  if (operation.sourceType === 'conversation') {
    const [conversation] = await db
      .select({ id: conversations.id, subject: conversations.subject })
      .from(conversations)
      .where(and(eq(conversations.id, operation.sourceId as never), conversationFilter(actor)))
      .limit(1)
    return conversation
      ? { id: conversation.id, title: conversation.subject || 'Support conversation' }
      : null
  }
  if (operation.sourceType === 'comment') {
    const comment = await db.query.postComments.findFirst({
      where: eq(postComments.id, operation.sourceId as PostCommentId),
    })
    if (!comment || comment.deletedAt || comment.isPrivate) return null
    return syncSourceForActor({ sourceType: 'post', sourceId: comment.postId }, actor)
  }
  if (operation.sourceType === 'changelog') {
    const entry = await db.query.changelogEntries.findFirst({
      where: eq(changelogEntries.id, operation.sourceId as ChangelogId),
    })
    if (!entry || entry.deletedAt || !entry.publishedAt || entry.publishedAt > new Date())
      return null
    const categories = (await getCategoriesForEntries([entry.id])).get(entry.id) ?? []
    return categoryGateAllows(categories, actor) ? { id: entry.id, title: entry.title } : null
  }
  if (operation.sourceType === 'post') {
    const post = await db.query.posts.findFirst({
      where: eq(posts.id, operation.sourceId as PostId),
    })
    if (!post || (post.deletedAt && operation.kind !== 'archive')) return null
    const board = await db.query.boards.findFirst({ where: eq(boards.id, post.boardId) })
    if (!board || board.deletedAt || !canViewPost(actor, post, board).allowed) return null
    return { id: post.id, title: post.deletedAt ? 'Deleted feedback' : post.title }
  }
  if (operation.sourceType === 'ticket') {
    const [ticket] = await db
      .select({ id: tickets.id, title: tickets.title })
      .from(tickets)
      .where(and(eq(tickets.id, operation.sourceId as TicketId), ticketFilter(actor)))
      .limit(1)
    return ticket ?? null
  }
  // User/event payload details are never included in generic history previews.
  return {
    id: operation.sourceId,
    title: operation.sourceType === 'user' ? 'User data' : 'Integration event',
  }
}

export async function validateSyncSource(operation: SyncOperation): Promise<SyncOutcome | null> {
  if (operation.requestedBy) {
    const person = await db.query.principal.findFirst({
      where: eq(principal.id, operation.requestedBy as PrincipalId),
    })
    if (!person) return { state: 'cancelled', errorCode: 'source_unavailable' }
    const role = person.role === 'admin' || person.role === 'member' ? person.role : 'user'
    const permissions = await permissionsForPrincipal(person.id, role)
    if (
      !permissions.has(PERMISSIONS.INTEGRATION_MANAGE) &&
      !(operation.kind === 'archive' && permissions.has(PERMISSIONS.POST_DELETE)) &&
      !(
        operation.kind === 'create' &&
        operation.sourceType === 'ticket' &&
        permissions.has(PERMISSIONS.TICKET_ASSIGN)
      )
    ) {
      return { state: 'cancelled', errorCode: 'source_unavailable' }
    }
    const actor: Actor = {
      principalId: person.id,
      role,
      principalType: 'user',
      segmentIds: new Set(
        (
          await db
            .select({ id: userSegments.segmentId })
            .from(userSegments)
            .where(eq(userSegments.principalId, person.id))
        ).map((s) => s.id)
      ),
      permissions,
    }
    if (!(await syncSourceForActor(operation, actor)))
      return { state: 'cancelled', errorCode: 'source_unavailable' }
  }
  if (operation.kind === 'archive') return null // Explicitly captured before source deletion.
  if (operation.sourceType === 'message') {
    const message = await db.query.conversationMessages.findFirst({
      where: eq(conversationMessages.id, operation.sourceId as never),
    })
    if (!message?.conversationId || message.deletedAt || message.isInternal)
      return { state: 'cancelled', errorCode: 'source_unavailable' }
    return validateSyncSource({
      ...operation,
      requestedBy: null,
      sourceType: 'conversation',
      sourceId: message.conversationId,
    })
  }
  if (operation.sourceType === 'conversation') {
    const conversation = await db.query.conversations.findFirst({
      where: eq(conversations.id, operation.sourceId as never),
    })
    if (!conversation) return { state: 'cancelled', errorCode: 'source_unavailable' }
  }
  if (operation.sourceType === 'comment') {
    const comment = await db.query.postComments.findFirst({
      where: eq(postComments.id, operation.sourceId as PostCommentId),
    })
    if (
      !comment ||
      comment.deletedAt ||
      comment.isPrivate ||
      comment.moderationState !== 'published'
    )
      return { state: 'cancelled', errorCode: 'source_unavailable' }
    return validateSyncSource({
      ...operation,
      requestedBy: null,
      sourceType: 'post',
      sourceId: comment.postId,
    })
  }
  if (operation.sourceType === 'changelog') {
    const entry = await db.query.changelogEntries.findFirst({
      where: eq(changelogEntries.id, operation.sourceId as ChangelogId),
    })
    if (!entry || entry.deletedAt || !entry.publishedAt || entry.publishedAt > new Date())
      return { state: 'cancelled', errorCode: 'source_unavailable' }
  }
  if (operation.sourceType === 'post') {
    const post = await db.query.posts.findFirst({
      where: eq(posts.id, operation.sourceId as PostId),
    })
    if (!post || post.deletedAt || post.moderationState !== 'published')
      return { state: 'cancelled', errorCode: 'source_unavailable' }
    const board = await db.query.boards.findFirst({ where: eq(boards.id, post.boardId) })
    if (!board || board.deletedAt) return { state: 'cancelled', errorCode: 'source_unavailable' }
  }
  if (operation.sourceType === 'ticket') {
    const ticket = await db.query.tickets.findFirst({
      where: eq(tickets.id, operation.sourceId as TicketId),
    })
    if (!ticket || ticket.deletedAt) return { state: 'cancelled', errorCode: 'source_unavailable' }
  }
  return null
}
