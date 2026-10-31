/**
 * Tickets API Schema Registrations — watchers (who follows a ticket)
 *
 * Reading the watchers rides ticket.view; adding or removing one rides
 * ticket.assign. Only a teammate who can see the ticket can be added.
 */
import 'zod-openapi'
import { z } from 'zod'
import { registerPath, TypeIdSchema, createRequestBodySchema, asSchema } from '../openapi'
import {
  NullableTimestampSchema,
  UnauthorizedErrorSchema,
  NotFoundErrorSchema,
  ValidationErrorSchema,
} from './common'

const WATCHER_REASONS = ['requester', 'assignee', 'replier', 'manual'] as const

export const TicketWatcherSchema = z.object({
  principalId: TypeIdSchema.meta({ example: 'principal_01h455vb4pex5vsknk084sn02q' }),
  displayName: z.string().nullable().meta({ example: 'Ada Lovelace' }),
  avatarUrl: z.string().nullable(),
  isTeamMember: z.boolean().meta({ description: 'False for the requester', example: true }),
  reason: z.enum(WATCHER_REASONS).meta({
    description:
      'Why they watch: requester, assignee, replier (replied on the ticket) or manual (watched by hand, or added by a teammate)',
    example: 'manual',
  }),
  mutedUntil: NullableTimestampSchema.meta({
    description: 'While in the future, the watcher gets no notifications for this ticket',
  }),
})

const WatcherListSchema = z
  .object({ data: z.array(TicketWatcherSchema) })
  .meta({ description: 'Everyone watching the ticket' })

const AddWatcherBodySchema = createRequestBodySchema({
  principalId: TypeIdSchema.meta({
    description: 'A teammate who can see the ticket',
    example: 'principal_01h455vb4pex5vsknk084sn02q',
  }),
})

const ticketIdParam = {
  name: 'ticketId',
  in: 'path' as const,
  required: true,
  schema: { type: 'string' as const },
  description: 'Ticket ID',
}

const unauthorized = {
  description: 'Unauthorized',
  content: { 'application/json': { schema: UnauthorizedErrorSchema } },
}
const notFound = {
  description: 'Ticket not found',
  content: { 'application/json': { schema: NotFoundErrorSchema } },
}
const invalid = {
  description:
    'Validation error: the principal is not a teammate, or the ticket is hidden from them',
  content: { 'application/json': { schema: ValidationErrorSchema } },
}

registerPath('/tickets/{ticketId}/watchers', {
  get: {
    tags: ['Tickets'],
    summary: "List a ticket's watchers",
    description:
      'Everyone watching the ticket: the requester, the assignee, teammates who replied, and anyone who watches it by hand.',
    parameters: [ticketIdParam],
    responses: {
      200: {
        description: 'Watchers',
        content: { 'application/json': { schema: WatcherListSchema } },
      },
      401: unauthorized,
      404: notFound,
    },
  },
  post: {
    tags: ['Tickets'],
    summary: 'Add a watcher',
    description:
      "Add a teammate as a watcher, so they get the ticket's notifications. The teammate must be able to see the ticket. They are notified that they were added. Adding someone already watching changes nothing.",
    parameters: [ticketIdParam],
    requestBody: {
      required: true,
      content: { 'application/json': { schema: asSchema(AddWatcherBodySchema) } },
    },
    responses: {
      200: {
        description: 'Already watching; the watchers, unchanged',
        content: { 'application/json': { schema: WatcherListSchema } },
      },
      201: {
        description: 'Added; the watchers after the change',
        content: { 'application/json': { schema: WatcherListSchema } },
      },
      400: invalid,
      401: unauthorized,
      404: notFound,
    },
  },
})

registerPath('/tickets/{ticketId}/watchers/{principalId}', {
  delete: {
    tags: ['Tickets'],
    summary: 'Remove a watcher',
    description:
      'Stop someone watching the ticket. Removing the requester also stops their status updates and resolution email. Succeeds whether or not they were watching.',
    parameters: [
      ticketIdParam,
      {
        name: 'principalId',
        in: 'path' as const,
        required: true,
        schema: { type: 'string' as const },
        description: "The watcher's principal ID",
      },
    ],
    responses: {
      204: { description: 'Not watching' },
      400: {
        description: 'Validation error',
        content: { 'application/json': { schema: ValidationErrorSchema } },
      },
      401: unauthorized,
      404: notFound,
    },
  },
})
