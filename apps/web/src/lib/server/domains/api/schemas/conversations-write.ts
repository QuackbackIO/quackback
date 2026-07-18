/**
 * Conversations API Schema Registrations — write routes
 *
 * Split out of ./conversations.ts to stay under the max-lines lint threshold.
 * Read schemas (ConversationSchema, MessageSchema, ConversationTagSchema) are
 * exported from ./conversations and imported here.
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
import { CONVERSATION_STATUSES, CONVERSATION_PRIORITIES } from '@/lib/shared/db-types'
import { ConversationSchema, MessageSchema, ConversationTagSchema } from './conversations'

// Attachment ref accepted on a write (name/contentType optional).
const ConversationWriteAttachmentSchema = z.object({
  url: z.string().meta({ example: 'https://cdn.example.com/uploads/screenshot.png' }),
  name: z.string().optional().meta({ example: 'screenshot.png' }),
  contentType: z.string().optional().meta({ example: 'image/png' }),
  size: z.number().meta({ description: 'Size in bytes', example: 48213 }),
})

// Request bodies for the conversation write routes.
const ConversationMessageBodySchema = createRequestBodySchema({
  content: z.string().min(1).max(4000).meta({ description: 'Message body as markdown' }),
  attachments: z.array(ConversationWriteAttachmentSchema).optional(),
})

const ConversationStatusBodySchema = createRequestBodySchema({
  status: z.enum(CONVERSATION_STATUSES).meta({ example: 'closed' }),
})

const ConversationAssignBodySchema = createRequestBodySchema({
  assigneePrincipalId: z
    .string()
    .nullable()
    .optional()
    .meta({ description: 'Agent principal id; null or omitted unassigns' }),
})

const ConversationPriorityBodySchema = createRequestBodySchema({
  priority: z.enum(CONVERSATION_PRIORITIES).meta({ example: 'high' }),
})

const ConversationTagBodySchema = createRequestBodySchema({
  tagId: TypeIdSchema.meta({ description: 'Existing conversation tag id' }),
})

const convWriteErrorResponses = {
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

const conversationIdParam = {
  name: 'conversationId',
  in: 'path' as const,
  required: true,
  schema: { type: 'string' as const },
  description: 'Conversation ID',
}

// Register POST /conversations/{conversationId}/reply
registerPath('/conversations/{conversationId}/reply', {
  post: {
    tags: ['Conversations'],
    summary: 'Reply to a conversation',
    description: 'Send an agent reply (visible to the visitor).',
    parameters: [conversationIdParam],
    requestBody: {
      required: true,
      content: { 'application/json': { schema: asSchema(ConversationMessageBodySchema) } },
    },
    responses: {
      201: {
        description: 'Reply created',
        content: {
          'application/json': {
            schema: createItemResponseSchema(MessageSchema, 'Created message'),
          },
        },
      },
      ...convWriteErrorResponses,
    },
  },
})

// Register POST /conversations/{conversationId}/note
registerPath('/conversations/{conversationId}/note', {
  post: {
    tags: ['Conversations'],
    summary: 'Add an internal note to a conversation',
    description: 'Add an agent-only internal note (never visible to the visitor).',
    parameters: [conversationIdParam],
    requestBody: {
      required: true,
      content: { 'application/json': { schema: asSchema(ConversationMessageBodySchema) } },
    },
    responses: {
      201: {
        description: 'Note created',
        content: {
          'application/json': { schema: createItemResponseSchema(MessageSchema, 'Created note') },
        },
      },
      ...convWriteErrorResponses,
    },
  },
})

// Register POST /conversations/{conversationId}/status
registerPath('/conversations/{conversationId}/status', {
  post: {
    tags: ['Conversations'],
    summary: 'Set a conversation status',
    description: 'Set open / snoozed / closed. No required-attributes close-guard for API closes.',
    parameters: [conversationIdParam],
    requestBody: {
      required: true,
      content: { 'application/json': { schema: asSchema(ConversationStatusBodySchema) } },
    },
    responses: {
      200: {
        description: 'Updated conversation',
        content: {
          'application/json': {
            schema: createItemResponseSchema(ConversationSchema, 'Updated conversation'),
          },
        },
      },
      ...convWriteErrorResponses,
    },
  },
})

// Register POST /conversations/{conversationId}/assign
registerPath('/conversations/{conversationId}/assign', {
  post: {
    tags: ['Conversations'],
    summary: 'Assign a conversation',
    description: 'Assign to a teammate, or pass null to unassign.',
    parameters: [conversationIdParam],
    requestBody: {
      required: true,
      content: { 'application/json': { schema: asSchema(ConversationAssignBodySchema) } },
    },
    responses: {
      200: {
        description: 'Updated conversation',
        content: {
          'application/json': {
            schema: createItemResponseSchema(ConversationSchema, 'Updated conversation'),
          },
        },
      },
      ...convWriteErrorResponses,
    },
  },
})

// Register POST /conversations/{conversationId}/priority
registerPath('/conversations/{conversationId}/priority', {
  post: {
    tags: ['Conversations'],
    summary: 'Set a conversation priority',
    description: 'Set the triage priority on a conversation.',
    parameters: [conversationIdParam],
    requestBody: {
      required: true,
      content: { 'application/json': { schema: asSchema(ConversationPriorityBodySchema) } },
    },
    responses: {
      200: {
        description: 'Updated conversation',
        content: {
          'application/json': {
            schema: createItemResponseSchema(ConversationSchema, 'Updated conversation'),
          },
        },
      },
      ...convWriteErrorResponses,
    },
  },
})

// Register POST /conversations/{conversationId}/read
registerPath('/conversations/{conversationId}/read', {
  post: {
    tags: ['Conversations'],
    summary: 'Mark a conversation read',
    description:
      'Mark the conversation read up to now for the agent side. Publishes a realtime read event that clears the unread signal teammates see.',
    parameters: [conversationIdParam],
    responses: {
      200: {
        description: 'Marked read',
        content: {
          'application/json': {
            schema: createItemResponseSchema(z.object({ ok: z.boolean() }), 'OK'),
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

// Register POST + DELETE /conversations/{conversationId}/tags
registerPath('/conversations/{conversationId}/tags', {
  post: {
    tags: ['Conversations'],
    summary: 'Attach a tag to a conversation',
    description: 'Attach an existing conversation tag (idempotent). Returns the updated tag list.',
    parameters: [conversationIdParam],
    requestBody: {
      required: true,
      content: { 'application/json': { schema: asSchema(ConversationTagBodySchema) } },
    },
    responses: {
      200: {
        description: 'Updated tag list',
        content: {
          'application/json': {
            schema: createItemResponseSchema(z.array(ConversationTagSchema), 'Conversation tags'),
          },
        },
      },
      ...convWriteErrorResponses,
    },
  },
  delete: {
    tags: ['Conversations'],
    summary: 'Detach a tag from a conversation',
    description: 'Detach a conversation tag. Returns the updated tag list.',
    parameters: [conversationIdParam],
    requestBody: {
      required: true,
      content: { 'application/json': { schema: asSchema(ConversationTagBodySchema) } },
    },
    responses: {
      200: {
        description: 'Updated tag list',
        content: {
          'application/json': {
            schema: createItemResponseSchema(z.array(ConversationTagSchema), 'Conversation tags'),
          },
        },
      },
      ...convWriteErrorResponses,
    },
  },
})
