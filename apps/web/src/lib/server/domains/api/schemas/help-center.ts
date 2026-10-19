/**
 * Help Center API Schema Registrations
 *
 * All help-center routes return 404 when the help center feature is disabled.
 */
import 'zod-openapi'
import { z } from 'zod'
import {
  registerPath,
  TypeIdSchema,
  createItemResponseSchema,
  createPaginatedResponseSchema,
  createRequestBodySchema,
  asSchema,
} from '../openapi'
import { TimestampSchema, NullableTimestampSchema } from './common'
import { errorResponses } from './errors'

const CategorySchema = z.object({
  id: TypeIdSchema.meta({ example: 'category_01h455vb4pex5vsknk084sn02q' }),
  slug: z.string().meta({ example: 'getting-started' }),
  name: z.string().meta({ example: 'Getting started' }),
  description: z.string().nullable(),
  icon: z.string().nullable().meta({ description: 'Icon name' }),
  parentId: TypeIdSchema.nullable().meta({ description: 'Parent category, null at the top level' }),
  isPublic: z.boolean(),
  position: z.number().int(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})

const CategoryWithCountSchema = CategorySchema.extend({
  articleCount: z.number().int(),
})

const ArticleSchema = z.object({
  id: TypeIdSchema.meta({ example: 'article_01h455vb4pex5vsknk084sn02q' }),
  slug: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  content: z.string().meta({ description: 'Article body as markdown' }),
  publishedAt: NullableTimestampSchema.meta({ description: 'Null while the article is a draft' }),
  viewCount: z.number().int(),
  helpfulCount: z.number().int(),
  notHelpfulCount: z.number().int(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  category: z.object({ id: TypeIdSchema, slug: z.string(), name: z.string() }),
  author: z
    .object({ id: TypeIdSchema, name: z.string(), avatarUrl: z.string().nullable() })
    .nullable(),
})

const CreateCategoryBodySchema = createRequestBodySchema({
  name: z.string().min(1).max(200),
  slug: z
    .string()
    .max(200)
    .optional()
    .meta({ description: 'Generated from the name when omitted' }),
  description: z.string().max(2000).optional(),
  isPublic: z.boolean().optional(),
  position: z.number().int().min(0).optional(),
  parentId: TypeIdSchema.nullable().optional(),
  icon: z.string().max(50).nullable().optional(),
})

const UpdateCategoryBodySchema = createRequestBodySchema({
  name: z.string().min(1).max(200).optional(),
  slug: z.string().max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  isPublic: z.boolean().optional(),
  position: z.number().int().min(0).optional(),
  parentId: TypeIdSchema.nullable().optional(),
  icon: z.string().max(50).nullable().optional(),
})

const CreateArticleBodySchema = createRequestBodySchema({
  categoryId: TypeIdSchema.meta({ description: 'Category the article belongs to' }),
  title: z.string().min(1).max(200),
  content: z.string().min(1).meta({ description: 'Article body as markdown' }),
  slug: z
    .string()
    .max(200)
    .optional()
    .meta({ description: 'Generated from the title when omitted' }),
  description: z.string().max(300).optional(),
  authorId: TypeIdSchema.meta({
    description:
      'Principal ID of the team member credited as the author. Required, because API keys act as a service identity rather than a person.',
  }),
})

const UpdateArticleBodySchema = createRequestBodySchema({
  categoryId: TypeIdSchema.optional(),
  title: z.string().min(1).max(200).optional(),
  content: z.string().min(1).optional().meta({ description: 'Article body as markdown' }),
  slug: z.string().max(200).optional(),
  description: z.string().max(300).optional(),
  publishedAt: z.string().datetime().nullable().optional().meta({
    description:
      'Any timestamp publishes the article now; null unpublishes it. The timestamp value itself is not stored.',
  }),
  authorId: TypeIdSchema.optional(),
})

const FeedbackBodySchema = createRequestBodySchema({
  helpful: z.boolean().meta({ description: 'Whether the article was helpful' }),
})

const featureOff = {
  404: {
    description: 'Not found, or the help center feature is disabled',
  },
}

const categoryIdParam = {
  name: 'categoryId',
  in: 'path',
  required: true,
  schema: { type: 'string' },
  description: 'Help center category ID',
} as const

const articleIdParam = {
  name: 'articleId',
  in: 'path',
  required: true,
  schema: { type: 'string' },
  description: 'Help center article ID',
} as const

const MANAGE = 'Requires the help_center.manage permission.'

registerPath('/help-center/categories', {
  get: {
    tags: ['Help Center'],
    summary: 'List help center categories',
    description: 'Returns every category with its article count.',
    responses: {
      200: {
        description: 'List of categories',
        content: {
          'application/json': { schema: z.object({ data: z.array(CategoryWithCountSchema) }) },
        },
      },
      ...errorResponses(),
      ...featureOff,
    },
  },
  post: {
    tags: ['Help Center'],
    summary: 'Create a help center category',
    description: MANAGE,
    requestBody: {
      required: true,
      content: { 'application/json': { schema: asSchema(CreateCategoryBodySchema) } },
    },
    responses: {
      201: {
        description: 'Category created',
        content: {
          'application/json': { schema: createItemResponseSchema(CategorySchema, 'Category') },
        },
      },
      ...errorResponses(400, 403, 409),
      ...featureOff,
    },
  },
})

registerPath('/help-center/categories/{categoryId}', {
  get: {
    tags: ['Help Center'],
    summary: 'Get a help center category',
    parameters: [categoryIdParam],
    responses: {
      200: {
        description: 'Category details',
        content: {
          'application/json': { schema: createItemResponseSchema(CategorySchema, 'Category') },
        },
      },
      ...errorResponses(400),
      ...featureOff,
    },
  },
  patch: {
    tags: ['Help Center'],
    summary: 'Update a help center category',
    description: MANAGE,
    parameters: [categoryIdParam],
    requestBody: {
      required: true,
      content: { 'application/json': { schema: asSchema(UpdateCategoryBodySchema) } },
    },
    responses: {
      200: {
        description: 'Category updated',
        content: {
          'application/json': { schema: createItemResponseSchema(CategorySchema, 'Category') },
        },
      },
      ...errorResponses(400, 403, 409),
      ...featureOff,
    },
  },
  delete: {
    tags: ['Help Center'],
    summary: 'Delete a help center category',
    description: MANAGE,
    parameters: [categoryIdParam],
    responses: {
      204: { description: 'Category deleted' },
      ...errorResponses(400, 403, 409),
      ...featureOff,
    },
  },
})

registerPath('/help-center/articles', {
  get: {
    tags: ['Help Center'],
    summary: 'List help center articles',
    description: 'Returns articles newest first, with cursor pagination.',
    parameters: [
      {
        name: 'categoryId',
        in: 'query',
        required: false,
        schema: { type: 'string' },
        description: 'Only articles in this category',
      },
      {
        name: 'status',
        in: 'query',
        required: false,
        schema: { type: 'string', enum: ['draft', 'published', 'all'], default: 'all' },
        description: 'Filter by publish state',
      },
      {
        name: 'search',
        in: 'query',
        required: false,
        schema: { type: 'string' },
        description: 'Text to match against the title and body',
      },
      {
        name: 'cursor',
        in: 'query',
        required: false,
        schema: { type: 'string' },
        description: 'Cursor from meta.pagination.cursor',
      },
      {
        name: 'limit',
        in: 'query',
        required: false,
        schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
        description: 'Items per page',
      },
    ],
    responses: {
      200: {
        description: 'List of articles',
        content: {
          'application/json': {
            schema: createPaginatedResponseSchema(ArticleSchema, 'List of articles'),
          },
        },
      },
      ...errorResponses(),
      ...featureOff,
    },
  },
  post: {
    tags: ['Help Center'],
    summary: 'Create a help center article',
    description: `Creates a draft article. ${MANAGE}`,
    requestBody: {
      required: true,
      content: { 'application/json': { schema: asSchema(CreateArticleBodySchema) } },
    },
    responses: {
      201: {
        description: 'Article created',
        content: {
          'application/json': { schema: createItemResponseSchema(ArticleSchema, 'Article') },
        },
      },
      ...errorResponses(400, 403, 404),
      ...featureOff,
    },
  },
})

registerPath('/help-center/articles/{articleId}', {
  get: {
    tags: ['Help Center'],
    summary: 'Get a help center article',
    parameters: [articleIdParam],
    responses: {
      200: {
        description: 'Article details',
        content: {
          'application/json': { schema: createItemResponseSchema(ArticleSchema, 'Article') },
        },
      },
      ...errorResponses(400),
      ...featureOff,
    },
  },
  patch: {
    tags: ['Help Center'],
    summary: 'Update a help center article',
    description: `Updates fields and, through publishedAt, the publish state. ${MANAGE}`,
    parameters: [articleIdParam],
    requestBody: {
      required: true,
      content: { 'application/json': { schema: asSchema(UpdateArticleBodySchema) } },
    },
    responses: {
      200: {
        description: 'Article updated',
        content: {
          'application/json': { schema: createItemResponseSchema(ArticleSchema, 'Article') },
        },
      },
      ...errorResponses(400, 403),
      ...featureOff,
    },
  },
  delete: {
    tags: ['Help Center'],
    summary: 'Delete a help center article',
    description: `Soft deletes the article. ${MANAGE}`,
    parameters: [articleIdParam],
    responses: {
      204: { description: 'Article deleted' },
      ...errorResponses(400, 403),
      ...featureOff,
    },
  },
})

registerPath('/help-center/articles/{articleId}/feedback', {
  post: {
    tags: ['Help Center'],
    summary: 'Record article feedback',
    description: 'Records whether the article was helpful, on behalf of the API key owner.',
    parameters: [articleIdParam],
    requestBody: {
      required: true,
      content: { 'application/json': { schema: asSchema(FeedbackBodySchema) } },
    },
    responses: {
      200: {
        description: 'Feedback recorded',
        content: {
          'application/json': {
            schema: createItemResponseSchema(z.object({ success: z.boolean() }), 'Result'),
          },
        },
      },
      ...errorResponses(400),
      ...featureOff,
    },
  },
})
