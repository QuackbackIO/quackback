import { z } from 'zod'

export const commentSchema = z.object({
  content: z.string().min(1, 'Comment is required').max(5000, 'Comment is too long'),
  parentId: z.string().uuid().nullable().optional(),
})

export type CommentInput = z.infer<typeof commentSchema>
