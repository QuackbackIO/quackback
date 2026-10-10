import { z } from 'zod'

export const commentSchema = z.object({
  content: z.string().min(1, 'Comment is required').max(5000, 'Comment is too long'),
  /** Pre-computed TipTap doc from the rich editor. Optional - API clients
   * posting markdown only let the server derive it via commentMarkdownToTiptapJson. */
  contentJson: z.unknown().nullable().optional(),
  parentId: z.string().nullable().optional(), // Requires comment_xxx format (validated in route)
  isPrivate: z.boolean().optional(),
})

export type CommentInput = z.infer<typeof commentSchema>

export const createCommentSchema = z.object({
  postId: z.string(),
  content: z.string().min(1).max(5000),
  contentJson: z.unknown().nullable().optional(),
  parentId: z.string().optional(),
  statusId: z.string().optional(),
  isPrivate: z.boolean().optional(),
})
export type CreateCommentInput = z.infer<typeof createCommentSchema>

export const reactionSchema = z.object({
  commentId: z.string(),
  emoji: z.string(),
})
export type ReactionInput = z.infer<typeof reactionSchema>
