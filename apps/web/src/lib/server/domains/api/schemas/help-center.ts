/**
 * Help-center schema registrations: knowledge-base categories + articles.
 *
 * Categories carry audience/visibility targeting (visibility +
 * allowedSegmentIds + allowedPrincipalIds) so REST consumers can read and
 * round-trip targeting just like the admin UI. All endpoints require the
 * `helpCenter` feature flag; reads are team-gated, category writes are
 * admin-gated and article writes are team-gated.
 */
import 'zod-openapi'
import { z } from 'zod'
import {
  registerPath,
  TypeIdSchema,
  createItemResponseSchema,
  createPaginatedResponseSchema,
  asSchema,
} from '../openapi'
import { TimestampSchema, NullableTimestampSchema, UnauthorizedErrorSchema } from './common'

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

const HelpCenterCategorySchema = z.object({
  id: TypeIdSchema.meta({ example: 'category_01h455vb4pex5vsknk084sn02q' }),
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  icon: z.string().nullable(),
  parentId: TypeIdSchema.nullable(),
  isPublic: z.boolean(),
  visibility: z.enum(['public', 'targeted']),
  allowedSegmentIds: z.array(TypeIdSchema),
  allowedPrincipalIds: z.array(TypeIdSchema),
  position: z.number(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})

registerPath('/help-center/categories', {
  get: {
    tags: ['Help Center'],
    summary: 'List knowledge-base categories',
    description: 'Each category includes its `articleCount`.',
    responses: {
      200: {
        description: 'Categories',
        content: {
          'application/json': {
            schema: createPaginatedResponseSchema(
              HelpCenterCategorySchema.extend({ articleCount: z.number() }),
              'Categories'
            ),
          },
        },
      },
      401: {
        description: 'Unauthorized',
        content: { 'application/json': { schema: UnauthorizedErrorSchema } },
      },
    },
  },
  post: {
    tags: ['Help Center'],
    summary: 'Create a category (admin)',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: asSchema(
            z.object({
              name: z.string().min(1).max(200),
              slug: z.string().max(200).optional(),
              description: z.string().max(2000).optional(),
              isPublic: z.boolean().optional(),
              visibility: z.enum(['public', 'targeted']).optional(),
              allowedSegmentIds: z.array(TypeIdSchema).max(200).optional(),
              allowedPrincipalIds: z.array(TypeIdSchema).max(200).optional(),
              position: z.number().int().min(0).optional(),
              parentId: TypeIdSchema.nullable().optional(),
              icon: z.string().max(50).nullable().optional(),
            })
          ),
        },
      },
    },
    responses: {
      201: {
        description: 'Category created',
        content: {
          'application/json': {
            schema: createItemResponseSchema(HelpCenterCategorySchema, 'Category'),
          },
        },
      },
    },
  },
})

registerPath('/help-center/categories/{categoryId}', {
  get: {
    tags: ['Help Center'],
    summary: 'Get a category',
    parameters: [
      { name: 'categoryId', in: 'path', required: true, schema: asSchema(TypeIdSchema) },
    ],
    responses: {
      200: {
        description: 'Category',
        content: {
          'application/json': {
            schema: createItemResponseSchema(HelpCenterCategorySchema, 'Category'),
          },
        },
      },
    },
  },
  patch: {
    tags: ['Help Center'],
    summary: 'Update a category (admin)',
    parameters: [
      { name: 'categoryId', in: 'path', required: true, schema: asSchema(TypeIdSchema) },
    ],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: asSchema(
            z.object({
              name: z.string().min(1).max(200).optional(),
              slug: z.string().max(200).optional(),
              description: z.string().max(2000).nullable().optional(),
              isPublic: z.boolean().optional(),
              visibility: z.enum(['public', 'targeted']).optional(),
              allowedSegmentIds: z.array(TypeIdSchema).max(200).optional(),
              allowedPrincipalIds: z.array(TypeIdSchema).max(200).optional(),
              position: z.number().int().min(0).optional(),
              parentId: TypeIdSchema.nullable().optional(),
              icon: z.string().max(50).nullable().optional(),
            })
          ),
        },
      },
    },
    responses: { 200: { description: 'Updated' } },
  },
  delete: {
    tags: ['Help Center'],
    summary: 'Delete a category (admin)',
    parameters: [
      { name: 'categoryId', in: 'path', required: true, schema: asSchema(TypeIdSchema) },
    ],
    responses: { 204: { description: 'Deleted' } },
  },
})

