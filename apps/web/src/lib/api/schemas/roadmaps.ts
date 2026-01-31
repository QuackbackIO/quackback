/**
 * Roadmaps API Schema Registrations
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
import {
  TimestampSchema,
  SlugSchema,
  UnauthorizedErrorSchema,
  NotFoundErrorSchema,
  ValidationErrorSchema,
} from './common'

// Roadmap schema
const RoadmapSchema = z.object({
  id: TypeIdSchema.meta({ example: 'roadmap_01h455vb4pex5vsknk084sn02q' }),
  name: z.string().meta({ example: 'Product Roadmap' }),
  slug: SlugSchema.meta({ example: 'product-roadmap' }),
  description: z.string().nullable().meta({ example: 'Our product development roadmap' }),
  isPublic: z.boolean().meta({ description: 'Whether the roadmap is publicly visible' }),
  position: z.number().meta({ description: 'Display order' }),
  createdAt: TimestampSchema,
})

// Roadmap post schema
const RoadmapPostSchema = z.object({
  id: TypeIdSchema,
  title: z.string(),
  voteCount: z.number(),
  statusId: TypeIdSchema.nullable(),
  board: z.object({
    id: TypeIdSchema,
    name: z.string(),
    slug: z.string(),
  }),
  position: z.number().meta({ description: 'Position within the roadmap' }),
})

// Request body schemas
const CreateRoadmapSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(100)
      .meta({ description: 'Roadmap name', example: 'Product Roadmap' }),
    slug: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[a-z0-9-]+$/)
      .meta({ description: 'URL-friendly slug', example: 'product-roadmap' }),
    description: z.string().max(500).optional().meta({ description: 'Roadmap description' }),
    isPublic: z.boolean().optional().meta({ description: 'Make roadmap public', default: true }),
  })
  .meta({ description: 'Create roadmap request body' })

const UpdateRoadmapSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    description: z.string().max(500).nullable().optional(),
    isPublic: z.boolean().optional(),
  })
  .meta({ description: 'Update roadmap request body' })

const AddPostToRoadmapSchema = z
  .object({
    postId: TypeIdSchema.meta({
      description: 'Post ID to add',
      example: 'post_01h455vb4pex5vsknk084sn02q',
    }),
  })
  .meta({ description: 'Add post to roadmap request body' })

// Response schemas
const RoadmapPostsResponseSchema = z
  .object({
    data: z.object({
      items: z.array(RoadmapPostSchema),
      total: z.number(),
      hasMore: z.boolean(),
    }),
  })
  .meta({ description: 'Paginated roadmap posts response' })

const AddPostConfirmationSchema = z
  .object({
    message: z.string(),
    roadmapId: z.string(),
    postId: z.string(),
  })
  .meta({ description: 'Post added confirmation' })

// Error response schemas
const ConflictErrorSchema = z
  .object({
    error: z.object({
      code: z.literal('CONFLICT'),
      message: z.string(),
    }),
  })
  .meta({ description: 'Conflict error' })

// Register GET /roadmaps
registerPath('/roadmaps', {
  get: {
    tags: ['Roadmaps'],
    summary: 'List roadmaps',
    description: 'Returns all roadmaps in the workspace',
    responses: {
      200: {
        description: 'List of roadmaps',
        content: {
          'application/json': {
            schema: createPaginatedResponseSchema(RoadmapSchema, 'List of roadmaps'),
          },
        },
      },
      401: {
        description: 'Unauthorized',
        content: { 'application/json': { schema: UnauthorizedErrorSchema } },
      },
    },
  },
})

// Register POST /roadmaps
registerPath('/roadmaps', {
  post: {
    tags: ['Roadmaps'],
    summary: 'Create a roadmap',
    description: 'Create a new roadmap',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: asSchema(CreateRoadmapSchema),
        },
      },
    },
    responses: {
      201: {
        description: 'Roadmap created',
        content: {
          'application/json': {
            schema: createItemResponseSchema(RoadmapSchema, 'Created roadmap'),
          },
        },
      },
      400: {
        description: 'Validation error',
        content: { 'application/json': { schema: ValidationErrorSchema } },
      },
      401: {
        description: 'Unauthorized',
        content: { 'application/json': { schema: UnauthorizedErrorSchema } },
      },
    },
  },
})

// Register GET /roadmaps/{roadmapId}
registerPath('/roadmaps/{roadmapId}', {
  get: {
    tags: ['Roadmaps'],
    summary: 'Get a roadmap',
    description: 'Get a single roadmap by ID',
    parameters: [
      {
        name: 'roadmapId',
        in: 'path',
        required: true,
        schema: { type: 'string' },
        description: 'Roadmap ID',
      },
    ],
    responses: {
      200: {
        description: 'Roadmap details',
        content: {
          'application/json': {
            schema: createItemResponseSchema(RoadmapSchema, 'Roadmap details'),
          },
        },
      },
      401: {
        description: 'Unauthorized',
        content: { 'application/json': { schema: UnauthorizedErrorSchema } },
      },
      404: {
        description: 'Roadmap not found',
        content: { 'application/json': { schema: NotFoundErrorSchema } },
      },
    },
  },
})

// Register PATCH /roadmaps/{roadmapId}
registerPath('/roadmaps/{roadmapId}', {
  patch: {
    tags: ['Roadmaps'],
    summary: 'Update a roadmap',
    description: 'Update an existing roadmap',
    parameters: [
      {
        name: 'roadmapId',
        in: 'path',
        required: true,
        schema: { type: 'string' },
        description: 'Roadmap ID',
      },
    ],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: asSchema(UpdateRoadmapSchema),
        },
      },
    },
    responses: {
      200: {
        description: 'Roadmap updated',
        content: {
          'application/json': {
            schema: createItemResponseSchema(RoadmapSchema, 'Updated roadmap'),
          },
        },
      },
      400: {
        description: 'Validation error',
        content: { 'application/json': { schema: ValidationErrorSchema } },
      },
      401: {
        description: 'Unauthorized',
        content: { 'application/json': { schema: UnauthorizedErrorSchema } },
      },
      404: {
        description: 'Roadmap not found',
        content: { 'application/json': { schema: NotFoundErrorSchema } },
      },
    },
  },
})

// Register DELETE /roadmaps/{roadmapId}
registerPath('/roadmaps/{roadmapId}', {
  delete: {
    tags: ['Roadmaps'],
    summary: 'Delete a roadmap',
    description: 'Delete a roadmap by ID',
    parameters: [
      {
        name: 'roadmapId',
        in: 'path',
        required: true,
        schema: { type: 'string' },
        description: 'Roadmap ID',
      },
    ],
    responses: {
      204: { description: 'Roadmap deleted' },
      401: {
        description: 'Unauthorized',
        content: { 'application/json': { schema: UnauthorizedErrorSchema } },
      },
      404: {
        description: 'Roadmap not found',
        content: { 'application/json': { schema: NotFoundErrorSchema } },
      },
    },
  },
})

// Register GET /roadmaps/{roadmapId}/posts
registerPath('/roadmaps/{roadmapId}/posts', {
  get: {
    tags: ['Roadmaps'],
    summary: 'List posts in a roadmap',
    description: 'Returns posts assigned to a roadmap',
    parameters: [
      {
        name: 'roadmapId',
        in: 'path',
        required: true,
        schema: { type: 'string' },
        description: 'Roadmap ID',
      },
      {
        name: 'statusId',
        in: 'query',
        schema: { type: 'string' },
        description: 'Filter by status ID',
      },
      {
        name: 'limit',
        in: 'query',
        schema: { type: 'integer', default: 20, maximum: 100 },
        description: 'Items per page',
      },
      {
        name: 'offset',
        in: 'query',
        schema: { type: 'integer', default: 0 },
        description: 'Offset for pagination',
      },
    ],
    responses: {
      200: {
        description: 'List of roadmap posts',
        content: {
          'application/json': {
            schema: asSchema(RoadmapPostsResponseSchema),
          },
        },
      },
      401: {
        description: 'Unauthorized',
        content: { 'application/json': { schema: UnauthorizedErrorSchema } },
      },
      404: {
        description: 'Roadmap not found',
        content: { 'application/json': { schema: NotFoundErrorSchema } },
      },
    },
  },
})

// Register POST /roadmaps/{roadmapId}/posts
registerPath('/roadmaps/{roadmapId}/posts', {
  post: {
    tags: ['Roadmaps'],
    summary: 'Add a post to a roadmap',
    description: 'Add an existing post to a roadmap',
    parameters: [
      {
        name: 'roadmapId',
        in: 'path',
        required: true,
        schema: { type: 'string' },
        description: 'Roadmap ID',
      },
    ],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: asSchema(AddPostToRoadmapSchema),
        },
      },
    },
    responses: {
      201: {
        description: 'Post added to roadmap',
        content: {
          'application/json': {
            schema: createItemResponseSchema(AddPostConfirmationSchema, 'Post added confirmation'),
          },
        },
      },
      400: {
        description: 'Validation error',
        content: { 'application/json': { schema: ValidationErrorSchema } },
      },
      401: {
        description: 'Unauthorized',
        content: { 'application/json': { schema: UnauthorizedErrorSchema } },
      },
      404: {
        description: 'Roadmap or post not found',
        content: { 'application/json': { schema: NotFoundErrorSchema } },
      },
      409: {
        description: 'Post already in roadmap',
        content: { 'application/json': { schema: ConflictErrorSchema } },
      },
    },
  },
})

// Register DELETE /roadmaps/{roadmapId}/posts/{postId}
registerPath('/roadmaps/{roadmapId}/posts/{postId}', {
  delete: {
    tags: ['Roadmaps'],
    summary: 'Remove a post from a roadmap',
    description: 'Remove a post from a roadmap',
    parameters: [
      {
        name: 'roadmapId',
        in: 'path',
        required: true,
        schema: { type: 'string' },
        description: 'Roadmap ID',
      },
      {
        name: 'postId',
        in: 'path',
        required: true,
        schema: { type: 'string' },
        description: 'Post ID',
      },
    ],
    responses: {
      204: { description: 'Post removed from roadmap' },
      401: {
        description: 'Unauthorized',
        content: { 'application/json': { schema: UnauthorizedErrorSchema } },
      },
      404: {
        description: 'Roadmap or post not found in roadmap',
        content: { 'application/json': { schema: NotFoundErrorSchema } },
      },
    },
  },
})
