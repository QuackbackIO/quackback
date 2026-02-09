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
  NullableTimestampSchema,
  UnauthorizedErrorSchema,
  NotFoundErrorSchema,
  ValidationErrorSchema,
} from './common'

// Reaction count schema
const ReactionCountSchema = z.object({
  emoji: z.string().meta({ example: '👍' }),
  count: z.number().meta({ example: 3 }),
  hasReacted: z
    .boolean()
    .meta({ description: 'Whether the authenticated user has reacted with this emoji' }),
})

// Comment list item schema (GET /posts/:id/comments) - threaded with replies
const CommentListItemSchema: z.ZodType = z.lazy(() =>
  z.object({
    id: TypeIdSchema.meta({ example: 'comment_01h455vb4pex5vsknk084sn02q' }),
    postId: TypeIdSchema,
    parentId: TypeIdSchema.nullable().meta({ description: 'Parent comment ID for replies' }),
    content: z.string().meta({ example: 'Great idea! This would be very useful.' }),
    authorName: z.string().nullable().meta({ example: 'Jane Doe' }),
    principalId: TypeIdSchema.nullable().meta({
      description: 'Principal ID of the comment author',
    }),
    isTeamMember: z
      .boolean()
      .meta({ description: 'Whether the author is a team member', example: false }),
    createdAt: TimestampSchema,
    reactions: z.array(ReactionCountSchema).meta({ description: 'Aggregated reaction counts' }),
    replies: z.array(CommentListItemSchema).meta({ description: 'Nested reply comments' }),
  })
)

// Comment detail schema (GET /comments/:id)
const CommentDetailSchema = z.object({
  id: TypeIdSchema.meta({ example: 'comment_01h455vb4pex5vsknk084sn02q' }),
  postId: TypeIdSchema,
  parentId: TypeIdSchema.nullable().meta({ description: 'Parent comment ID for replies' }),
  content: z.string().meta({ example: 'Great idea! This would be very useful.' }),
  authorName: z.string().nullable().meta({ example: 'Jane Doe' }),
  authorEmail: z.string().nullable().meta({ example: 'user@example.com' }),
  principalId: TypeIdSchema.nullable().meta({ description: 'Principal ID of the comment author' }),
  isTeamMember: z
    .boolean()
    .meta({ description: 'Whether the author is a team member', example: false }),
  createdAt: TimestampSchema,
  deletedAt: NullableTimestampSchema.meta({
    description: 'When the comment was deleted, null if active',
  }),
})

// Comment create/update response schema
const CommentResponseSchema = z.object({
  id: TypeIdSchema.meta({ example: 'comment_01h455vb4pex5vsknk084sn02q' }),
  postId: TypeIdSchema,
  parentId: TypeIdSchema.nullable(),
  content: z.string(),
  authorName: z.string().nullable(),
  principalId: TypeIdSchema.nullable(),
  isTeamMember: z.boolean(),
  createdAt: TimestampSchema,
})

// Request body schemas
const CreateCommentSchema = z
  .object({
    content: z.string().min(1).max(5000).meta({ description: 'Comment content' }),
    parentId: TypeIdSchema.optional()
      .nullable()
      .meta({ description: 'Parent comment ID for replies' }),
  })
  .meta({ description: 'Create comment request body' })

const UpdateCommentSchema = z
  .object({
    content: z.string().min(1).max(5000).meta({ description: 'Updated content' }),
  })
  .meta({ description: 'Update comment request body' })

// Register GET /posts/{postId}/comments
registerPath('/posts/{postId}/comments', {
  get: {
    tags: ['Comments'],
    summary: 'List comments on a post',
    description: 'Returns all comments on a post as a threaded tree with nested replies',
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
        description: 'Threaded list of comments',
        content: {
          'application/json': {
            schema: createPaginatedResponseSchema(CommentListItemSchema, 'List of comments'),
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
    description:
      'Create a new comment on a post. The comment is attributed to the authenticated API key holder.',
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
            schema: createItemResponseSchema(CommentResponseSchema, 'Created comment'),
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

// Register GET /comments/{commentId}
registerPath('/comments/{commentId}', {
  get: {
    tags: ['Comments'],
    summary: 'Get a comment',
    description: 'Get a single comment by ID',
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
      200: {
        description: 'Comment details',
        content: {
          'application/json': {
            schema: createItemResponseSchema(CommentDetailSchema, 'Comment details'),
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
            schema: createItemResponseSchema(CommentResponseSchema, 'Updated comment'),
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
