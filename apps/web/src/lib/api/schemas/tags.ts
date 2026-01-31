/**
 * Tags API Schema Registrations
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
  UnauthorizedErrorSchema,
  NotFoundErrorSchema,
  ValidationErrorSchema,
} from './common'

// Tag schema
const TagSchema = z.object({
  id: TypeIdSchema.meta({ example: 'tag_01h455vb4pex5vsknk084sn02q' }),
  name: z.string().meta({ example: 'Bug' }),
  color: HexColorSchema.meta({ example: '#ef4444' }),
  createdAt: TimestampSchema,
})

// Request body schemas
const CreateTagSchema = z
  .object({
    name: z.string().min(1).max(50).meta({ description: 'Tag name', example: 'Bug' }),
    color: HexColorSchema.optional().meta({ description: 'Tag color', default: '#6b7280' }),
  })
  .meta({ description: 'Create tag request body' })

const UpdateTagSchema = z
  .object({
    name: z.string().min(1).max(50).optional(),
    color: HexColorSchema.optional(),
  })
  .meta({ description: 'Update tag request body' })

// Register GET /tags
registerPath('/tags', {
  get: {
    tags: ['Tags'],
    summary: 'List tags',
    description: 'Returns all tags in the workspace',
    responses: {
      200: {
        description: 'List of tags',
        content: {
          'application/json': {
            schema: createPaginatedResponseSchema(TagSchema, 'List of tags'),
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

// Register POST /tags
registerPath('/tags', {
  post: {
    tags: ['Tags'],
    summary: 'Create a tag',
    description: 'Create a new tag',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: asSchema(CreateTagSchema),
        },
      },
    },
    responses: {
      201: {
        description: 'Tag created',
        content: {
          'application/json': { schema: createItemResponseSchema(TagSchema, 'Created tag') },
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

// Register GET /tags/{tagId}
registerPath('/tags/{tagId}', {
  get: {
    tags: ['Tags'],
    summary: 'Get a tag',
    description: 'Get a single tag by ID',
    parameters: [
      {
        name: 'tagId',
        in: 'path',
        required: true,
        schema: { type: 'string' },
        description: 'Tag ID',
      },
    ],
    responses: {
      200: {
        description: 'Tag details',
        content: {
          'application/json': { schema: createItemResponseSchema(TagSchema, 'Tag details') },
        },
      },
      401: {
        description: 'Unauthorized',
        content: { 'application/json': { schema: UnauthorizedErrorSchema } },
      },
      404: {
        description: 'Tag not found',
        content: { 'application/json': { schema: NotFoundErrorSchema } },
      },
    },
  },
})

// Register PATCH /tags/{tagId}
registerPath('/tags/{tagId}', {
  patch: {
    tags: ['Tags'],
    summary: 'Update a tag',
    description: 'Update an existing tag',
    parameters: [
      {
        name: 'tagId',
        in: 'path',
        required: true,
        schema: { type: 'string' },
        description: 'Tag ID',
      },
    ],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: asSchema(UpdateTagSchema),
        },
      },
    },
    responses: {
      200: {
        description: 'Tag updated',
        content: {
          'application/json': { schema: createItemResponseSchema(TagSchema, 'Updated tag') },
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
        description: 'Tag not found',
        content: { 'application/json': { schema: NotFoundErrorSchema } },
      },
    },
  },
})

// Register DELETE /tags/{tagId}
registerPath('/tags/{tagId}', {
  delete: {
    tags: ['Tags'],
    summary: 'Delete a tag',
    description: 'Delete a tag by ID',
    parameters: [
      {
        name: 'tagId',
        in: 'path',
        required: true,
        schema: { type: 'string' },
        description: 'Tag ID',
      },
    ],
    responses: {
      204: { description: 'Tag deleted' },
      401: {
        description: 'Unauthorized',
        content: { 'application/json': { schema: UnauthorizedErrorSchema } },
      },
      404: {
        description: 'Tag not found',
        content: { 'application/json': { schema: NotFoundErrorSchema } },
      },
    },
  },
})
