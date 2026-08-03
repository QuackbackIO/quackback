/**
 * Conversation write/action API Schema Registrations
 */
import 'zod-openapi'
import { z } from 'zod'
import { registerPath, TypeIdSchema, createItemResponseSchema, asSchema } from '../openapi'
import {
  TimestampSchema,
  UnauthorizedErrorSchema,
  NotFoundErrorSchema,
  ValidationErrorSchema,
} from './common'

const ConversationSchema = z.object({
  id: TypeIdSchema,
  status: z.enum(['open', 'pending', 'closed']),
  channel: z.enum(['live_chat', 'email', 'web_form']),
  priority: z.enum(['none', 'low', 'medium', 'high', 'urgent']),
  subject: z.string().nullable(),
  visitorPrincipalId: TypeIdSchema,
  visitorEmail: z.string().nullable(),
  assignedAgentPrincipalId: TypeIdSchema.nullable(),
  lastMessageAt: TimestampSchema,
  resolvedAt: TimestampSchema.nullable(),
  createdAt: TimestampSchema,
})

const MessageMutationResponseSchema = z.object({
  id: TypeIdSchema,
  conversationId: TypeIdSchema,
  status: z.enum(['open', 'pending', 'closed']).optional(),
  createdAt: TimestampSchema,
})

const StatusResponseSchema = z.object({
  id: TypeIdSchema,
  status: z.enum(['open', 'pending', 'closed']),
})

const PriorityResponseSchema = z.object({
  id: TypeIdSchema,
  priority: z.enum(['none', 'low', 'medium', 'high', 'urgent']),
})

const AssignmentResponseSchema = z.object({
  id: TypeIdSchema,
  assignedAgentPrincipalId: TypeIdSchema.nullable(),
})

const ReplyBodySchema = z.object({ content: z.string().min(1).max(4000) })
const NoteBodySchema = z.object({ content: z.string().min(1).max(10000) })
const StatusBodySchema = z.object({ status: z.enum(['open', 'pending', 'closed']) })
const PriorityBodySchema = z.object({
  priority: z.enum(['none', 'low', 'medium', 'high', 'urgent']),
})
const AssignmentBodySchema = z.object({ agentPrincipalId: TypeIdSchema.nullable() })
const EndBodySchema = z.object({
  reason: z.enum(['resolved', 'tracked_as_feedback', 'duplicate', 'no_response', 'spam', 'other']),
  note: z.string().max(2000).nullable().optional(),
})

const conversationIdParam = {
  name: 'conversationId',
  in: 'path' as const,
  required: true,
  schema: asSchema(TypeIdSchema),
  description: 'Conversation ID',
}

const errorResponses = {
  400: {
    description: 'Validation error',
    content: { 'application/json': { schema: ValidationErrorSchema } },
  },
  401: {
    description: 'Unauthorized',
    content: { 'application/json': { schema: UnauthorizedErrorSchema } },
  },
  404: {
    description: 'Conversation not found',
    content: { 'application/json': { schema: NotFoundErrorSchema } },
  },
}

registerPath('/conversations/{conversationId}/reply', {
  post: {
    tags: ['Conversations'],
    summary: 'Send a public agent reply',
    parameters: [conversationIdParam],
    requestBody: {
      required: true,
      content: { 'application/json': { schema: asSchema(ReplyBodySchema) } },
    },
    responses: {
      201: {
        description: 'Reply created',
        content: {
          'application/json': {
            schema: createItemResponseSchema(MessageMutationResponseSchema, 'Created reply'),
          },
        },
      },
      ...errorResponses,
    },
  },
})

registerPath('/conversations/{conversationId}/note', {
  post: {
    tags: ['Conversations'],
    summary: 'Add an internal agent note',
    parameters: [conversationIdParam],
    requestBody: {
      required: true,
      content: { 'application/json': { schema: asSchema(NoteBodySchema) } },
    },
    responses: {
      201: {
        description: 'Internal note created',
        content: {
          'application/json': {
            schema: createItemResponseSchema(MessageMutationResponseSchema, 'Created note'),
          },
        },
      },
      ...errorResponses,
    },
  },
})

registerPath('/conversations/{conversationId}/status', {
  patch: {
    tags: ['Conversations'],
    summary: 'Set conversation status',
    parameters: [conversationIdParam],
    requestBody: {
      required: true,
      content: { 'application/json': { schema: asSchema(StatusBodySchema) } },
    },
    responses: {
      200: {
        description: 'Conversation status updated',
        content: {
          'application/json': {
            schema: createItemResponseSchema(StatusResponseSchema, 'Status update'),
          },
        },
      },
      ...errorResponses,
    },
  },
})

registerPath('/conversations/{conversationId}/priority', {
  patch: {
    tags: ['Conversations'],
    summary: 'Set conversation priority',
    parameters: [conversationIdParam],
    requestBody: {
      required: true,
      content: { 'application/json': { schema: asSchema(PriorityBodySchema) } },
    },
    responses: {
      200: {
        description: 'Conversation priority updated',
        content: {
          'application/json': {
            schema: createItemResponseSchema(PriorityResponseSchema, 'Priority update'),
          },
        },
      },
      ...errorResponses,
    },
  },
})

registerPath('/conversations/{conversationId}/assign', {
  post: {
    tags: ['Conversations'],
    summary: 'Assign or unassign a conversation',
    parameters: [conversationIdParam],
    requestBody: {
      required: true,
      content: { 'application/json': { schema: asSchema(AssignmentBodySchema) } },
    },
    responses: {
      200: {
        description: 'Conversation assignment updated',
        content: {
          'application/json': {
            schema: createItemResponseSchema(AssignmentResponseSchema, 'Assignment update'),
          },
        },
      },
      ...errorResponses,
    },
  },
})

registerPath('/conversations/{conversationId}/end', {
  post: {
    tags: ['Conversations'],
    summary: 'End a conversation',
    parameters: [conversationIdParam],
    requestBody: {
      required: true,
      content: { 'application/json': { schema: asSchema(EndBodySchema) } },
    },
    responses: {
      200: {
        description: 'Conversation ended',
        content: {
          'application/json': {
            schema: createItemResponseSchema(ConversationSchema, 'Ended conversation'),
          },
        },
      },
      ...errorResponses,
    },
  },
})

registerPath('/conversations/{conversationId}/read', {
  post: {
    tags: ['Conversations'],
    summary: 'Mark a conversation read for the calling agent',
    parameters: [conversationIdParam],
    responses: {
      204: { description: 'Conversation marked read' },
      401: errorResponses[401],
      404: errorResponses[404],
    },
  },
})
