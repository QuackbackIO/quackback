/**
 * Conversations API Schema Registrations
 *
 * Read routes (GET) live here. Write routes (POST/DELETE) live in
 * ./conversations-write.ts, which imports the shared schemas exported below.
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
import { CONVERSATION_STATUSES } from '@/lib/shared/db-types'

// Conversation schema (GET /conversations, GET /conversations/:id)
export const ConversationSchema = z.object({
  id: TypeIdSchema.meta({ example: 'conversation_01h455vb4pex5vsknk084sn02q' }),
  status: z.enum(CONVERSATION_STATUSES).meta({
    description: 'Current conversation status',
    example: 'open',
  }),
  channel: z.enum(['messenger', 'email', 'web_form']).meta({
    description: 'Channel the conversation arrived on',
    example: 'messenger',
  }),
  priority: z.enum(['none', 'low', 'medium', 'high', 'urgent']).meta({
    description: 'Agent-set triage priority',
    example: 'none',
  }),
  subject: z.string().nullable().meta({
    description: 'Conversation subject line, null for messenger threads',
    example: null,
  }),
  visitorPrincipalId: TypeIdSchema.meta({
    description: 'Principal ID of the visiting user',
    example: 'principal_01h455vb4pex5vsknk084sn02q',
  }),
  visitorEmail: z.string().nullable().meta({
    description: 'Captured contact email for the visitor, null if not provided',
    example: 'visitor@example.com',
  }),
  assignedAgentPrincipalId: TypeIdSchema.nullable().meta({
    description: 'Principal ID of the assigned agent, null if unassigned',
    example: null,
  }),
  lastMessageAt: TimestampSchema,
  resolvedAt: NullableTimestampSchema.meta({
    description: 'When the conversation was resolved, null while still active',
  }),
  createdAt: TimestampSchema,
})

// Message schema (GET /conversations/:id/messages)
export const MessageSchema = z.object({
  id: TypeIdSchema.meta({ example: 'conversation_msg_01h455vb4pex5vsknk084sn02q' }),
  conversationId: TypeIdSchema.meta({ example: 'conversation_01h455vb4pex5vsknk084sn02q' }),
  senderType: z.enum(['visitor', 'agent', 'system']).meta({
    description: 'Who sent the message',
    example: 'visitor',
  }),
  isInternal: z.boolean().meta({
    description: 'Whether this is an internal agent note not visible to the visitor',
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
  content: z.string().meta({ example: 'Hello, I need help with my account.' }),
  createdAt: TimestampSchema,
})

// A conversation tag (POST/DELETE /conversations/:id/tags response).
export const ConversationTagSchema = z.object({
  id: TypeIdSchema.meta({ example: 'conversation_tag_01h455vb4pex5vsknk084sn02q' }),
  name: z.string().meta({ example: 'billing' }),
  color: z.string().meta({ example: '#6b7280' }),
})

// Register GET /conversations
registerPath('/conversations', {
  get: {
    tags: ['Conversations'],
    summary: 'List conversations',
    description: 'Returns a paginated list of support conversations. Requires a team-role API key.',
    parameters: [
      {
        name: 'status',
        in: 'query',
        schema: { type: 'string', enum: [...CONVERSATION_STATUSES] },
        description: 'Filter by conversation status',
      },
      {
        name: 'priority',
        in: 'query',
        schema: { type: 'string', enum: ['none', 'low', 'medium', 'high', 'urgent'] },
        description: 'Filter by triage priority',
      },
      {
        name: 'assignedAgentPrincipalId',
        in: 'query',
        schema: { type: 'string' },
        description: 'Filter by assigned agent principal ID',
      },
      {
        name: 'cursor',
        in: 'query',
        schema: { type: 'string' },
        description: 'Pagination cursor from previous response',
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
        description: 'List of conversations',
        content: {
          'application/json': {
            schema: createPaginatedResponseSchema(
              ConversationSchema,
              'Paginated conversations list'
            ),
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

// Register GET /conversations/{conversationId}
registerPath('/conversations/{conversationId}', {
  get: {
    tags: ['Conversations'],
    summary: 'Get a conversation',
    description: 'Get a single conversation by ID. Requires a team-role API key.',
    parameters: [
      {
        name: 'conversationId',
        in: 'path',
        required: true,
        schema: { type: 'string' },
        description: 'Conversation ID',
      },
    ],
    responses: {
      200: {
        description: 'Conversation details',
        content: {
          'application/json': {
            schema: createItemResponseSchema(ConversationSchema, 'Conversation details'),
          },
        },
      },
      401: {
        description: 'Unauthorized',
        content: { 'application/json': { schema: UnauthorizedErrorSchema } },
      },
      404: {
        description: 'Conversation not found',
        content: { 'application/json': { schema: NotFoundErrorSchema } },
      },
    },
  },
})

// Register GET /conversations/{conversationId}/messages
registerPath('/conversations/{conversationId}/messages', {
  get: {
    tags: ['Conversations'],
    summary: 'List messages in a conversation',
    description:
      'Returns a paginated list of messages in a conversation. Internal agent notes are excluded by default. Requires a team-role API key.',
    parameters: [
      {
        name: 'conversationId',
        in: 'path',
        required: true,
        schema: { type: 'string' },
        description: 'Conversation ID',
      },
      {
        name: 'includeInternal',
        in: 'query',
        schema: { type: 'boolean' },
        description: 'Include internal agent notes (default: false)',
      },
      {
        name: 'cursor',
        in: 'query',
        schema: { type: 'string' },
        description: 'Pagination cursor from previous response',
      },
      {
        name: 'limit',
        in: 'query',
        schema: { type: 'integer', default: 30, maximum: 100 },
        description: 'Items per page (max 100)',
      },
    ],
    responses: {
      200: {
        description: 'List of messages',
        content: {
          'application/json': {
            schema: createPaginatedResponseSchema(MessageSchema, 'Paginated messages list'),
          },
        },
      },
      401: {
        description: 'Unauthorized',
        content: { 'application/json': { schema: UnauthorizedErrorSchema } },
      },
      404: {
        description: 'Conversation not found',
        content: { 'application/json': { schema: NotFoundErrorSchema } },
      },
    },
  },
})
