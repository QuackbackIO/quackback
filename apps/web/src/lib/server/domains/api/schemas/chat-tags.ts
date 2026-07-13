/**
 * Conversation tag API Schema Registrations
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
import { UnauthorizedErrorSchema, NotFoundErrorSchema, ValidationErrorSchema } from './common'

const ChatTagSchema = z.object({
  id: TypeIdSchema.meta({ example: 'chat_tag_01h455vb4pex5vsknk084sn02q' }),
  name: z.string().meta({ example: 'VIP' }),
  color: z.string().meta({ example: '#6b7280' }),
})

const ChatTagWithCountSchema = ChatTagSchema.extend({
  count: z.number().meta({ description: 'Number of open conversations currently using the tag' }),
})

const ChatTagBodySchema = z.object({
  name: z.string().min(1).max(80),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
})

const AttachChatTagBodySchema = z.object({ chatTagId: TypeIdSchema })

const validation = {
  description: 'Validation error',
  content: { 'application/json': { schema: ValidationErrorSchema } },
}
const unauthorized = {
  description: 'Unauthorized',
  content: { 'application/json': { schema: UnauthorizedErrorSchema } },
}
const notFound = {
  description: 'Resource not found',
  content: { 'application/json': { schema: NotFoundErrorSchema } },
}

registerPath('/chat-tags', {
  get: {
    tags: ['Conversations'],
    summary: 'List conversation tags',
    responses: {
      200: {
        description: 'Conversation tags',
        content: {
          'application/json': {
            schema: createPaginatedResponseSchema(ChatTagWithCountSchema, 'Conversation tags'),
          },
        },
      },
      401: unauthorized,
    },
  },
  post: {
    tags: ['Conversations'],
    summary: 'Create a conversation tag',
    requestBody: {
      required: true,
      content: { 'application/json': { schema: asSchema(ChatTagBodySchema) } },
    },
    responses: {
      201: {
        description: 'Conversation tag created',
        content: {
          'application/json': {
            schema: createItemResponseSchema(ChatTagSchema, 'Created conversation tag'),
          },
        },
      },
      400: validation,
      401: unauthorized,
    },
  },
})

registerPath('/chat-tags/{tagId}', {
  patch: {
    tags: ['Conversations'],
    summary: 'Update a conversation tag',
    parameters: [{ name: 'tagId', in: 'path', required: true, schema: { type: 'string' } }],
    requestBody: {
      required: true,
      content: { 'application/json': { schema: asSchema(ChatTagBodySchema.partial()) } },
    },
    responses: {
      200: {
        description: 'Conversation tag updated',
        content: {
          'application/json': {
            schema: createItemResponseSchema(ChatTagSchema, 'Updated conversation tag'),
          },
        },
      },
      400: validation,
      401: unauthorized,
      404: notFound,
    },
  },
  delete: {
    tags: ['Conversations'],
    summary: 'Delete a conversation tag',
    parameters: [{ name: 'tagId', in: 'path', required: true, schema: { type: 'string' } }],
    responses: {
      204: { description: 'Conversation tag deleted' },
      401: unauthorized,
      404: notFound,
    },
  },
})

registerPath('/conversations/{conversationId}/tags', {
  get: {
    tags: ['Conversations'],
    summary: 'List tags on a conversation',
    parameters: [
      { name: 'conversationId', in: 'path', required: true, schema: { type: 'string' } },
    ],
    responses: {
      200: {
        description: 'Tags on the conversation',
        content: {
          'application/json': {
            schema: createPaginatedResponseSchema(ChatTagSchema, 'Conversation tags'),
          },
        },
      },
      401: unauthorized,
      404: notFound,
    },
  },
  post: {
    tags: ['Conversations'],
    summary: 'Attach a tag to a conversation',
    parameters: [
      { name: 'conversationId', in: 'path', required: true, schema: { type: 'string' } },
    ],
    requestBody: {
      required: true,
      content: { 'application/json': { schema: asSchema(AttachChatTagBodySchema) } },
    },
    responses: {
      200: {
        description: 'Tag attached',
        content: {
          'application/json': {
            schema: createItemResponseSchema(ChatTagSchema, 'Attached conversation tag'),
          },
        },
      },
      400: validation,
      401: unauthorized,
      404: notFound,
    },
  },
})

registerPath('/conversations/{conversationId}/tags/{chatTagId}', {
  delete: {
    tags: ['Conversations'],
    summary: 'Detach a tag from a conversation',
    parameters: [
      { name: 'conversationId', in: 'path', required: true, schema: { type: 'string' } },
      { name: 'chatTagId', in: 'path', required: true, schema: { type: 'string' } },
    ],
    responses: {
      200: {
        description: 'Tag detached',
        content: {
          'application/json': {
            schema: createItemResponseSchema(ChatTagSchema, 'Detached conversation tag'),
          },
        },
      },
      401: unauthorized,
      404: notFound,
    },
  },
})