// ---------------------------------------------------------------------------
// Articles
// ---------------------------------------------------------------------------

const HelpCenterArticleSchema = z.object({
  id: TypeIdSchema.meta({ example: 'article_01h455vb4pex5vsknk084sn02q' }),
  slug: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  content: z.string(),
  publishedAt: NullableTimestampSchema,
  viewCount: z.number(),
  helpfulCount: z.number(),
  notHelpfulCount: z.number(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  category: z.object({ id: TypeIdSchema, slug: z.string(), name: z.string() }),
  author: z
    .object({ id: TypeIdSchema, name: z.string(), avatarUrl: z.string().nullable() })
    .nullable(),
})

registerPath('/help-center/articles', {
  get: {
    tags: ['Help Center'],
    summary: 'List articles',
    parameters: [
      { name: 'categoryId', in: 'query', schema: asSchema(TypeIdSchema.optional()) },
      {
        name: 'status',
        in: 'query',
        schema: asSchema(z.enum(['draft', 'published', 'all']).optional()),
      },
      { name: 'search', in: 'query', schema: asSchema(z.string().optional()) },
      { name: 'cursor', in: 'query', schema: asSchema(z.string().optional()) },
      {
        name: 'limit',
        in: 'query',
        schema: asSchema(z.coerce.number().min(1).max(100).optional()),
      },
    ],
    responses: {
      200: {
        description: 'Articles',
        content: {
          'application/json': {
            schema: createPaginatedResponseSchema(HelpCenterArticleSchema, 'Articles'),
          },
        },
      },
    },
  },
  post: {
    tags: ['Help Center'],
    summary: 'Create an article',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: asSchema(
            z.object({
              categoryId: TypeIdSchema,
              title: z.string().min(1).max(200),
              content: z.string().min(1),
              slug: z.string().max(200).optional(),
              description: z.string().max(300).optional(),
              authorId: TypeIdSchema.optional(),
            })
          ),
        },
      },
    },
    responses: {
      201: {
        description: 'Article created',
        content: {
          'application/json': {
            schema: createItemResponseSchema(HelpCenterArticleSchema, 'Article'),
          },
        },
      },
    },
  },
})

registerPath('/help-center/articles/{articleId}', {
  get: {
    tags: ['Help Center'],
    summary: 'Get an article',
    parameters: [{ name: 'articleId', in: 'path', required: true, schema: asSchema(TypeIdSchema) }],
    responses: {
      200: {
        description: 'Article',
        content: {
          'application/json': {
            schema: createItemResponseSchema(HelpCenterArticleSchema, 'Article'),
          },
        },
      },
    },
  },
  patch: {
    tags: ['Help Center'],
    summary: 'Update an article',
    description:
      'Setting `publishedAt` to a timestamp publishes the article; setting it to null unpublishes it.',
    parameters: [{ name: 'articleId', in: 'path', required: true, schema: asSchema(TypeIdSchema) }],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: asSchema(
            z.object({
              categoryId: TypeIdSchema.optional(),
              title: z.string().min(1).max(200).optional(),
              content: z.string().min(1).optional(),
              slug: z.string().max(200).optional(),
              description: z.string().max(300).optional(),
              publishedAt: z.string().datetime().nullable().optional(),
              authorId: TypeIdSchema.optional(),
            })
          ),
        },
      },
    },
    responses: { 200: { description: 'Updated' } },
  },
  delete: {
    tags: ['Help Center'],
    summary: 'Soft-delete an article',
    parameters: [{ name: 'articleId', in: 'path', required: true, schema: asSchema(TypeIdSchema) }],
    responses: { 204: { description: 'Deleted' } },
  },
})

registerPath('/help-center/articles/{articleId}/feedback', {
  post: {
    tags: ['Help Center'],
    summary: 'Record helpful / not-helpful feedback on an article',
    parameters: [{ name: 'articleId', in: 'path', required: true, schema: asSchema(TypeIdSchema) }],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: asSchema(z.object({ helpful: z.boolean() })),
        },
      },
    },
    responses: {
      200: {
        description: 'Recorded',
        content: {
          'application/json': {
            schema: createItemResponseSchema(z.object({ success: z.boolean() }), 'Result'),
          },
        },
      },
    },
  },
})
