/**
 * Moderation API Schema Registrations
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
import { TimestampSchema, UnauthorizedErrorSchema, NotFoundErrorSchema } from './common'

const PendingPostSchema = z
  .object({
    id: TypeIdSchema,
    title: z.string(),
    content: z.string().nullable().optional(),
    authorPrincipalId: TypeIdSchema.nullable().optional(),
    createdAt: TimestampSchema.optional(),
  })
  .passthrough()

const PendingCommentSchema = z
  .object({
    id: TypeIdSchema,
    postId: TypeIdSchema.optional(),
    content: z.string().nullable().optional(),
    principalId: TypeIdSchema.nullable().optional(),
    createdAt: TimestampSchema.optional(),
  })
  .passthrough()

const ModerationResultSchema = z.object({
  ok: z.literal(true),
  postId: TypeIdSchema.optional(),
  commentId: TypeIdSchema.optional(),
})

const RejectBodySchema = z.object({
  reason: z.string().max(1000).optional(),
})

registerPath('/moderation/posts', {
  get: {
    tags: ['Moderation'],
    summary: 'List posts awaiting moderation',
    description: 'Requires moderation.view scope and permission.',
    responses: {
      200: {
        description: 'Pending posts',
        content: {
          'application/json': {
            schema: createPaginatedResponseSchema(PendingPostSchema, 'Pending moderation posts'),
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

registerPath('/moderation/posts/{postId}/approve', {
  post: {
    tags: ['Moderation'],
    summary: 'Approve a pending post',
    parameters: [{ name: 'postId', in: 'path', required: true, schema: { type: 'string' } }],
    responses: {
      200: {
        description: 'Post approved',
        content: {
          'application/json': {
            schema: createItemResponseSchema(ModerationResultSchema, 'Moderation result'),
          },
        },
      },
      401: {
        description: 'Unauthorized',
        content: { 'application/json': { schema: UnauthorizedErrorSchema } },
      },
      404: {
        description: 'Post not found',
        content: { 'application/json': { schema: NotFoundErrorSchema } },
      },
    },
  },
})

registerPath('/moderation/posts/{postId}/reject', {
  post: {
    tags: ['Moderation'],
    summary: 'Reject a pending post',
    parameters: [{ name: 'postId', in: 'path', required: true, schema: { type: 'string' } }],
    requestBody: {
      required: false,
      content: { 'application/json': { schema: asSchema(RejectBodySchema) } },
    },
    responses: {
      200: {
        description: 'Post rejected',
        content: {
          'application/json': {
            schema: createItemResponseSchema(ModerationResultSchema, 'Moderation result'),
          },
        },
      },
      401: {
        description: 'Unauthorized',
        content: { 'application/json': { schema: UnauthorizedErrorSchema } },
      },
      404: {
        description: 'Post not found',
        content: { 'application/json': { schema: NotFoundErrorSchema } },
      },
    },
  },
})

registerPath('/moderation/comments', {
  get: {
    tags: ['Moderation'],
    summary: 'List comments awaiting moderation',
    description: 'Requires moderation.view scope and permission.',
    responses: {
      200: {
        description: 'Pending comments',
        content: {
          'application/json': {
            schema: createPaginatedResponseSchema(
              PendingCommentSchema,
              'Pending moderation comments'
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

registerPath('/moderation/comments/{commentId}/approve', {
  post: {
    tags: ['Moderation'],
    summary: 'Approve a pending comment',
    parameters: [{ name: 'commentId', in: 'path', required: true, schema: { type: 'string' } }],
    responses: {
      200: {
        description: 'Comment approved',
        content: {
          'application/json': {
            schema: createItemResponseSchema(ModerationResultSchema, 'Moderation result'),
          },
        },
      },
      401: {
        description: 'Unauthorized',
        content: { 'application/json': { schema: UnauthorizedErrorSchema } },
      },
      404: {
        description: 'Comment not found',
        content: { 'application/json': { schema: NotFoundErrorSchema } },
      },
    },
  },
})

registerPath('/moderation/comments/{commentId}/reject', {
  post: {
    tags: ['Moderation'],
    summary: 'Reject a pending comment',
    parameters: [{ name: 'commentId', in: 'path', required: true, schema: { type: 'string' } }],
    requestBody: {
      required: false,
      content: { 'application/json': { schema: asSchema(RejectBodySchema) } },
    },
    responses: {
      200: {
        description: 'Comment rejected',
        content: {
          'application/json': {
            schema: createItemResponseSchema(ModerationResultSchema, 'Moderation result'),
          },
        },
      },
      401: {
        description: 'Unauthorized',
        content: { 'application/json': { schema: UnauthorizedErrorSchema } },
      },
      404: {
        description: 'Comment not found',
        content: { 'application/json': { schema: NotFoundErrorSchema } },
      },
    },
  },
})
