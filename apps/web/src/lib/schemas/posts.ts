import { z } from 'zod'
import { boardIdSchema, statusIdSchema, tagIdsSchema } from '@quackback/ids/zod'
import type { BoardId, StatusId, TagId } from '@quackback/ids'

// TipTap JSON content schema (simplified validation)
export const tiptapContentSchema = z.object({
  type: z.literal('doc'),
  content: z.array(z.any()).optional(),
})

export const createPostSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200),
  content: z.string().min(1, 'Description is required').max(10000),
  contentJson: tiptapContentSchema.optional(),
  boardId: boardIdSchema,
  statusId: statusIdSchema.optional(),
  tagIds: tagIdsSchema,
})

// Manually type the output since Zod's z.custom<T> doesn't properly infer
// the branded TypeId types through z.infer<>
export type CreatePostInput = {
  title: string
  content: string
  contentJson?: z.infer<typeof tiptapContentSchema>
  boardId: BoardId
  statusId?: StatusId
  tagIds: TagId[]
}

// Simplified schema for public post submissions (authenticated users)
export const publicPostSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200),
  content: z.string().max(10000), // Plain text fallback
  contentJson: tiptapContentSchema.optional(),
})

export type PublicPostInput = z.infer<typeof publicPostSchema>
export type TiptapContent = z.infer<typeof tiptapContentSchema>
