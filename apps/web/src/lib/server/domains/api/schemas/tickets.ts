/**
 * Tickets API schema registrations (Phase 3-7).
 *
 * Covers the public ticket-management surface: queue list, CRUD, threads,
 * participants, share, take/return, bulk ops, and SLA read.
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
  UnauthorizedErrorSchema,
  NotFoundErrorSchema,
  ValidationErrorSchema,
} from './common'

const TICKET_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const
const TICKET_CHANNELS = ['portal', 'email', 'api', 'widget'] as const
const TICKET_VISIBILITY = ['team', 'org', 'shared', 'private'] as const
const STATUS_CATEGORIES = ['open', 'pending', 'on_hold', 'solved', 'closed'] as const
const SCOPES = [
  'all',
  'my_assigned',
  'my_team',
  'shared_with_me',
  'unassigned',
  'my_inbox',
  'inbox',
] as const

const TicketSchema = z
  .object({
    id: TypeIdSchema.meta({ example: 'ticket_01h455vb4pex5vsknk084sn02q' }),
    subject: z.string(),
    descriptionText: z.string().nullable(),
    priority: z.enum(TICKET_PRIORITIES),
    channel: z.enum(TICKET_CHANNELS),
    visibilityScope: z.enum(TICKET_VISIBILITY),
    statusId: TypeIdSchema.nullable(),
    primaryTeamId: TypeIdSchema.nullable(),
    assigneePrincipalId: TypeIdSchema.nullable(),
    assigneeTeamId: TypeIdSchema.nullable(),
    requesterPrincipalId: TypeIdSchema.nullable(),
    requesterContactId: TypeIdSchema.nullable(),
    organizationId: TypeIdSchema.nullable(),
    inboxId: TypeIdSchema.nullable(),
    slaPolicyId: TypeIdSchema.nullable(),
    firstResponseAt: NullableTimestampSchema,
    resolvedAt: NullableTimestampSchema,
    reopenedAt: NullableTimestampSchema,
    closedAt: NullableTimestampSchema,
    lastActivityAt: NullableTimestampSchema,
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .meta({ description: 'Ticket header record' })

const CreateTicketSchema = z
  .object({
    subject: z.string().min(1).max(500),
    descriptionJson: z.unknown().nullable().optional(),
    descriptionText: z.string().max(100_000).nullable().optional(),
    priority: z.enum(TICKET_PRIORITIES).optional(),
    channel: z.enum(TICKET_CHANNELS).optional(),
    visibilityScope: z.enum(TICKET_VISIBILITY).optional(),
    statusId: TypeIdSchema.nullable().optional(),
    primaryTeamId: TypeIdSchema.nullable().optional(),
    assigneePrincipalId: TypeIdSchema.nullable().optional(),
    assigneeTeamId: TypeIdSchema.nullable().optional(),
    requesterPrincipalId: TypeIdSchema.nullable().optional(),
    requesterContactId: TypeIdSchema.nullable().optional(),
    organizationId: TypeIdSchema.nullable().optional(),
    inboxId: TypeIdSchema.nullable().optional(),
  })
  .meta({ description: 'Create ticket request body' })

const PatchTicketSchema = z
  .object({
    expectedUpdatedAt: TimestampSchema,
    subject: z.string().min(1).max(500).optional(),
    priority: z.enum(TICKET_PRIORITIES).optional(),
    visibilityScope: z.enum(TICKET_VISIBILITY).optional(),
    primaryTeamId: TypeIdSchema.nullable().optional(),
    organizationId: TypeIdSchema.nullable().optional(),
    requesterContactId: TypeIdSchema.nullable().optional(),
  })
  .meta({ description: 'Patch ticket request body (optimistic concurrency)' })

const ThreadSchema = z
  .object({
    id: TypeIdSchema.meta({ example: 'ticket_thread_01h455vb4pex5vsknk084sn02q' }),
    ticketId: TypeIdSchema,
    principalId: TypeIdSchema.nullable(),
    audience: z.enum(['public', 'internal', 'shared_team']),
    sharedWithTeamId: TypeIdSchema.nullable(),
    bodyText: z.string().nullable(),
    bodyJson: z.unknown().nullable(),
    createdAt: TimestampSchema,
    editedAt: NullableTimestampSchema,
  })
  .meta({ description: 'Ticket thread (message)' })

const AddThreadSchema = z
  .object({
    audience: z.enum(['public', 'internal', 'shared_team']),
    bodyJson: z.unknown().nullable().optional(),
    bodyText: z.string().max(100_000).nullable().optional(),
    sharedWithTeamId: TypeIdSchema.nullable().optional(),
  })
  .meta({ description: 'Add thread to ticket request body' })

const ParticipantSchema = z
  .object({
    id: TypeIdSchema,
    ticketId: TypeIdSchema,
    principalId: TypeIdSchema.nullable(),
    contactId: TypeIdSchema.nullable(),
    role: z.enum(['watcher', 'collaborator', 'cc']),
    createdAt: TimestampSchema,
  })
  .meta({ description: 'Ticket participant' })

const ShareSchema = z
  .object({
    id: TypeIdSchema,
    ticketId: TypeIdSchema,
    teamId: TypeIdSchema,
    accessLevel: z.enum(['read', 'comment', 'full']),
    grantedByPrincipalId: TypeIdSchema.nullable(),
    grantedAt: TimestampSchema,
    revokedAt: NullableTimestampSchema,
  })
  .meta({ description: 'Cross-team share grant' })

const SlaClockSchema = z
  .object({
    id: TypeIdSchema,
    ticketId: TypeIdSchema,
    kind: z.enum(['first_response', 'next_response', 'resolution']),
    state: z.enum(['running', 'paused', 'met', 'breached', 'cancelled']),
    startedAt: TimestampSchema,
    dueAt: TimestampSchema,
    pausedAt: NullableTimestampSchema,
    breachedAt: NullableTimestampSchema,
    metAt: NullableTimestampSchema,
  })
  .meta({ description: 'Per-ticket SLA clock' })

const BulkResultSchema = z
  .object({
    succeeded: z.array(TypeIdSchema),
    failed: z.array(z.object({ ticketId: TypeIdSchema, reason: z.string() })),
  })
  .meta({ description: 'Best-effort bulk operation result' })

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

registerPath('/tickets', {
  get: {
    tags: ['Tickets'],
    summary: 'List tickets in scope',
    description: 'Returns tickets visible to the caller, filtered by scope.',
    parameters: [
      { name: 'scope', in: 'query', schema: asSchema(z.enum(SCOPES).default('my_team')) },
      {
        name: 'statusCategory',
        in: 'query',
        schema: asSchema(z.enum(STATUS_CATEGORIES).optional()),
      },
      { name: 'inboxId', in: 'query', schema: asSchema(z.string().optional()) },
      { name: 'search', in: 'query', schema: asSchema(z.string().optional()) },
      { name: 'cursor', in: 'query', schema: asSchema(z.string().optional()) },
      {
        name: 'limit',
        in: 'query',
        schema: asSchema(z.coerce.number().min(1).max(200).optional()),
      },
    ],
    responses: {
      200: {
        description: 'Ticket queue',
        content: {
          'application/json': {
            schema: createPaginatedResponseSchema(TicketSchema, 'Tickets'),
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
    tags: ['Tickets'],
    summary: 'Create a ticket',
    requestBody: {
      required: true,
      content: { 'application/json': { schema: asSchema(CreateTicketSchema) } },
    },
    responses: {
      201: {
        description: 'Ticket created',
        content: {
          'application/json': { schema: createItemResponseSchema(TicketSchema, 'Ticket') },
        },
      },
      400: {
        description: 'Validation error',
        content: { 'application/json': { schema: ValidationErrorSchema } },
      },
    },
  },
})

registerPath('/tickets/{ticketId}', {
  get: {
    tags: ['Tickets'],
    summary: 'Get a ticket',
    parameters: [{ name: 'ticketId', in: 'path', required: true, schema: asSchema(TypeIdSchema) }],
    responses: {
      200: {
        description: 'Ticket',
        content: {
          'application/json': { schema: createItemResponseSchema(TicketSchema, 'Ticket') },
        },
      },
      404: {
        description: 'Not found',
        content: { 'application/json': { schema: NotFoundErrorSchema } },
      },
    },
  },
  patch: {
    tags: ['Tickets'],
    summary: 'Update ticket header (optimistic concurrency)',
    parameters: [{ name: 'ticketId', in: 'path', required: true, schema: asSchema(TypeIdSchema) }],
    requestBody: {
      required: true,
      content: { 'application/json': { schema: asSchema(PatchTicketSchema) } },
    },
    responses: {
      200: {
        description: 'Updated ticket',
        content: {
          'application/json': { schema: createItemResponseSchema(TicketSchema, 'Ticket') },
        },
      },
      409: { description: 'Conflict (stale expectedUpdatedAt)' },
    },
  },
  delete: {
    tags: ['Tickets'],
    summary: 'Soft-delete a ticket',
    parameters: [{ name: 'ticketId', in: 'path', required: true, schema: asSchema(TypeIdSchema) }],
    responses: { 204: { description: 'Deleted' } },
  },
})

registerPath('/tickets/{ticketId}/threads', {
  get: {
    tags: ['Tickets'],
    summary: 'List threads on a ticket (audience-filtered)',
    parameters: [{ name: 'ticketId', in: 'path', required: true, schema: asSchema(TypeIdSchema) }],
    responses: {
      200: {
        description: 'Threads',
        content: {
          'application/json': { schema: createPaginatedResponseSchema(ThreadSchema, 'Threads') },
        },
      },
    },
  },
  post: {
    tags: ['Tickets'],
    summary: 'Add a thread (public reply / internal note / shared note)',
    parameters: [{ name: 'ticketId', in: 'path', required: true, schema: asSchema(TypeIdSchema) }],
    requestBody: {
      required: true,
      content: { 'application/json': { schema: asSchema(AddThreadSchema) } },
    },
    responses: {
      201: {
        description: 'Thread created',
        content: {
          'application/json': { schema: createItemResponseSchema(ThreadSchema, 'Thread') },
        },
      },
    },
  },
})

registerPath('/tickets/{ticketId}/participants', {
  get: {
    tags: ['Tickets'],
    summary: 'List participants',
    parameters: [{ name: 'ticketId', in: 'path', required: true, schema: asSchema(TypeIdSchema) }],
    responses: {
      200: {
        description: 'Participants',
        content: {
          'application/json': {
            schema: createPaginatedResponseSchema(ParticipantSchema, 'Participants'),
          },
        },
      },
    },
  },
  post: {
    tags: ['Tickets'],
    summary: 'Add a participant',
    parameters: [{ name: 'ticketId', in: 'path', required: true, schema: asSchema(TypeIdSchema) }],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: asSchema(
            z.object({
              role: z.enum(['watcher', 'collaborator', 'cc']),
              principalId: TypeIdSchema.optional(),
              contactId: TypeIdSchema.optional(),
            })
          ),
        },
      },
    },
    responses: { 201: { description: 'Participant added' } },
  },
})

registerPath('/tickets/{ticketId}/shares', {
  get: {
    tags: ['Tickets'],
    summary: 'List share grants',
    parameters: [{ name: 'ticketId', in: 'path', required: true, schema: asSchema(TypeIdSchema) }],
    responses: {
      200: {
        description: 'Shares',
        content: {
          'application/json': { schema: createPaginatedResponseSchema(ShareSchema, 'Shares') },
        },
      },
    },
  },
  post: {
    tags: ['Tickets'],
    summary: 'Share ticket with another team',
    parameters: [{ name: 'ticketId', in: 'path', required: true, schema: asSchema(TypeIdSchema) }],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: asSchema(
            z.object({
              teamId: TypeIdSchema,
              accessLevel: z.enum(['read', 'comment', 'full']).default('read'),
            })
          ),
        },
      },
    },
    responses: { 201: { description: 'Share created' } },
  },
})

registerPath('/tickets/{ticketId}/take', {
  post: {
    tags: ['Tickets'],
    summary: 'Take (self-assign) a ticket',
    parameters: [{ name: 'ticketId', in: 'path', required: true, schema: asSchema(TypeIdSchema) }],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: asSchema(z.object({ expectedUpdatedAt: TimestampSchema })),
        },
      },
    },
    responses: { 200: { description: 'Ticket taken' } },
  },
})

registerPath('/tickets/{ticketId}/return', {
  post: {
    tags: ['Tickets'],
    summary: 'Return (un-self-assign) a ticket',
    parameters: [{ name: 'ticketId', in: 'path', required: true, schema: asSchema(TypeIdSchema) }],
    responses: { 200: { description: 'Ticket returned' } },
  },
})

registerPath('/tickets/{ticketId}/sla', {
  get: {
    tags: ['Tickets'],
    summary: 'Get active SLA clocks for a ticket',
    parameters: [{ name: 'ticketId', in: 'path', required: true, schema: asSchema(TypeIdSchema) }],
    responses: {
      200: {
        description: 'Clocks',
        content: {
          'application/json': { schema: createPaginatedResponseSchema(SlaClockSchema, 'Clocks') },
        },
      },
    },
  },
})

registerPath('/tickets/bulk/assign', {
  post: {
    tags: ['Tickets'],
    summary: 'Bulk-assign tickets (best-effort)',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: asSchema(
            z.object({
              ticketIds: z.array(TypeIdSchema).min(1).max(500),
              assigneePrincipalId: TypeIdSchema.nullable(),
            })
          ),
        },
      },
    },
    responses: {
      200: {
        description: 'Per-ticket result',
        content: { 'application/json': { schema: BulkResultSchema } },
      },
    },
  },
})

registerPath('/tickets/bulk/transition', {
  post: {
    tags: ['Tickets'],
    summary: 'Bulk-transition ticket statuses (best-effort)',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: asSchema(
            z.object({
              ticketIds: z.array(TypeIdSchema).min(1).max(500),
              statusId: TypeIdSchema,
            })
          ),
        },
      },
    },
    responses: { 200: { description: 'Per-ticket result' } },
  },
})

registerPath('/tickets/bulk/change-inbox', {
  post: {
    tags: ['Tickets'],
    summary: 'Bulk-move tickets to a different inbox (best-effort)',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: asSchema(
            z.object({
              ticketIds: z.array(TypeIdSchema).min(1).max(500),
              inboxId: TypeIdSchema.nullable(),
            })
          ),
        },
      },
    },
    responses: { 200: { description: 'Per-ticket result' } },
  },
})

// ---------------------------------------------------------------------------
// Phase 1 additions: restore, activity, thread edit/delete, attachments
// ---------------------------------------------------------------------------

const ActivityRowSchema = z
  .object({
    id: TypeIdSchema,
    ticketId: TypeIdSchema,
    principalId: TypeIdSchema.nullable(),
    type: z.string().meta({
      description: 'Event type, e.g. ticket.created, ticket.status_changed, thread.added',
    }),
    metadata: z.unknown(),
    createdAt: TimestampSchema,
    actorName: z.string().nullable(),
    actorAvatarUrl: z.string().nullable(),
  })
  .meta({ description: 'Single ticket-activity event' })

const ActivityResponseSchema = z
  .object({
    data: z.object({
      activity: z.array(ActivityRowSchema),
      nextCursor: z
        .string()
        .nullable()
        .meta({ description: 'ISO timestamp cursor for the next page; null when none' }),
    }),
  })
  .meta({ description: 'Ticket activity timeline response' })

const ThreadEditSchema = z
  .object({
    bodyJson: z.unknown().nullable().optional(),
    bodyText: z.string().max(100_000).nullable().optional(),
  })
  .meta({ description: 'Edit thread body — author only. Provide bodyJson or bodyText.' })

const AttachmentSchema = z
  .object({
    id: TypeIdSchema.meta({ example: 'ticket_att_01h455vb4pex5vsknk084sn02q' }),
    threadId: TypeIdSchema,
    uploadedByPrincipalId: TypeIdSchema.nullable(),
    filename: z.string(),
    mimeType: z.string(),
    sizeBytes: z.number().int(),
    storageKey: z.string(),
    publicUrl: z.string().nullable(),
    createdAt: TimestampSchema,
  })
  .meta({ description: 'Ticket attachment metadata' })

registerPath('/tickets/{ticketId}/restore', {
  post: {
    tags: ['Tickets'],
    summary: 'Restore a soft-deleted ticket (admin)',
    description:
      'Pairs with `DELETE /tickets/{ticketId}`. Admin-only. Returns 409 if the ticket is not deleted.',
    parameters: [{ name: 'ticketId', in: 'path', required: true, schema: asSchema(TypeIdSchema) }],
    responses: {
      200: {
        description: 'Ticket restored',
        content: {
          'application/json': { schema: createItemResponseSchema(TicketSchema, 'Ticket') },
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
      409: { description: 'Ticket is not deleted' },
    },
  },
})

registerPath('/tickets/{ticketId}/activity', {
  get: {
    tags: ['Tickets'],
    summary: 'List ticket activity (timeline)',
    description:
      'Reverse-chronological feed of all activity events on the ticket. Use `before` (ISO timestamp) for pagination.',
    parameters: [
      { name: 'ticketId', in: 'path', required: true, schema: asSchema(TypeIdSchema) },
      {
        name: 'before',
        in: 'query',
        required: false,
        schema: { type: 'string', format: 'date-time' },
        description: 'Return rows strictly older than this timestamp',
      },
      {
        name: 'limit',
        in: 'query',
        required: false,
        schema: { type: 'integer', minimum: 1, maximum: 200 },
        description: 'Default 50, max 200',
      },
    ],
    responses: {
      200: {
        description: 'Activity timeline page',
        content: { 'application/json': { schema: asSchema(ActivityResponseSchema) } },
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

registerPath('/tickets/{ticketId}/threads/{threadId}', {
  get: {
    tags: ['Tickets'],
    summary: 'Get a single thread',
    parameters: [
      { name: 'ticketId', in: 'path', required: true, schema: asSchema(TypeIdSchema) },
      { name: 'threadId', in: 'path', required: true, schema: asSchema(TypeIdSchema) },
    ],
    responses: {
      200: {
        description: 'Thread detail',
        content: {
          'application/json': { schema: createItemResponseSchema(ThreadSchema, 'Thread') },
        },
      },
      404: {
        description: 'Ticket or thread not found',
        content: { 'application/json': { schema: NotFoundErrorSchema } },
      },
    },
  },
  patch: {
    tags: ['Tickets'],
    summary: 'Edit a thread (author only)',
    description: 'Only the original author may edit. Stamps `editedAt` and `editedByPrincipalId`.',
    parameters: [
      { name: 'ticketId', in: 'path', required: true, schema: asSchema(TypeIdSchema) },
      { name: 'threadId', in: 'path', required: true, schema: asSchema(TypeIdSchema) },
    ],
    requestBody: {
      required: true,
      content: { 'application/json': { schema: asSchema(ThreadEditSchema) } },
    },
    responses: {
      200: {
        description: 'Thread updated',
        content: {
          'application/json': { schema: createItemResponseSchema(ThreadSchema, 'Thread') },
        },
      },
      400: {
        description: 'Validation error',
        content: { 'application/json': { schema: ValidationErrorSchema } },
      },
      403: { description: 'Not the author' },
      404: {
        description: 'Ticket or thread not found',
        content: { 'application/json': { schema: NotFoundErrorSchema } },
      },
    },
  },
  delete: {
    tags: ['Tickets'],
    summary: 'Soft-delete a thread',
    description:
      'Author or any caller with `ticket.edit_fields` may soft-delete. The row is marked `deletedAt`.',
    parameters: [
      { name: 'ticketId', in: 'path', required: true, schema: asSchema(TypeIdSchema) },
      { name: 'threadId', in: 'path', required: true, schema: asSchema(TypeIdSchema) },
    ],
    responses: {
      204: { description: 'Deleted' },
      403: { description: 'Not the author and lacks ticket.edit_fields' },
      404: {
        description: 'Ticket or thread not found',
        content: { 'application/json': { schema: NotFoundErrorSchema } },
      },
    },
  },
})

registerPath('/tickets/{ticketId}/threads/{threadId}/attachments', {
  get: {
    tags: ['Tickets'],
    summary: 'List attachments on a thread',
    parameters: [
      { name: 'ticketId', in: 'path', required: true, schema: asSchema(TypeIdSchema) },
      { name: 'threadId', in: 'path', required: true, schema: asSchema(TypeIdSchema) },
    ],
    responses: {
      200: {
        description: 'Attachments',
        content: {
          'application/json': {
            schema: createPaginatedResponseSchema(AttachmentSchema, 'Attachments'),
          },
        },
      },
      404: {
        description: 'Ticket or thread not found',
        content: { 'application/json': { schema: NotFoundErrorSchema } },
      },
    },
  },
  post: {
    tags: ['Tickets'],
    summary: 'Upload an attachment to a thread (multipart)',
    description:
      'multipart/form-data with a `file` field. Image MIME types only (jpeg/png/gif/webp/avif), 5 MB cap.',
    parameters: [
      { name: 'ticketId', in: 'path', required: true, schema: asSchema(TypeIdSchema) },
      { name: 'threadId', in: 'path', required: true, schema: asSchema(TypeIdSchema) },
    ],
    requestBody: {
      required: true,
      content: {
        'multipart/form-data': {
          schema: {
            type: 'object',
            properties: {
              file: { type: 'string', format: 'binary' },
            },
            required: ['file'],
          },
        },
      },
    },
    responses: {
      201: {
        description: 'Attachment created',
        content: {
          'application/json': {
            schema: createItemResponseSchema(AttachmentSchema, 'Attachment'),
          },
        },
      },
      400: {
        description: 'Invalid upload',
        content: { 'application/json': { schema: ValidationErrorSchema } },
      },
      404: {
        description: 'Ticket or thread not found',
        content: { 'application/json': { schema: NotFoundErrorSchema } },
      },
    },
  },
})

registerPath('/tickets/{ticketId}/threads/{threadId}/attachments/{attachmentId}', {
  get: {
    tags: ['Tickets'],
    summary: 'Get a single attachment',
    parameters: [
      { name: 'ticketId', in: 'path', required: true, schema: asSchema(TypeIdSchema) },
      { name: 'threadId', in: 'path', required: true, schema: asSchema(TypeIdSchema) },
      { name: 'attachmentId', in: 'path', required: true, schema: asSchema(TypeIdSchema) },
    ],
    responses: {
      200: {
        description: 'Attachment detail',
        content: {
          'application/json': { schema: createItemResponseSchema(AttachmentSchema, 'Attachment') },
        },
      },
      404: {
        description: 'Ticket / thread / attachment not found',
        content: { 'application/json': { schema: NotFoundErrorSchema } },
      },
    },
  },
  delete: {
    tags: ['Tickets'],
    summary: 'Delete an attachment',
    description:
      'Removes the metadata row. Allowed for the original uploader or any caller with `ticket.edit_fields`.',
    parameters: [
      { name: 'ticketId', in: 'path', required: true, schema: asSchema(TypeIdSchema) },
      { name: 'threadId', in: 'path', required: true, schema: asSchema(TypeIdSchema) },
      { name: 'attachmentId', in: 'path', required: true, schema: asSchema(TypeIdSchema) },
    ],
    responses: {
      204: { description: 'Deleted' },
      403: { description: 'Not the uploader and lacks ticket.edit_fields' },
      404: {
        description: 'Ticket / thread / attachment not found',
        content: { 'application/json': { schema: NotFoundErrorSchema } },
      },
    },
  },
})

// ---------------------------------------------------------------------------
// Assign & Transition
// ---------------------------------------------------------------------------

registerPath('/tickets/{ticketId}/assign', {
  post: {
    tags: ['Tickets'],
    summary: 'Assign a ticket',
    description:
      'Assign to an agent (assigneePrincipalId) and/or a team (assigneeTeamId). Requires `ticket.assign_any` or `ticket.assign_self` if assigning to self.',
    parameters: [{ name: 'ticketId', in: 'path', required: true, schema: asSchema(TypeIdSchema) }],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: asSchema(
            z.object({
              expectedUpdatedAt: z.string().datetime(),
              assigneePrincipalId: TypeIdSchema.nullable().optional(),
              assigneeTeamId: TypeIdSchema.nullable().optional(),
            })
          ),
        },
      },
    },
    responses: {
      200: {
        description: 'Ticket assigned',
        content: {
          'application/json': { schema: createItemResponseSchema(TicketSchema, 'Ticket') },
        },
      },
      400: {
        description: 'Validation error',
        content: { 'application/json': { schema: ValidationErrorSchema } },
      },
      403: { description: 'Insufficient permissions' },
      404: {
        description: 'Ticket not found',
        content: { 'application/json': { schema: NotFoundErrorSchema } },
      },
    },
  },
})

registerPath('/tickets/{ticketId}/transition', {
  post: {
    tags: ['Tickets'],
    summary: 'Transition ticket status',
    description:
      'Move the ticket to a new status. Sets lifecycle timestamps based on the destination category. Requires `ticket.edit_fields`.',
    parameters: [{ name: 'ticketId', in: 'path', required: true, schema: asSchema(TypeIdSchema) }],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: asSchema(
            z.object({
              expectedUpdatedAt: z.string().datetime(),
              statusId: TypeIdSchema,
            })
          ),
        },
      },
    },
    responses: {
      200: {
        description: 'Ticket transitioned',
        content: {
          'application/json': { schema: createItemResponseSchema(TicketSchema, 'Ticket') },
        },
      },
      400: {
        description: 'Validation error',
        content: { 'application/json': { schema: ValidationErrorSchema } },
      },
      403: { description: 'ticket.edit_fields required' },
      404: {
        description: 'Ticket not found',
        content: { 'application/json': { schema: NotFoundErrorSchema } },
      },
    },
  },
})

// ---------------------------------------------------------------------------
// Sub-resource deletions
// ---------------------------------------------------------------------------

registerPath('/tickets/{ticketId}/shares/{shareId}', {
  delete: {
    tags: ['Tickets'],
    summary: 'Revoke a share',
    description: 'Revoke a cross-team share grant. Requires `ticket.share_cross_team`.',
    parameters: [
      { name: 'ticketId', in: 'path', required: true, schema: asSchema(TypeIdSchema) },
      { name: 'shareId', in: 'path', required: true, schema: asSchema(TypeIdSchema) },
    ],
    responses: {
      204: { description: 'Share revoked' },
      403: { description: 'ticket.share_cross_team required' },
      404: {
        description: 'Ticket or share not found',
        content: { 'application/json': { schema: NotFoundErrorSchema } },
      },
    },
  },
})

registerPath('/tickets/{ticketId}/participants/{participantId}', {
  delete: {
    tags: ['Tickets'],
    summary: 'Remove a participant',
    description:
      'Remove a watcher/collaborator/CC from the ticket. Requires `ticket.manage_participants`.',
    parameters: [
      { name: 'ticketId', in: 'path', required: true, schema: asSchema(TypeIdSchema) },
      { name: 'participantId', in: 'path', required: true, schema: asSchema(TypeIdSchema) },
    ],
    responses: {
      204: { description: 'Participant removed' },
      403: { description: 'ticket.manage_participants required' },
      404: {
        description: 'Ticket or participant not found',
        content: { 'application/json': { schema: NotFoundErrorSchema } },
      },
    },
  },
})
