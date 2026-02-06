import { z } from 'zod'
import { boardIdSchema, statusIdSchema, tagIdsSchema } from '@quackback/ids/zod'

/**
 * TipTap mark schema - validates mark types and their attributes
 */
const tiptapMarkSchema = z.object({
  type: z.enum(['bold', 'italic', 'underline', 'strike', 'code', 'link']),
  attrs: z
    .object({
      href: z.string().optional(),
      target: z.string().optional(),
      rel: z.string().optional(),
    })
    .passthrough()
    .optional(),
})

/**
 * TipTap node schema - validates node types and basic structure.
 * Uses z.lazy for recursive content validation.
 *
 * Type annotation uses `any` to maintain backwards-compatible inference
 * (TiptapContent.content stays as `any[]`). Runtime validation still
 * enforces node type allowlists and structure. Deep attribute sanitization
 * is handled by sanitizeTiptapContent() at the server function layer.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tiptapNodeSchema: z.ZodType<any> = z.lazy(() =>
  z.object({
    type: z.enum([
      'doc',
      'paragraph',
      'heading',
      'text',
      'bulletList',
      'orderedList',
      'listItem',
      'taskList',
      'taskItem',
      'blockquote',
      'codeBlock',
      'image',
      'resizableImage',
      'youtube',
      'horizontalRule',
      'hardBreak',
      'table',
      'tableRow',
      'tableHeader',
      'tableCell',
    ]),
    content: z.array(tiptapNodeSchema).optional(),
    text: z.string().optional(),
    marks: z.array(tiptapMarkSchema).optional(),
    attrs: z.record(z.string(), z.unknown()).optional(),
  })
)

/**
 * TipTap JSON content schema - validates the top-level document structure
 * and recursively validates all child nodes.
 */
export const tiptapContentSchema = z.object({
  type: z.literal('doc'),
  content: z.array(tiptapNodeSchema).optional(),
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
