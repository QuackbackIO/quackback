/**
 * Statuses API Schema Registrations
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
  HexColorSchema,
  SlugSchema,
  UnauthorizedErrorSchema,
  NotFoundErrorSchema,
  ValidationErrorSchema,
} from './common'

// Status schema
const StatusSchema = z.object({
  id: TypeIdSchema.meta({ example: 'status_01h455vb4pex5vsknk084sn02q' }),
  name: z.string().meta({ example: 'In Progress' }),
  slug: SlugSchema.meta({ example: 'in_progress' }),
  color: HexColorSchema.meta({ example: '#f97316' }),
  category: z.enum(['active', 'complete', 'closed']).meta({ description: 'Status category' }),
  position: z.number().meta({ description: 'Display order within category' }),
  showOnRoadmap: z.boolean().meta({ description: 'Whether to show on public roadmap' }),
  isDefault: z.boolean().meta({ description: 'Whether this is the default status for new posts' }),
  createdAt: TimestampSchema,
})

// Request body schemas
const CreateStatusSchema = z
  .object({
    name: z.string().min(1).max(50).meta({ description: 'Status name', example: 'In Progress' }),
    slug: z
      .string()
      .min(1)
      .max(50)
      .regex(/^[a-z0-9_]+$/)
      .meta({ description: 'URL-friendly slug', example: 'in_progress' }),
    color: HexColorSchema.meta({ description: 'Status color', example: '#f97316' }),
    category: z.enum(['active', 'complete', 'closed']).meta({ description: 'Status category' }),
    position: z
      .number()
      .int()
      .min(0)
      .optional()
      .meta({ description: 'Display order within category' }),
    showOnRoadmap: z
      .boolean()
      .optional()
      .meta({ description: 'Show on public roadmap', default: false }),
    isDefault: z
      .boolean()
      .optional()
      .meta({ description: 'Set as default for new posts', default: false }),
  })
  .meta({ description: 'Create status request body' })

const UpdateStatusSchema = z
  .object({
    name: z.string().min(1).max(50).optional(),
    color: HexColorSchema.optional(),
    showOnRoadmap: z.boolean().optional(),
    isDefault: z.boolean().optional(),
  })
  .meta({ description: 'Update status request body' })

// Error response schemas
const ForbiddenStatusErrorSchema = z
  .object({
    error: z.object({
      code: z.string(),
      message: z.string(),
    }),
  })
  .meta({ description: 'Forbidden error' })

// Register GET /statuses
registerPath('/statuses', {
  get: {
    tags: ['Statuses'],
    summary: 'List statuses',
    description: 'Returns all statuses in the workspace, ordered by category and position',
    responses: {
      200: {
        description: 'List of statuses',
        content: {
          'application/json': {
            schema: createPaginatedResponseSchema(StatusSchema, 'List of statuses'),
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

// Register POST /statuses
registerPath('/statuses', {
  post: {
    tags: ['Statuses'],
    summary: 'Create a status',
    description: 'Create a new post status',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: asSchema(CreateStatusSchema),
        },
      },
    },
    responses: {
      201: {
        description: 'Status created',
        content: {
          'application/json': { schema: createItemResponseSchema(StatusSchema, 'Created status') },
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

// Register GET /statuses/{statusId}
registerPath('/statuses/{statusId}', {
  get: {
    tags: ['Statuses'],
    summary: 'Get a status',
    description: 'Get a single status by ID',
    parameters: [
      {
        name: 'statusId',
        in: 'path',
        required: true,
        schema: { type: 'string' },
        description: 'Status ID',
      },
    ],
    responses: {
      200: {
        description: 'Status details',
        content: {
          'application/json': { schema: createItemResponseSchema(StatusSchema, 'Status details') },
        },
      },
      401: {
        description: 'Unauthorized',
        content: { 'application/json': { schema: UnauthorizedErrorSchema } },
      },
      404: {
        description: 'Status not found',
        content: { 'application/json': { schema: NotFoundErrorSchema } },
      },
    },
  },
})

// Register PATCH /statuses/{statusId}
registerPath('/statuses/{statusId}', {
  patch: {
    tags: ['Statuses'],
    summary: 'Update a status',
    description:
      'Update an existing status. Note: slug, category, and position cannot be changed via this endpoint.',
    parameters: [
      {
        name: 'statusId',
        in: 'path',
        required: true,
        schema: { type: 'string' },
        description: 'Status ID',
      },
    ],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: asSchema(UpdateStatusSchema),
        },
      },
    },
    responses: {
      200: {
        description: 'Status updated',
        content: {
          'application/json': { schema: createItemResponseSchema(StatusSchema, 'Updated status') },
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
        description: 'Status not found',
        content: { 'application/json': { schema: NotFoundErrorSchema } },
      },
    },
  },
})

// Register DELETE /statuses/{statusId}
registerPath('/statuses/{statusId}', {
  delete: {
    tags: ['Statuses'],
    summary: 'Delete a status',
    description:
      'Delete a status by ID. Cannot delete the default status or a status with assigned posts.',
    parameters: [
      {
        name: 'statusId',
        in: 'path',
        required: true,
        schema: { type: 'string' },
        description: 'Status ID',
      },
    ],
    responses: {
      204: { description: 'Status deleted' },
      401: {
        description: 'Unauthorized',
        content: { 'application/json': { schema: UnauthorizedErrorSchema } },
      },
      403: {
        description: 'Cannot delete (default status or has posts)',
        content: { 'application/json': { schema: ForbiddenStatusErrorSchema } },
      },
      404: {
        description: 'Status not found',
        content: { 'application/json': { schema: NotFoundErrorSchema } },
      },
    },
  },
})
