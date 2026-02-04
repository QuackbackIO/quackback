/**
 * Boards API Schema Registrations
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

// Board list item schema (GET /boards)
const BoardListItemSchema = z.object({
  id: TypeIdSchema.meta({ example: 'board_01h455vb4pex5vsknk084sn02q' }),
  name: z.string().meta({ example: 'Feature Requests' }),
  slug: SlugSchema.meta({ example: 'feature-requests' }),
  description: z.string().nullable().meta({ example: 'Submit and vote on feature ideas' }),
  isPublic: z.boolean().meta({ example: true }),
  postCount: z.number().meta({ description: 'Number of posts in this board', example: 42 }),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})

// Board detail schema (GET /boards/:id, PATCH /boards/:id)
const BoardDetailSchema = z.object({
  id: TypeIdSchema.meta({ example: 'board_01h455vb4pex5vsknk084sn02q' }),
  name: z.string().meta({ example: 'Feature Requests' }),
  slug: SlugSchema.meta({ example: 'feature-requests' }),
  description: z.string().nullable().meta({ example: 'Submit and vote on feature ideas' }),
  isPublic: z.boolean().meta({ example: true }),
  settings: z.record(z.string(), z.unknown()).meta({ description: 'Board-specific settings' }),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})

// Board create response schema (POST /boards)
const BoardCreateResponseSchema = z.object({
  id: TypeIdSchema.meta({ example: 'board_01h455vb4pex5vsknk084sn02q' }),
  name: z.string().meta({ example: 'Feature Requests' }),
  slug: SlugSchema.meta({ example: 'feature-requests' }),
  description: z.string().nullable().meta({ example: 'Submit and vote on feature ideas' }),
  isPublic: z.boolean().meta({ example: true }),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})

// Request body schemas
const CreateBoardSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(100)
      .meta({ description: 'Board name', example: 'Feature Requests' }),
    slug: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[a-z0-9-]+$/)
      .optional()
      .meta({
        description: 'URL-friendly slug (auto-generated from name if omitted)',
        example: 'feature-requests',
      }),
    description: z.string().max(500).optional().meta({ description: 'Board description' }),
    isPublic: z
      .boolean()
      .optional()
      .meta({ description: 'Whether board is public', default: true }),
  })
  .meta({ description: 'Create board request body' })

const UpdateBoardSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    slug: z.string().min(1).max(100).optional(),
    description: z.string().max(500).nullable().optional(),
    isPublic: z.boolean().optional(),
  })
  .meta({ description: 'Update board request body' })

// Register GET /boards
registerPath('/boards', {
  get: {
    tags: ['Boards'],
    summary: 'List boards',
    description: 'Returns all boards in the workspace',
    responses: {
      200: {
        description: 'List of boards',
        content: {
          'application/json': {
            schema: createPaginatedResponseSchema(BoardListItemSchema, 'List of boards'),
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

// Register POST /boards
registerPath('/boards', {
  post: {
    tags: ['Boards'],
    summary: 'Create a board',
    description: 'Create a new feedback board',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: asSchema(CreateBoardSchema),
        },
      },
    },
    responses: {
      201: {
        description: 'Board created',
        content: {
          'application/json': {
            schema: createItemResponseSchema(BoardCreateResponseSchema, 'Created board'),
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

// Register GET /boards/{boardId}
registerPath('/boards/{boardId}', {
  get: {
    tags: ['Boards'],
    summary: 'Get a board',
    description: 'Get a single board by ID',
    parameters: [
      {
        name: 'boardId',
        in: 'path',
        required: true,
        schema: { type: 'string' },
        description: 'Board ID',
      },
    ],
    responses: {
      200: {
        description: 'Board details',
        content: {
          'application/json': {
            schema: createItemResponseSchema(BoardDetailSchema, 'Board details'),
          },
        },
      },
      401: {
        description: 'Unauthorized',
        content: { 'application/json': { schema: UnauthorizedErrorSchema } },
      },
      404: {
        description: 'Board not found',
        content: { 'application/json': { schema: NotFoundErrorSchema } },
      },
    },
  },
})

// Register PATCH /boards/{boardId}
registerPath('/boards/{boardId}', {
  patch: {
    tags: ['Boards'],
    summary: 'Update a board',
    description: 'Update an existing board',
    parameters: [
      {
        name: 'boardId',
        in: 'path',
        required: true,
        schema: { type: 'string' },
        description: 'Board ID',
      },
    ],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: asSchema(UpdateBoardSchema),
        },
      },
    },
    responses: {
      200: {
        description: 'Board updated',
        content: {
          'application/json': {
            schema: createItemResponseSchema(BoardDetailSchema, 'Updated board'),
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
        description: 'Board not found',
        content: { 'application/json': { schema: NotFoundErrorSchema } },
      },
    },
  },
})

// Register DELETE /boards/{boardId}
registerPath('/boards/{boardId}', {
  delete: {
    tags: ['Boards'],
    summary: 'Delete a board',
    description: 'Delete a board by ID',
    parameters: [
      {
        name: 'boardId',
        in: 'path',
        required: true,
        schema: { type: 'string' },
        description: 'Board ID',
      },
    ],
    responses: {
      204: { description: 'Board deleted' },
      401: {
        description: 'Unauthorized',
        content: { 'application/json': { schema: UnauthorizedErrorSchema } },
      },
      404: {
        description: 'Board not found',
        content: { 'application/json': { schema: NotFoundErrorSchema } },
      },
    },
  },
})
