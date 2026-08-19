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

const RoadmapBaseFilterSchema = z.object({
  statusIds: z.array(TypeIdSchema).optional(),
  boardIds: z.array(TypeIdSchema).optional(),
  tagIds: z.array(TypeIdSchema).optional(),
  segmentIds: z.array(TypeIdSchema).optional(),
})

const RoadmapColumnSchema = z.object({
  id: TypeIdSchema,
  roadmapId: TypeIdSchema,
  statusId: TypeIdSchema,
  name: z.string(),
  icon: z.string().nullable(),
  color: z.string(),
  position: z.number(),
})

// Roadmap schema
const RoadmapSchema = z.object({
  id: TypeIdSchema.meta({ example: 'roadmap_01h455vb4pex5vsknk084sn02q' }),
  name: z.string().meta({ example: 'Product Roadmap' }),
  slug: SlugSchema.meta({ example: 'product-roadmap' }),
  description: z.string().nullable().meta({ example: 'Our product development roadmap' }),
  type: z.enum(['column', 'date']),
  baseFilter: RoadmapBaseFilterSchema,
  dateSource: z.literal('eta').nullable(),
  frequency: z.enum(['monthly', 'quarterly', 'semiannual']).nullable(),
  visibility: z.enum(['public', 'team', 'segment']),
  visibleSegmentIds: z.array(TypeIdSchema).nullable(),
  position: z.number().meta({ description: 'Display order' }),
  columns: z.array(RoadmapColumnSchema),
  createdAt: TimestampSchema,
})

// Roadmap post schema
const RoadmapPostSchema = z.object({
  id: TypeIdSchema,
  title: z.string(),
  voteCount: z.number(),
  statusId: TypeIdSchema.nullable(),
  eta: TimestampSchema.nullable(),
  board: z.object({
    id: TypeIdSchema,
    name: z.string(),
    slug: z.string(),
  }),
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
    type: z.enum(['column', 'date']).optional(),
    baseFilter: RoadmapBaseFilterSchema.optional(),
    dateSource: z.literal('eta').nullable().optional(),
    frequency: z.enum(['monthly', 'quarterly', 'semiannual']).nullable().optional(),
    visibility: z.enum(['public', 'team', 'segment']).optional(),
    visibleSegmentIds: z.array(TypeIdSchema).nullable().optional(),
    columns: z.array(RoadmapColumnSchema.omit({ id: true, roadmapId: true })).optional(),
  })
  .meta({ description: 'Create roadmap request body' })

const UpdateRoadmapSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    description: z.string().max(500).nullable().optional(),
    type: z.enum(['column', 'date']).optional(),
    baseFilter: RoadmapBaseFilterSchema.optional(),
    dateSource: z.literal('eta').nullable().optional(),
    frequency: z.enum(['monthly', 'quarterly', 'semiannual']).nullable().optional(),
    visibility: z.enum(['public', 'team', 'segment']).optional(),
    visibleSegmentIds: z.array(TypeIdSchema).nullable().optional(),
    columns: z.array(RoadmapColumnSchema).optional(),
  })
  .meta({ description: 'Update roadmap request body' })

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
    description: 'Returns posts matching the roadmap view configuration',
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
        name: 'bucketId',
        in: 'query',
        schema: { type: 'string' },
        description: 'Filter a date roadmap by UTC date bucket',
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

registerPath('/roadmaps/{roadmapId}/columns', {
  get: {
    tags: ['Roadmaps'],
    summary: 'List roadmap columns',
    parameters: [{ name: 'roadmapId', in: 'path', required: true, schema: { type: 'string' } }],
    responses: {
      200: {
        description: 'Roadmap columns',
        content: {
          'application/json': {
            schema: createPaginatedResponseSchema(RoadmapColumnSchema, 'Roadmap columns'),
          },
        },
      },
      401: { description: 'Unauthorized' },
      404: { description: 'Roadmap not found' },
    },
  },
  post: {
    tags: ['Roadmaps'],
    summary: 'Create a roadmap column',
    parameters: [{ name: 'roadmapId', in: 'path', required: true, schema: { type: 'string' } }],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: asSchema(RoadmapColumnSchema.omit({ id: true, roadmapId: true })),
        },
      },
    },
    responses: {
      201: {
        description: 'Roadmap column created',
        content: {
          'application/json': {
            schema: createItemResponseSchema(RoadmapColumnSchema, 'Created roadmap column'),
          },
        },
      },
      400: { description: 'Validation error' },
      401: { description: 'Unauthorized' },
      404: { description: 'Roadmap not found' },
    },
  },
})

registerPath('/roadmaps/{roadmapId}/columns/{columnId}', {
  patch: {
    tags: ['Roadmaps'],
    summary: 'Update a roadmap column',
    parameters: [
      { name: 'roadmapId', in: 'path', required: true, schema: { type: 'string' } },
      { name: 'columnId', in: 'path', required: true, schema: { type: 'string' } },
    ],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: asSchema(
            RoadmapColumnSchema.pick({
              name: true,
              icon: true,
              color: true,
              position: true,
            }).partial()
          ),
        },
      },
    },
    responses: {
      200: {
        description: 'Roadmap column updated',
        content: {
          'application/json': {
            schema: createItemResponseSchema(RoadmapColumnSchema, 'Updated roadmap column'),
          },
        },
      },
      400: { description: 'Validation error' },
      401: { description: 'Unauthorized' },
      404: { description: 'Roadmap column not found' },
    },
  },
  delete: {
    tags: ['Roadmaps'],
    summary: 'Delete a roadmap column',
    parameters: [
      { name: 'roadmapId', in: 'path', required: true, schema: { type: 'string' } },
      { name: 'columnId', in: 'path', required: true, schema: { type: 'string' } },
    ],
    responses: {
      204: { description: 'Roadmap column deleted' },
      401: { description: 'Unauthorized' },
      404: { description: 'Roadmap column not found' },
    },
  },
})
