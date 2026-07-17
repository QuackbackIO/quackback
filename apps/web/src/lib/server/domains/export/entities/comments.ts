/**
 * Post comments exporter.
 */
import { db, postComments, asc, isNull } from '@/lib/server/db'
import { escapeCSV } from '@/lib/server/utils/csv'
import { realEmail } from '@/lib/shared/anonymous-email'
import type { EntityExporter } from '../types'

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : '')

async function fetchComments(offset: number, limit: number) {
  return db.query.postComments.findMany({
    where: isNull(postComments.deletedAt),
    orderBy: asc(postComments.createdAt),
    offset,
    limit,
    columns: {
      id: true,
      postId: true,
      parentId: true,
      content: true,
      isTeamMember: true,
      isPrivate: true,
      moderationState: true,
      createdAt: true,
      updatedAt: true,
    },
    with: {
      author: { columns: { displayName: true }, with: { user: { columns: { email: true } } } },
    },
  })
}
type CommentRow = Awaited<ReturnType<typeof fetchComments>>[number]

export const commentsExporter: EntityExporter<CommentRow> = {
  key: 'post_comments',
  fileName: 'post_comments.csv',
  pageSize: 5000,
  header:
    'id,post_id,parent_id,author_name,author_email,is_team_member,is_private,moderation_state,content,created_at,updated_at',
  fetchPage: fetchComments,
  serialize: (c) =>
    [
      c.id,
      c.postId,
      c.parentId ?? '',
      escapeCSV(c.author?.displayName ?? ''),
      escapeCSV(realEmail(c.author?.user?.email) ?? ''),
      String(c.isTeamMember),
      String(c.isPrivate),
      c.moderationState,
      escapeCSV(c.content),
      iso(c.createdAt),
      iso(c.updatedAt),
    ].join(','),
}
