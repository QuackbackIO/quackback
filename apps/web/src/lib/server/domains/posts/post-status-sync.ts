import { eq, posts, postStatuses, boards, postActivity, type Transaction } from '@/lib/server/db'
import type { PostId, PostStatusId, PrincipalId } from '@quackback/ids'
import { emit } from '@/lib/server/events/emit'
import { postStatusChanged } from '@/lib/server/events/catalogue/post'

/** The inbound receipt owns this transaction, including activity and the domain outbox. */
export async function applySyncedPostStatus(
  tx: Transaction,
  postId: PostId,
  statusId: PostStatusId | null,
  principalId: PrincipalId,
  external: Record<string, unknown>
) {
  const [post] = await tx.select().from(posts).where(eq(posts.id, postId)).for('update')
  if (!post || post.deletedAt) throw new Error('Post unavailable')
  await tx
    .insert(postActivity)
    .values({ postId, principalId, type: 'external.status_changed', metadata: external })
  if (!statusId || statusId === post.statusId) return
  const [target, previous, board] = await Promise.all([
    tx.query.postStatuses.findFirst({ where: eq(postStatuses.id, statusId) }),
    post.statusId
      ? tx.query.postStatuses.findFirst({ where: eq(postStatuses.id, post.statusId) })
      : null,
    tx.query.boards.findFirst({ where: eq(boards.id, post.boardId) }),
  ])
  if (!target || !board) throw new Error('Status mapping unavailable')
  await tx.update(posts).set({ statusId, updatedAt: new Date() }).where(eq(posts.id, postId))
  await tx.insert(postActivity).values({
    postId,
    principalId,
    type: 'status.changed',
    metadata: {
      fromName: previous?.name ?? 'Open',
      fromColor: previous?.color ?? null,
      toName: target.name,
      toSlug: target.slug,
      toColor: target.color,
    },
  })
  await emit(tx, postStatusChanged, {
    entityId: postId,
    actor: { type: 'service', id: principalId },
    payload: {
      post: { id: postId, title: post.title, boardId: board.id, boardSlug: board.slug },
      previousStatus: previous?.name ?? 'Open',
      newStatus: target.name,
    },
    context: { source: 'integration-sync' },
  })
}
