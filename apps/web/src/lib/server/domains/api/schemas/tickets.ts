/**
 * Tickets API Schema Registrations (support platform §4.2)
 *
 * Read routes (GET) live here. Write routes (POST) live in ./tickets-write.ts,
 * which imports the shared schemas/constants exported below.
 */
import 'zod-openapi'
import { z } from 'zod'
import {
  registerPath,
  TypeIdSchema,
  createItemResponseSchema,
  createPaginatedResponseSchema,
} from '../openapi'
import {
  TimestampSchema,
  NullableTimestampSchema,
  UnauthorizedErrorSchema,
  NotFoundErrorSchema,
} from './common'

export const TICKET_TYPES = ['customer', 'back_office', 'tracker'] as const
export const TICKET_CATEGORIES = ['open', 'pending', 'closed'] as const
export const TICKET_STAGES = ['received', 'in_progress', 'awaiting_requester', 'resolved'] as const
export const TICKET_PRIORITIES = ['none', 'low', 'medium', 'high', 'urgent'] as const
const TICKET_SORTS = ['recent', 'oldest', 'created', 'priority'] as const

// Ticket schema (GET /tickets, GET /tickets/:id)
export const TicketSchema = z.object({
  id: TypeIdSchema.meta({ example: 'ticket_01h455vb4pex5vsknk084sn02q' }),
  number: z.number().meta({ description: 'Per-workspace sequential ticket number', example: 42 }),
  reference: z.string().meta({ description: 'Human reference, "#" + number', example: '#42' }),
  type: z.enum(TICKET_TYPES).meta({ description: 'Ticket object type', example: 'customer' }),
  title: z.string().meta({ example: 'Cannot log in' }),
  status: z
    .object({
      name: z.string().meta({ example: 'In progress' }),
      category: z.enum(TICKET_CATEGORIES).meta({
        description: 'Internal lifecycle axis (open, pending, closed)',
        example: 'open',
      }),
    })
    .meta({ description: 'Internal workspace status: its display name + stable category' }),
  stage: z.enum(TICKET_STAGES).nullable().meta({
    description: 'Customer-facing public stage, null when the status projects none',
    example: 'in_progress',
  }),
  priority: z.enum(TICKET_PRIORITIES).meta({ description: 'Triage priority', example: 'high' }),
  requesterPrincipalId: TypeIdSchema.nullable().meta({
    description: 'Principal ID of the requester, null if unattributed',
    example: 'principal_01h455vb4pex5vsknk084sn02q',
  }),
  assigneePrincipalId: TypeIdSchema.nullable().meta({
    description: 'Principal ID of the assigned teammate, null if unassigned',
    example: null,
  }),
  assigneeTeamId: TypeIdSchema.nullable().meta({
    description: 'ID of the assigned team, null if unassigned',
    example: null,
  }),
  companyId: TypeIdSchema.nullable().meta({
    description: 'ID of the associated company, null if none',
    example: null,
  }),
  firstResponseAt: NullableTimestampSchema.meta({
    description: 'When a teammate first responded, null until then',
  }),
  dueAt: NullableTimestampSchema.meta({ description: 'SLA due time, null if no policy applies' }),
  resolvedAt: NullableTimestampSchema.meta({
    description: 'When the ticket entered a closed status, null while open',
  }),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  reopenedCount: z
    .number()
    .meta({ description: 'How many times the ticket has reopened', example: 0 }),
})

// A single image/file attachment ref on a ticket message.
const TicketMessageAttachmentSchema = z.object({
  url: z.string().meta({ example: 'https://cdn.example.com/uploads/screenshot.png' }),
  name: z.string().meta({ example: 'screenshot.png' }),
  contentType: z.string().meta({ example: 'image/png' }),
  size: z.number().meta({ description: 'Size in bytes', example: 48213 }),
})

// Ticket message schema (GET /tickets/:id/messages)
export const TicketMessageSchema = z.object({
  id: TypeIdSchema.meta({ example: 'conversation_msg_01h455vb4pex5vsknk084sn02q' }),
  ticketId: TypeIdSchema.meta({ example: 'ticket_01h455vb4pex5vsknk084sn02q' }),
  senderType: z.enum(['visitor', 'agent', 'system']).meta({
    description: 'Who sent the message',
    example: 'visitor',
  }),
  isInternal: z.boolean().meta({
    description: 'Whether this is an internal teammate note not visible to the requester',
    example: false,
  }),
  authorPrincipalId: TypeIdSchema.nullable().meta({
    description: 'Principal ID of the author, null for system messages',
    example: 'principal_01h455vb4pex5vsknk084sn02q',
  }),
  authorName: z.string().nullable().meta({
    description: 'Display name of the author, null for system messages',
    example: 'Jane Doe',
  }),
  content: z.string().meta({
    description:
      'Markdown content. Derived from contentJson when it carries an image (restores ' +
      '`![](…)` that plain markdown storage would otherwise lose), else the stored text verbatim.',
    example: 'I still cannot sign in after resetting my password.',
  }),
  contentJson: z
    .record(z.string(), z.unknown())
    .nullable()
    .meta({ description: 'Rich text content as TipTap JSON, null for plain-text messages' }),
  attachments: z
    .array(TicketMessageAttachmentSchema)
    .nullable()
    .meta({ description: 'Image/file attachments, null if none' }),
  createdAt: TimestampSchema,
})

