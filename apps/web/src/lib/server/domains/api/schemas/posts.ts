/**
 * Posts API Schema Registrations
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
  HexColorSchema,
  UnauthorizedErrorSchema,
  NotFoundErrorSchema,
  ValidationErrorSchema,
} from './common'

// Tag nested schema (shared between list and detail)
const TagSchema = z.object({
  id: TypeIdSchema,
  name: z.string(),
  color: HexColorSchema,
})

// Pinned comment nested schema
const PinnedCommentSchema = z
  .object({
    id: TypeIdSchema,
    content: z.string(),
    authorName: z.string().nullable(),
    createdAt: TimestampSchema,
  })
  .nullable()

// Post list item schema (GET /posts)
const PostListItemSchema = z.object({
  id: TypeIdSchema.meta({ example: 'post_01h455vb4pex5vsknk084sn02q' }),
  title: z.string().meta({ example: 'Add dark mode support' }),
  content: z.string().meta({ example: 'It would be great to have a dark mode option...' }),
  voteCount: z.number().meta({ example: 42 }),
  commentCount: z.number().meta({ example: 5 }),
  boardId: TypeIdSchema.meta({ example: 'board_01h455vb4pex5vsknk084sn02q' }),
  boardSlug: z
    .string()
    .meta({ description: 'Slug of the parent board', example: 'feature-requests' }),
  boardName: z
    .string()
    .meta({ description: 'Name of the parent board', example: 'Feature Requests' }),
  statusId: TypeIdSchema.nullable().meta({ example: 'status_01h455vb4pex5vsknk084sn02q' }),
  authorName: z.string().nullable().meta({ example: 'John Doe' }),
  ownerId: z.string().nullable().meta({ description: 'Assigned team member ID' }),
  tags: z.array(TagSchema).meta({ description: 'Tags assigned to this post' }),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})

// Post detail schema (GET /posts/:id)
const PostDetailSchema = z.object({
  id: TypeIdSchema.meta({ example: 'post_01h455vb4pex5vsknk084sn02q' }),
  title: z.string().meta({ example: 'Add dark mode support' }),
  content: z.string().meta({ example: 'It would be great to have a dark mode option...' }),
  contentJson: z
    .record(z.string(), z.unknown())
    .nullable()
    .meta({ description: 'Rich text content as TipTap JSON' }),
  voteCount: z.number().meta({ example: 42 }),
  commentCount: z.number().meta({ example: 5 }),
  boardId: TypeIdSchema.meta({ example: 'board_01h455vb4pex5vsknk084sn02q' }),
  boardSlug: z
    .string()
    .meta({ description: 'Slug of the parent board', example: 'feature-requests' }),
  boardName: z
    .string()
    .meta({ description: 'Name of the parent board', example: 'Feature Requests' }),
  statusId: TypeIdSchema.nullable().meta({ example: 'status_01h455vb4pex5vsknk084sn02q' }),
  authorName: z.string().nullable().meta({ example: 'John Doe' }),
  authorEmail: z.string().nullable().meta({ example: 'user@example.com' }),
  ownerId: z.string().nullable().meta({ description: 'Assigned team member ID' }),
  officialResponse: z.string().nullable().meta({ description: 'Official team response text' }),
  officialResponseAuthorName: z
    .string()
    .nullable()
    .meta({ description: 'Name of team member who wrote the official response' }),
  officialResponseAt: NullableTimestampSchema.meta({
    description: 'When the official response was posted',
  }),
  tags: z.array(TagSchema).meta({ description: 'Tags assigned to this post' }),
  roadmapIds: z.array(z.string()).meta({ description: 'IDs of roadmaps this post belongs to' }),
  pinnedComment: PinnedCommentSchema.meta({
    description: 'Pinned comment used as official response',
  }),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  deletedAt: NullableTimestampSchema.meta({
    description: 'When the post was deleted, null if active',
  }),
})

// Post create response schema (POST /posts)
const PostCreateResponseSchema = z.object({
  id: TypeIdSchema.meta({ example: 'post_01h455vb4pex5vsknk084sn02q' }),
  title: z.string(),
  content: z.string(),
  voteCount: z.number(),
  boardId: TypeIdSchema,
  statusId: TypeIdSchema.nullable(),
  authorName: z.string().nullable(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})

// Post update response schema (PATCH /posts/:id)
const PostUpdateResponseSchema = z.object({
  id: TypeIdSchema,
  title: z.string(),
  content: z.string(),
  contentJson: z.record(z.string(), z.unknown()).nullable(),
  voteCount: z.number(),
  boardId: TypeIdSchema,
  statusId: TypeIdSchema.nullable(),
  authorName: z.string().nullable(),
  ownerId: z.string().nullable(),
  officialResponse: z.string().nullable(),
  officialResponseAuthorName: z.string().nullable(),
  officialResponseAt: NullableTimestampSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})

// Request body schemas
const CreatePostSchema = z
  .object({
    title: z
      .string()
      .min(1)
      .max(200)
      .meta({ description: 'Post title', example: 'Add dark mode support' }),
    content: z
      .string()
      .min(1)
      .max(10000)
      .meta({ description: 'Post content', example: 'It would be great to have...' }),
    boardId: TypeIdSchema.meta({
      description: 'Board ID',
      example: 'board_01h455vb4pex5vsknk084sn02q',
    }),
    statusId: TypeIdSchema.optional().meta({ description: 'Initial status ID' }),
    tagIds: z.array(TypeIdSchema).optional().meta({ description: 'Tag IDs to assign' }),
  })
  .meta({ description: 'Create post request body' })

const UpdatePostSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    content: z.string().min(1).max(10000).optional(),
    statusId: z
      .string()
      .nullable()
      .optional()
      .meta({ description: 'Status ID (set to null to clear)' }),
    tagIds: z.array(TypeIdSchema).optional(),
    ownerId: z
      .string()
      .nullable()
      .optional()
      .meta({ description: 'Assigned team member ID (set to null to unassign)' }),
    officialResponse: z
      .string()
      .nullable()
      .optional()
      .meta({ description: 'Official team response (set to null to clear)' }),
  })
  .meta({ description: 'Update post request body' })

// Response schemas
const VoteResultSchema = z
  .object({
    voted: z.boolean().meta({ description: 'Whether the post is now voted' }),
    voteCount: z.number().meta({ description: 'Current vote count' }),
  })
  .meta({ description: 'Vote result' })

// Register GET /posts
registerPath('/posts', {
  get: {
    tags: ['Posts'],
    summary: 'List posts',
    description: 'Returns a paginated list of posts with optional filtering',
    parameters: [
      {
        name: 'boardId',
        in: 'query',
        schema: { type: 'string' },
        description: 'Filter by board ID',
      },
      {
        name: 'status',
        in: 'query',
        schema: { type: 'string' },
        description: 'Filter by status slug',
      },
      {
        name: 'tagIds',
        in: 'query',
        schema: { type: 'string' },
        description: 'Filter by tag IDs (comma-separated)',
      },
      {
        name: 'search',
        in: 'query',
        schema: { type: 'string' },
        description: 'Search in title and content',
      },
      {
        name: 'sort',
        in: 'query',
        schema: { type: 'string', enum: ['newest', 'oldest', 'votes'] },
        description: 'Sort order',
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
        description: 'List of posts',
        content: {
          'application/json': {
            schema: createPaginatedResponseSchema(PostListItemSchema, 'Paginated posts list'),
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

// Register POST /posts
registerPath('/posts', {
  post: {
    tags: ['Posts'],
    summary: 'Create a post',
    description:
      'Create a new feedback post. The post is created on behalf of the authenticated API key holder.',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: asSchema(CreatePostSchema),
        },
      },
    },
    responses: {
      201: {
        description: 'Post created',
        content: {
          'application/json': {
            schema: createItemResponseSchema(PostCreateResponseSchema, 'Created post'),
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
    },
  },
})

// Register GET /posts/{postId}
registerPath('/posts/{postId}', {
  get: {
    tags: ['Posts'],
    summary: 'Get a post',
    description: 'Get a single post by ID with full details',
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
        description: 'Post details',
        content: {
          'application/json': {
            schema: createItemResponseSchema(PostDetailSchema, 'Post details'),
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

// Register PATCH /posts/{postId}
registerPath('/posts/{postId}', {
  patch: {
    tags: ['Posts'],
    summary: 'Update a post',
    description: 'Update an existing post',
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
          schema: asSchema(UpdatePostSchema),
        },
      },
    },
    responses: {
      200: {
        description: 'Post updated',
        content: {
          'application/json': {
            schema: createItemResponseSchema(PostUpdateResponseSchema, 'Updated post'),
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

// Register DELETE /posts/{postId}
registerPath('/posts/{postId}', {
  delete: {
    tags: ['Posts'],
    summary: 'Delete a post',
    description: 'Delete a post by ID',
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
      204: { description: 'Post deleted' },
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

// Register POST /posts/{postId}/vote
registerPath('/posts/{postId}/vote', {
  post: {
    tags: ['Votes'],
    summary: 'Toggle vote on a post',
    description: 'Vote or unvote on a post (toggle)',
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
        description: 'Vote toggled',
        content: {
          'application/json': {
            schema: createItemResponseSchema(VoteResultSchema, 'Vote result'),
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
