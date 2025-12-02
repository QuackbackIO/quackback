import { z } from 'zod'

export const commentSchema = z.object({
  content: z.string().min(1, 'Comment is required').max(5000, 'Comment is too long'),
  authorName: z.string().max(100).nullable().optional(),
  authorEmail: z.string().email('Invalid email').max(255).nullable().optional().or(z.literal('')),
  parentId: z.string().uuid().nullable().optional(),
})

export type CommentInput = z.infer<typeof commentSchema>
