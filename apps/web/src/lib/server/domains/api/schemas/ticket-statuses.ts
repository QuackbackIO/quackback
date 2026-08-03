/**
 * Ticket-statuses API schema registrations.
 *
 * The workflow status catalogue used by `/api/v1/tickets/:id/transition`.
 * Distinct from `/statuses`, which covers feedback-board post statuses.
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
  NullableTimestampSchema,
  HexColorSchema,
  SlugSchema,
  UnauthorizedErrorSchema,
  NotFoundErrorSchema,
  ValidationErrorSchema,
} from './common'

const STATUS_CATEGORIES = ['open', 'pending', 'on_hold', 'solved', 'closed'] as const

const TicketStatusSchema = z
  .object({
    id: TypeIdSchema.meta({ example: 'ticket_status_01h455vb4pex5vsknk084sn02q' }),
    name: z.string(),
    slug: SlugSchema,
    color: HexColorSchema.nullable(),
    category: z.enum(STATUS_CATEGORIES),
    position: z.number().int(),
    isDefault: z.boolean(),
    isSystem: z.boolean().meta({ description: 'System statuses cannot be archived' }),
    createdAt: TimestampSchema,
    deletedAt: NullableTimestampSchema,
  })
  .meta({ description: 'Ticket workflow status (workflow state)' })

const CreateTicketStatusSchema = z
  .object({
    name: z.string().min(1).max(50),
    slug: z
      .string()
      .min(1)
      .max(50)
      .regex(/^[a-z0-9_-]+$/, 'slug must match [a-z0-9_-]+'),
    color: HexColorSchema.optional(),
    category: z.enum(STATUS_CATEGORIES),
    position: z.number().int().min(0).optional(),
    isDefault: z.boolean().optional(),
  })
  .meta({ description: 'Create ticket-status request body' })

const UpdateTicketStatusSchema = z
  .object({
    name: z.string().min(1).max(50).optional(),
    color: HexColorSchema.optional(),
    category: z.enum(STATUS_CATEGORIES).optional(),
    position: z.number().int().min(0).optional(),
    isDefault: z.boolean().optional(),
  })
  .meta({ description: 'Update ticket-status request body' })

registerPath('/ticket-statuses', {
  get: {
    tags: ['Ticket Statuses'],
    summary: 'List ticket statuses',
    description: 'Returns the workspace ticket-status catalogue, ordered by position.',
    parameters: [
      {
        name: 'includeDeleted',
        in: 'query',
        required: false,
        schema: { type: 'boolean' },
        description: 'Include archived statuses',
      },
    ],
    responses: {
      200: {
        description: 'List of ticket statuses',
        content: {
          'application/json': {
            schema: createPaginatedResponseSchema(TicketStatusSchema, 'Statuses'),
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
    tags: ['Ticket Statuses'],
    summary: 'Create a ticket status (admin)',
    requestBody: {
      required: true,
      content: { 'application/json': { schema: asSchema(CreateTicketStatusSchema) } },
    },
    responses: {
      201: {
        description: 'Status created',
        content: {
          'application/json': {
            schema: createItemResponseSchema(TicketStatusSchema, 'Status'),
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
      409: { description: 'Slug already in use' },
    },
  },
})

registerPath('/ticket-statuses/{statusId}', {
  get: {
    tags: ['Ticket Statuses'],
    summary: 'Get a ticket status',
    parameters: [{ name: 'statusId', in: 'path', required: true, schema: asSchema(TypeIdSchema) }],
    responses: {
      200: {
        description: 'Status',
        content: {
          'application/json': {
            schema: createItemResponseSchema(TicketStatusSchema, 'Status'),
          },
        },
      },
      404: {
        description: 'Status not found',
        content: { 'application/json': { schema: NotFoundErrorSchema } },
      },
    },
  },
  patch: {
    tags: ['Ticket Statuses'],
    summary: 'Update a ticket status (admin)',
    parameters: [{ name: 'statusId', in: 'path', required: true, schema: asSchema(TypeIdSchema) }],
    requestBody: {
      required: true,
      content: { 'application/json': { schema: asSchema(UpdateTicketStatusSchema) } },
    },
    responses: {
      200: {
        description: 'Status updated',
        content: {
          'application/json': {
            schema: createItemResponseSchema(TicketStatusSchema, 'Status'),
          },
        },
      },
      400: {
        description: 'Validation error',
        content: { 'application/json': { schema: ValidationErrorSchema } },
      },
      404: {
        description: 'Status not found',
        content: { 'application/json': { schema: NotFoundErrorSchema } },
      },
    },
  },
  delete: {
    tags: ['Ticket Statuses'],
    summary: 'Archive a ticket status (admin)',
    description:
      'Soft-archives the status (sets `deletedAt`). Returns 409 if any active ticket still references the status, and rejects with 400 for system statuses.',
    parameters: [{ name: 'statusId', in: 'path', required: true, schema: asSchema(TypeIdSchema) }],
    responses: {
      204: { description: 'Archived' },
      400: {
        description: 'System status — cannot archive',
        content: { 'application/json': { schema: ValidationErrorSchema } },
      },
      404: {
        description: 'Status not found',
        content: { 'application/json': { schema: NotFoundErrorSchema } },
      },
      409: { description: 'Status is still referenced by active tickets' },
    },
  },
})