// A workspace ticket status (GET /ticket-statuses discovery endpoint, D11).
const TicketStatusSchema = z.object({
  id: TypeIdSchema.meta({ example: 'ticket_status_01h455vb4pex5vsknk084sn02q' }),
  name: z.string().meta({ example: 'In progress' }),
  slug: z.string().meta({ example: 'in_progress' }),
  color: z.string().meta({ example: '#3b82f6' }),
  category: z.enum(TICKET_CATEGORIES).meta({
    description: 'Internal lifecycle axis (open, pending, closed)',
    example: 'open',
  }),
  stage: z.enum(TICKET_STAGES).nullable().meta({
    description: 'Customer-facing public stage this status projects to, null if internal-only',
    example: 'in_progress',
  }),
  position: z.number().meta({ description: 'Ordering within its category', example: 0 }),
  isDefault: z.boolean().meta({ description: 'Whether new tickets open in this status' }),
})

// Register GET /ticket-statuses (discovery for the opaque status ids)
registerPath('/ticket-statuses', {
  get: {
    tags: ['Tickets'],
    summary: 'List ticket statuses',
    description:
      "Returns the workspace's ticket statuses (ordered by category then position). Use these ids with POST /tickets/{ticketId}/status. Requires a team-role API key.",
    responses: {
      200: {
        description: 'List of ticket statuses',
        content: {
          'application/json': {
            schema: createItemResponseSchema(z.array(TicketStatusSchema), 'Ticket statuses'),
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

// Register GET /tickets
registerPath('/tickets', {
  get: {
    tags: ['Tickets'],
    summary: 'List tickets',
    description:
      'Returns tickets for the workspace (a team-role API key sees every ticket). Requires a team-role API key.',
    parameters: [
      {
        name: 'type',
        in: 'query',
        schema: { type: 'string', enum: [...TICKET_TYPES] },
        description: 'Filter by ticket type',
      },
      {
        name: 'statusCategory',
        in: 'query',
        schema: { type: 'string', enum: [...TICKET_CATEGORIES] },
        description: 'Filter by internal status category',
      },
      {
        name: 'stage',
        in: 'query',
        schema: { type: 'string', enum: [...TICKET_STAGES] },
        description: 'Filter by customer-facing public stage',
      },
      {
        name: 'requesterPrincipalId',
        in: 'query',
        schema: { type: 'string' },
        description: 'Filter by requester principal ID',
      },
      {
        name: 'companyId',
        in: 'query',
        schema: { type: 'string' },
        description: 'Filter by company ID',
      },
      {
        name: 'sort',
        in: 'query',
        schema: { type: 'string', enum: [...TICKET_SORTS], default: 'recent' },
        description: 'Sort order',
      },
      {
        name: 'limit',
        in: 'query',
        schema: { type: 'integer', default: 20, maximum: 100 },
        description: 'Items per page (max 100)',
      },
    ],
    responses: {
      200: {
        description: 'List of tickets',
        content: {
          'application/json': {
            schema: createPaginatedResponseSchema(TicketSchema, 'Tickets list'),
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

// Register GET /tickets/{ticketId}
registerPath('/tickets/{ticketId}', {
  get: {
    tags: ['Tickets'],
    summary: 'Get a ticket',
    description: 'Get a single ticket by ID. Requires a team-role API key.',
    parameters: [
      {
        name: 'ticketId',
        in: 'path',
        required: true,
        schema: { type: 'string' },
        description: 'Ticket ID',
      },
    ],
    responses: {
      200: {
        description: 'Ticket details',
        content: {
          'application/json': {
            schema: createItemResponseSchema(TicketSchema, 'Ticket details'),
          },
        },
      },
      401: {
        description: 'Unauthorized',
        content: { 'application/json': { schema: UnauthorizedErrorSchema } },
      },
      404: {
        description: 'Ticket not found',
        content: { 'application/json': { schema: NotFoundErrorSchema } },
      },
    },
  },
})

// Register GET /tickets/{ticketId}/messages
registerPath('/tickets/{ticketId}/messages', {
  get: {
    tags: ['Tickets'],
    summary: 'List messages in a ticket thread',
    description:
      'Returns a ticket thread oldest-first. Internal teammate notes are excluded unless includeInternal=true. Requires a team-role API key.',
    parameters: [
      {
        name: 'ticketId',
        in: 'path',
        required: true,
        schema: { type: 'string' },
        description: 'Ticket ID',
      },
      {
        name: 'includeInternal',
        in: 'query',
        schema: { type: 'boolean' },
        description: 'Include internal teammate notes (default: false)',
      },
      {
        name: 'before',
        in: 'query',
        schema: { type: 'string' },
        description: 'Message ID cursor for the next older page (from meta.pagination.cursor)',
      },
    ],
    responses: {
      200: {
        description: 'List of messages',
        content: {
          'application/json': {
            schema: createPaginatedResponseSchema(TicketMessageSchema, 'Ticket thread'),
          },
        },
      },
      401: {
        description: 'Unauthorized',
        content: { 'application/json': { schema: UnauthorizedErrorSchema } },
      },
      404: {
        description: 'Ticket not found',
        content: { 'application/json': { schema: NotFoundErrorSchema } },
      },
    },
  },
})
