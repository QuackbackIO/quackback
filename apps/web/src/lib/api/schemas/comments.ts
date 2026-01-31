/**
 * Comments API Schema Registrations
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
  UnauthorizedErrorSchema,
  NotFoundErrorSchema,
  ValidationErrorSchema,
} from './common'

// Comment schema
const CommentSchema = z.object({
  id: TypeIdSchema.meta({ example: 'comment_01h455vb4pex5vsknk084sn02q' }),
  postId: TypeIdSchema,
  content: z.string().meta({ example: 'Great idea! This would be very useful.' }),
  authorEmail: z.string().nullable().meta({ example: 'user@example.com' }),
  authorName: z.string().nullable().meta({ example: 'Jane Doe' }),
  isInternal: z.boolean().meta({ description: 'Internal staff comment', example: false }),
  parentId: TypeIdSchema.nullable().meta({ description: 'Parent comment ID for replies' }),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})

// Request body schemas
const CreateCommentSchema = z
  .object({
    content: z.string().min(1).meta({ description: 'Comment content' }),
    authorEmail: z.string().email().optional().meta({ description: 'Author email' }),
    authorName: z.string().optional().meta({ description: 'Author name' }),
    isInternal: z
      .boolean()
      .optional()
      .meta({ description: 'Mark as internal staff comment', default: false }),
    parentId: TypeIdSchema.optional().meta({ description: 'Parent comment ID for replies' }),
  })
  .meta({ description: 'Create comment request body' })

const UpdateCommentSchema = z
  .object({
    content: z.string().min(1).optional().meta({ description: 'Updated content' }),
    isInternal: z.boolean().optional().meta({ description: 'Mark as internal staff comment' }),
  })
  .meta({ description: 'Update comment request body' })

// Register GET /posts/{postId}/comments
registerPath('/posts/{postId}/comments', {
  get: {
    tags: ['Comments'],
    summary: 'List comments on a post',
    description: 'Returns all comments on a post',
    parameters: [
      {
        name: 'postId',
        in: 'path',
        required: true,
        schema: { type: 'string' },
        description: 'Post ID',
      },
    ],
    responses: {
      200: {
        description: 'List of comments',
        content: {
          'application/json': {
            schema: createPaginatedResponseSchema(CommentSchema, 'List of comments'),
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

// Register POST /posts/{postId}/comments
registerPath('/posts/{postId}/comments', {
  post: {
    tags: ['Comments'],
    summary: 'Add a comment to a post',
    description: 'Create a new comment on a post',
    parameters: [
      {
        name: 'postId',
        in: 'path',
        required: true,
        schema: { type: 'string' },
        description: 'Post ID',
      },
    ],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: asSchema(CreateCommentSchema),
        },
      },
    },
    responses: {
      201: {
        description: 'Comment created',
        content: {
          'application/json': {
            schema: createItemResponseSchema(CommentSchema, 'Created comment'),
          },
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
      404: {
        description: 'Post not found',
        content: { 'application/json': { schema: NotFoundErrorSchema } },
      },
    },
  },
})

// Register PATCH /comments/{commentId}
registerPath('/comments/{commentId}', {
  patch: {
    tags: ['Comments'],
    summary: 'Update a comment',
    description: 'Update an existing comment',
    parameters: [
      {
        name: 'commentId',
        in: 'path',
        required: true,
        schema: { type: 'string' },
        description: 'Comment ID',
      },
    ],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: asSchema(UpdateCommentSchema),
        },
      },
    },
    responses: {
      200: {
        description: 'Comment updated',
        content: {
          'application/json': {
            schema: createItemResponseSchema(CommentSchema, 'Updated comment'),
          },
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
      404: {
        description: 'Comment not found',
        content: { 'application/json': { schema: NotFoundErrorSchema } },
      },
    },
  },
})

// Register DELETE /comments/{commentId}
registerPath('/comments/{commentId}', {
  delete: {
    tags: ['Comments'],
    summary: 'Delete a comment',
    description: 'Delete a comment by ID',
    parameters: [
      {
        name: 'commentId',
        in: 'path',
        required: true,
        schema: { type: 'string' },
        description: 'Comment ID',
      },
    ],
    responses: {
      204: { description: 'Comment deleted' },
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
