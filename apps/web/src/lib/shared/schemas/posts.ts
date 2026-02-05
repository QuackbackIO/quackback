import { z } from 'zod'
import { boardIdSchema, statusIdSchema, tagIdsSchema } from '@quackback/ids/zod'

/**
 * TipTap JSON content schema (simplified validation)
 */
export const tiptapContentSchema = z.object({
  type: z.literal('doc'),
  content: z.array(z.any()).optional(),
})

/**
 * Schema for admin creating a post
 */
export const createPostSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200),
  content: z.string().max(10000),
  contentJson: tiptapContentSchema.optional(),
  boardId: boardIdSchema,
  statusId: statusIdSchema.optional(),
  tagIds: tagIdsSchema,
})

/**
 * Schema for admin editing a post
 */
export const editPostSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200),
  content: z.string().max(10000),
  boardId: boardIdSchema,
  statusId: statusIdSchema.optional(),
  tagIds: tagIdsSchema,
})

/**
 * Schema for public post submissions (authenticated users)
 */
export const publicPostSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200),
  content: z.string().max(10000),
  contentJson: tiptapContentSchema.optional(),
})

// Inferred types from schemas (for form values - uses plain strings due to resolver inference)
export type CreatePostFormData = z.infer<typeof createPostSchema>
export type EditPostFormData = z.infer<typeof editPostSchema>
export type PublicPostFormData = z.infer<typeof publicPostSchema>
export type TiptapContent = z.infer<typeof tiptapContentSchema>
