import { z } from 'zod'
import { boardIdSchema, statusIdSchema, tagIdsSchema } from '@quackback/ids/zod'
import type { TiptapContent as DbTiptapContent } from '@/lib/shared/db-types'

/**
 * TipTap mark schema - validates mark types and their attributes
 */
const tiptapAttrValue = z.union([z.string(), z.number(), z.boolean()])

const tiptapMarkSchema = z.object({
  type: z.enum(['bold', 'italic', 'underline', 'strike', 'code', 'link']),
  attrs: z.record(z.string(), tiptapAttrValue).optional(),
})

/**
 * TipTap node schema - validates node types and basic structure.
 * Uses z.lazy for recursive content validation.
 *
 * Uses z.ZodType<TiptapContent> (from DB types) so the inferred schema types
 * are compatible with DB column types. Runtime validation still enforces node
 * type allowlists and structure. Deep attribute sanitization is handled by
 * sanitizeTiptapContent() at the server function layer.
 */
const tiptapNodeSchema: z.ZodType<DbTiptapContent> = z.lazy(() =>
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
    attrs: z
      .preprocess(
        (val) => {
          // TipTap extensions (e.g. resizableImage) may include undefined attr values
          // like caption: undefined. Strip them before validation.
          if (val && typeof val === 'object' && !Array.isArray(val)) {
            return Object.fromEntries(
              Object.entries(val as Record<string, unknown>).filter(([, v]) => v !== undefined)
            )
          }
          return val
        },
        z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
      )
      .optional(),
  })
)

/**
 * TipTap JSON content schema - validates the top-level document structure
 * and recursively validates all child nodes.
 */
export const tiptapContentSchema: z.ZodType<DbTiptapContent> = z.object({
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

// Inferred types from schemas (for form values - uses plain strings due to resolver inference)
export type CreatePostFormData = z.infer<typeof createPostSchema>
export type EditPostFormData = z.infer<typeof editPostSchema>
export type { DbTiptapContent as TiptapContent }
