/**
 * Moderation API Schema Registrations
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
import {
  TimestampSchema,
  UnauthorizedErrorSchema,
  NotFoundErrorSchema,
  ValidationErrorSchema,
} from './common'

// A pending post row in the moderation queue.
const PendingPostSchema = z.object({
  id: TypeIdSchema.meta({ example: 'post_01h455vb4pex5vsknk084sn02q' }),
  title: z.string().meta({ example: 'Add dark mode' }),
  content: z.string().meta({ example: 'It would be great to have a dark theme.' }),
  createdAt: TimestampSchema,
  boardName: z.string().meta({ example: 'Feature Requests' }),
  authorName: z.string().nullable().meta({ description: 'Author display name, null if unknown' }),
})

// A pending comment row in the moderation queue.
const PendingCommentSchema = z.object({
  id: TypeIdSchema.meta({ example: 'post_comment_01h455vb4pex5vsknk084sn02q' }),
  content: z.string().meta({ example: 'Great idea, +1' }),
  createdAt: TimestampSchema,
  postId: TypeIdSchema.meta({ example: 'post_01h455vb4pex5vsknk084sn02q' }),
  postTitle: z.string().meta({ example: 'Add dark mode' }),
  boardName: z.string().meta({ example: 'Feature Requests' }),
  boardSlug: z.string().meta({ example: 'feature-requests' }),
  authorName: z.string().nullable().meta({ description: 'Author display name, null if unknown' }),
})

const PendingResponseSchema = z
  .object({
    posts: z.array(PendingPostSchema),
    comments: z.array(PendingCommentSchema),
  })
  .meta({ description: 'Pending moderation queue' })

const OkSchema = z.object({ ok: z.boolean() })

const RejectBodySchema = createRequestBodySchema({
  reason: z.string().max(500).optional().meta({ description: 'Optional rejection reason' }),
})

const okResponse = {
  200: {
    description: 'OK',
    content: { 'application/json': { schema: createItemResponseSchema(OkSchema, 'OK') } },
  },
}

const moderationErrors = {
  400: {
    description: 'Validation error',
    content: { 'application/json': { schema: ValidationErrorSchema } },
  },
  401: {
    description: 'Unauthorized',
    content: { 'application/json': { schema: UnauthorizedErrorSchema } },
  },
  404: {
    description: 'Not found',
    content: { 'application/json': { schema: NotFoundErrorSchema } },
  },
}

const postIdParam = {
  name: 'postId',
  in: 'path' as const,
  required: true,
  schema: { type: 'string' as const },
  description: 'Post ID',
}
const commentIdParam = {
  name: 'commentId',
  in: 'path' as const,
  required: true,
  schema: { type: 'string' as const },
  description: 'Comment ID',
}

// Register GET /moderation/pending
registerPath('/moderation/pending', {
  get: {
    tags: ['Moderation'],
    summary: 'List pending moderation items',
    description: 'Returns posts and comments awaiting review. Requires a team-role API key.',
    responses: {
      200: {
        description: 'Pending queue',
        content: {
          'application/json': {
            schema: createItemResponseSchema(PendingResponseSchema, 'Pending queue'),
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

// Register POST /moderation/posts/{postId}/approve
registerPath('/moderation/posts/{postId}/approve', {
  post: {
    tags: ['Moderation'],
    summary: 'Approve a post',
    description: 'Publish a pending post (pending → published).',
    parameters: [postIdParam],
    responses: { ...okResponse, ...moderationErrors },
  },
})

// Register POST /moderation/posts/{postId}/reject
registerPath('/moderation/posts/{postId}/reject', {
  post: {
    tags: ['Moderation'],
    summary: 'Reject a post',
    description: 'Soft-delete a pending post (restoring returns it to the queue).',
    parameters: [postIdParam],
    requestBody: {
      required: false,
      content: { 'application/json': { schema: asSchema(RejectBodySchema) } },
    },
    responses: { ...okResponse, ...moderationErrors },
  },
})

// Register POST /moderation/comments/{commentId}/approve
registerPath('/moderation/comments/{commentId}/approve', {
  post: {
    tags: ['Moderation'],
    summary: 'Approve a comment',
    description: 'Publish a pending comment (pending → published).',
    parameters: [commentIdParam],
    responses: { ...okResponse, ...moderationErrors },
  },
})

// Register POST /moderation/comments/{commentId}/reject
registerPath('/moderation/comments/{commentId}/reject', {
  post: {
    tags: ['Moderation'],
    summary: 'Reject a comment',
    description: 'Soft-delete a pending comment (restoring returns it to the queue).',
    parameters: [commentIdParam],
    requestBody: {
      required: false,
      content: { 'application/json': { schema: asSchema(RejectBodySchema) } },
    },
    responses: { ...okResponse, ...moderationErrors },
  },
})
