/**
 * Shared utilities for admin post detail views.
 *
 * Used by both PostModalContent (editable) and MergePreviewModal (readonly).
 */

import type { JSONContent } from '@tiptap/react'
import type { CommentId } from '@quackback/ids'
import type { PostDetails } from '@/lib/shared/types'
import type { PublicCommentView } from '@/lib/client/queries/portal-detail'

/** Convert admin comments to portal-compatible format */
export function toPortalComments(post: PostDetails): PublicCommentView[] {
  const mapComment = (c: PostDetails['comments'][0]): PublicCommentView => ({
    id: c.id as CommentId,
    content: c.content,
    authorName: c.authorName,
    principalId: c.principalId,
    createdAt: c.createdAt,
    deletedAt: c.deletedAt ?? null,
    isRemovedByTeam:
      !!c.deletedAt && !!c.deletedByPrincipalId && c.deletedByPrincipalId !== c.principalId,
    parentId: c.parentId as CommentId | null,
    isTeamMember: c.isTeamMember,
    isPrivate: c.isPrivate,
    avatarUrl: (c.principalId && post.avatarUrls?.[c.principalId]) || null,
    statusChange: c.statusChange ?? null,
    reactions: c.reactions,
    replies: c.replies.map(mapComment),
  })
  return post.comments.map(mapComment)
}

/** Convert plain text to TipTap JSON format for posts without contentJson */
export function getInitialContentJson(post: {
  contentJson?: unknown
  content: string
}): JSONContent | null {
  if (post.contentJson) {
    return post.contentJson as JSONContent
  }
  if (post.content) {
    return {
      type: 'doc',
      content: post.content.split('\n').map((line) => ({
        type: 'paragraph',
        content: line ? [{ type: 'text', text: line }] : [],
      })),
    }
  }
  return null
}
