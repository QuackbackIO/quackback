import { z } from 'zod'

export const postStatusSchema = z.enum([
  'open',
  'under_review',
  'planned',
  'in_progress',
  'complete',
  'closed',
])

export const createPostSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200),
  content: z.string().min(1, 'Description is required').max(10000),
  boardId: z.string().uuid('Select a board'),
  status: postStatusSchema,
  tagIds: z.array(z.string().uuid()),
})

export type PostStatus = z.infer<typeof postStatusSchema>
export type CreatePostInput = z.infer<typeof createPostSchema>
