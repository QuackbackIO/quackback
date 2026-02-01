/**
 * Changelog API Schema Registrations
 */
import 'zod-openapi'
import { z } from 'zod'
import { registerPath, TypeIdSchema, createItemResponseSchema, asSchema } from '../openapi'
import {
  TimestampSchema,
  NullableTimestampSchema,
  UnauthorizedErrorSchema,
  NotFoundErrorSchema,
  ValidationErrorSchema,
} from './common'

// Changelog entry schema
const ChangelogEntrySchema = z.object({
  id: TypeIdSchema.meta({ example: 'changelog_01h455vb4pex5vsknk084sn02q' }),
  boardId: TypeIdSchema,
  boardName: z.string().optional().meta({ description: 'Associated board name' }),
  title: z.string().meta({ example: 'New Dark Mode Feature' }),
  content: z.string().meta({ example: "We've added a dark mode option..." }),
  publishedAt: NullableTimestampSchema.meta({
    description: 'When the entry was published (null if draft)',
  }),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})

// Request body schemas
const CreateChangelogEntrySchema = z
  .object({
    boardId: TypeIdSchema.meta({
      description: 'Associated board ID',
      example: 'board_01h455vb4pex5vsknk084sn02q',
    }),
    title: z
      .string()
      .min(1)
      .max(200)
      .meta({ description: 'Entry title', example: 'New Dark Mode Feature' }),
    content: z.string().min(1).meta({ description: 'Entry content (supports markdown)' }),
    publishedAt: z
      .string()
      .datetime()
      .optional()
      .meta({ description: 'Publish date (omit to save as draft)' }),
  })
  .meta({ description: 'Create changelog entry request body' })

const UpdateChangelogEntrySchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    content: z.string().min(1).optional(),
    publishedAt: z
      .string()
      .datetime()
      .nullable()
      .optional()
      .meta({ description: 'Set to null to unpublish' }),
  })
  .meta({ description: 'Update changelog entry request body' })

// Response schemas
const ChangelogListResponseSchema = z
  .object({
    data: z.object({
      items: z.array(ChangelogEntrySchema),
      page: z.number(),
      limit: z.number(),
    }),
  })
  .meta({ description: 'Paginated changelog entries' })

// Register GET /changelog
registerPath('/changelog', {
  get: {
    tags: ['Changelog'],
    summary: 'List changelog entries',
    description: 'Returns changelog entries with optional filtering',
    parameters: [
      {
        name: 'boardId',
        in: 'query',
        schema: { type: 'string' },
        description: 'Filter by board ID',
      },
      {
        name: 'published',
        in: 'query',
        schema: { type: 'string', enum: ['true', 'false'] },
        description: 'Filter by published status',
      },
      {
        name: 'page',
        in: 'query',
        schema: { type: 'integer', default: 1 },
        description: 'Page number',
      },
      {
        name: 'limit',
        in: 'query',
        schema: { type: 'integer', default: 20, maximum: 100 },
        description: 'Items per page',
      },
    ],
    responses: {
      200: {
        description: 'List of changelog entries',
        content: {
          'application/json': {
            schema: asSchema(ChangelogListResponseSchema),
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

// Register POST /changelog
registerPath('/changelog', {
  post: {
    tags: ['Changelog'],
    summary: 'Create a changelog entry',
    description: 'Create a new changelog entry',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: asSchema(CreateChangelogEntrySchema),
        },
      },
    },
    responses: {
      201: {
        description: 'Changelog entry created',
        content: {
          'application/json': {
            schema: createItemResponseSchema(ChangelogEntrySchema, 'Created changelog entry'),
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

// Register GET /changelog/{entryId}
registerPath('/changelog/{entryId}', {
  get: {
    tags: ['Changelog'],
    summary: 'Get a changelog entry',
    description: 'Get a single changelog entry by ID',
    parameters: [
      {
        name: 'entryId',
        in: 'path',
        required: true,
        schema: { type: 'string' },
        description: 'Changelog entry ID',
      },
    ],
    responses: {
      200: {
        description: 'Changelog entry details',
        content: {
          'application/json': {
            schema: createItemResponseSchema(ChangelogEntrySchema, 'Changelog entry details'),
          },
        },
      },
      401: {
        description: 'Unauthorized',
        content: { 'application/json': { schema: UnauthorizedErrorSchema } },
      },
      404: {
        description: 'Changelog entry not found',
        content: { 'application/json': { schema: NotFoundErrorSchema } },
      },
    },
  },
})

// Register PATCH /changelog/{entryId}
registerPath('/changelog/{entryId}', {
  patch: {
    tags: ['Changelog'],
    summary: 'Update a changelog entry',
    description: 'Update an existing changelog entry',
    parameters: [
      {
        name: 'entryId',
        in: 'path',
        required: true,
        schema: { type: 'string' },
        description: 'Changelog entry ID',
      },
    ],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: asSchema(UpdateChangelogEntrySchema),
        },
      },
    },
    responses: {
      200: {
        description: 'Changelog entry updated',
        content: {
          'application/json': {
            schema: createItemResponseSchema(ChangelogEntrySchema, 'Updated changelog entry'),
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
        description: 'Changelog entry not found',
        content: { 'application/json': { schema: NotFoundErrorSchema } },
      },
    },
  },
})

// Register DELETE /changelog/{entryId}
registerPath('/changelog/{entryId}', {
  delete: {
    tags: ['Changelog'],
    summary: 'Delete a changelog entry',
    description: 'Delete a changelog entry by ID',
    parameters: [
      {
        name: 'entryId',
        in: 'path',
        required: true,
        schema: { type: 'string' },
        description: 'Changelog entry ID',
      },
    ],
    responses: {
      204: { description: 'Changelog entry deleted' },
      401: {
        description: 'Unauthorized',
        content: { 'application/json': { schema: UnauthorizedErrorSchema } },
      },
      404: {
        description: 'Changelog entry not found',
        content: { 'application/json': { schema: NotFoundErrorSchema } },
      },
    },
  },
})
