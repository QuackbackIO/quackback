/**
 * Tickets API Schema Registrations — write routes (support platform §4.2)
 *
 * Split out of ./tickets.ts to stay under the max-lines lint threshold.
 * Read schemas/constants (TicketSchema, TicketMessageSchema, TICKET_TYPES,
 * TICKET_PRIORITIES) are exported from ./tickets and imported here.
 */
import 'zod-openapi'
import { z } from 'zod'
import {
  registerPath,
  TypeIdSchema,
  createItemResponseSchema,
  createRequestBodySchema,
  asSchema,
} from '../openapi'
import { UnauthorizedErrorSchema, NotFoundErrorSchema, ValidationErrorSchema } from './common'
import { TICKET_TYPES, TICKET_PRIORITIES, TicketSchema, TicketMessageSchema } from './tickets'

// Attachment ref accepted on a write (name/contentType optional; the service
// re-validates count/size/url).
const TicketWriteAttachmentSchema = z.object({
  url: z.string().meta({ example: 'https://cdn.example.com/uploads/screenshot.png' }),
  name: z.string().optional().meta({ example: 'screenshot.png' }),
  contentType: z.string().optional().meta({ example: 'image/png' }),
  size: z.number().meta({ description: 'Size in bytes', example: 48213 }),
})

// Request bodies for the ticket write routes.
const CreateTicketBodySchema = createRequestBodySchema({
  type: z.enum(TICKET_TYPES).meta({ description: 'Ticket object type', example: 'customer' }),
  title: z.string().min(1).max(300).meta({ example: 'Cannot log in' }),
  description: z
    .string()
    .max(4000)
    .optional()
    .meta({ description: 'Opening message as markdown', example: 'Steps to reproduce…' }),
  priority: z.enum(TICKET_PRIORITIES).optional().meta({ example: 'high' }),
  requesterPrincipalId: z.string().optional().meta({ description: 'Requester principal ID' }),
  companyId: z.string().optional().meta({ description: 'Associated company ID' }),
  attachments: z.array(TicketWriteAttachmentSchema).optional(),
})

const TicketMessageBodySchema = createRequestBodySchema({
  content: z.string().min(1).max(4000).meta({ description: 'Message body as markdown' }),
  attachments: z.array(TicketWriteAttachmentSchema).optional(),
})

const TicketStatusBodySchema = createRequestBodySchema({
  statusId: TypeIdSchema.meta({
    description: 'Target ticket status id (see GET /ticket-statuses)',
  }),
})

const TicketAssignBodySchema = createRequestBodySchema({
  assigneePrincipalId: z
    .string()
    .nullable()
    .optional()
    .meta({ description: 'Teammate principal id; null clears, omit to leave unchanged' }),
  assigneeTeamId: z
    .string()
    .nullable()
    .optional()
    .meta({ description: 'Team id; null clears, omit to leave unchanged' }),
})

const TicketPriorityBodySchema = createRequestBodySchema({
  priority: z.enum(TICKET_PRIORITIES).meta({ example: 'high' }),
})

// Standard error responses reused across the write routes.
const writeErrorResponses = {
  400: {
    description: 'Validation error',
    content: { 'application/json': { schema: ValidationErrorSchema } },
  },
  401: {
    description: 'Unauthorized',
    content: { 'application/json': { schema: UnauthorizedErrorSchema } },
  },
  404: {
    description: 'Ticket not found',
    content: { 'application/json': { schema: NotFoundErrorSchema } },
  },
}

const ticketIdParam = {
  name: 'ticketId',
  in: 'path' as const,
  required: true,
  schema: { type: 'string' as const },
  description: 'Ticket ID',
}

// Register POST /tickets (create)
registerPath('/tickets', {
  post: {
    tags: ['Tickets'],
    summary: 'Create a ticket',
    description: 'Open a ticket as a team API key. Requires a team-role API key.',
    requestBody: {
      required: true,
      content: { 'application/json': { schema: asSchema(CreateTicketBodySchema) } },
    },
    responses: {
      201: {
        description: 'Ticket created',
        content: {
          'application/json': { schema: createItemResponseSchema(TicketSchema, 'Created ticket') },
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

// Register POST /tickets/{ticketId}/reply
registerPath('/tickets/{ticketId}/reply', {
  post: {
    tags: ['Tickets'],
    summary: 'Reply to a ticket',
    description: 'Send a customer-visible agent reply on a ticket thread.',
    parameters: [ticketIdParam],
    requestBody: {
      required: true,
      content: { 'application/json': { schema: asSchema(TicketMessageBodySchema) } },
    },
    responses: {
      201: {
        description: 'Reply created',
        content: {
          'application/json': {
            schema: createItemResponseSchema(TicketMessageSchema, 'Created message'),
          },
        },
      },
      ...writeErrorResponses,
    },
  },
})

// Register POST /tickets/{ticketId}/note
registerPath('/tickets/{ticketId}/note', {
  post: {
    tags: ['Tickets'],
    summary: 'Add an internal note to a ticket',
    description: 'Add an agent-only internal note (never visible to the requester).',
    parameters: [ticketIdParam],
    requestBody: {
      required: true,
      content: { 'application/json': { schema: asSchema(TicketMessageBodySchema) } },
    },
    responses: {
      201: {
        description: 'Note created',
        content: {
          'application/json': {
            schema: createItemResponseSchema(TicketMessageSchema, 'Created note'),
          },
        },
      },
      ...writeErrorResponses,
    },
  },
})

// Register POST /tickets/{ticketId}/status
registerPath('/tickets/{ticketId}/status', {
  post: {
    tags: ['Tickets'],
    summary: 'Set a ticket status',
    description: 'Move a ticket to a workspace status id (see GET /ticket-statuses).',
    parameters: [ticketIdParam],
    requestBody: {
      required: true,
      content: { 'application/json': { schema: asSchema(TicketStatusBodySchema) } },
    },
    responses: {
      200: {
        description: 'Updated ticket',
        content: {
          'application/json': { schema: createItemResponseSchema(TicketSchema, 'Updated ticket') },
        },
      },
      ...writeErrorResponses,
    },
  },
})

// Register POST /tickets/{ticketId}/assign
registerPath('/tickets/{ticketId}/assign', {
  post: {
    tags: ['Tickets'],
    summary: 'Assign a ticket',
    description: 'Assign a ticket to a teammate and/or a team. Pass null to clear a side.',
    parameters: [ticketIdParam],
    requestBody: {
      required: true,
      content: { 'application/json': { schema: asSchema(TicketAssignBodySchema) } },
    },
    responses: {
      200: {
        description: 'Updated ticket',
        content: {
          'application/json': { schema: createItemResponseSchema(TicketSchema, 'Updated ticket') },
        },
      },
      ...writeErrorResponses,
    },
  },
})

// Register POST /tickets/{ticketId}/priority
registerPath('/tickets/{ticketId}/priority', {
  post: {
    tags: ['Tickets'],
    summary: 'Set a ticket priority',
    description: 'Set the triage priority on a ticket.',
    parameters: [ticketIdParam],
    requestBody: {
      required: true,
      content: { 'application/json': { schema: asSchema(TicketPriorityBodySchema) } },
    },
    responses: {
      200: {
        description: 'Updated ticket',
        content: {
          'application/json': { schema: createItemResponseSchema(TicketSchema, 'Updated ticket') },
        },
      },
      ...writeErrorResponses,
    },
  },
})
