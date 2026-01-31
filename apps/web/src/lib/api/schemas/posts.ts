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
  HexColorSchema,
  UnauthorizedErrorSchema,
  NotFoundErrorSchema,
  ValidationErrorSchema,
} from './common'

// Post schema
const PostSchema = z.object({
  id: TypeIdSchema.meta({ example: 'post_01h455vb4pex5vsknk084sn02q' }),
  title: z.string().meta({ example: 'Add dark mode support' }),
  content: z.string().meta({ example: 'It would be great to have a dark mode option...' }),
  boardId: TypeIdSchema.meta({ example: 'board_01h455vb4pex5vsknk084sn02q' }),
  statusId: TypeIdSchema.nullable().meta({ example: 'status_01h455vb4pex5vsknk084sn02q' }),
  authorEmail: z.string().nullable().meta({ example: 'user@example.com' }),
  authorName: z.string().nullable().meta({ example: 'John Doe' }),
  voteCount: z.number().meta({ example: 42 }),
  createdAt: TimestampSchema,
})

const PostListItemSchema = z.object({
  id: TypeIdSchema,
  title: z.string(),
  content: z.string(),
  boardId: TypeIdSchema,
  statusId: TypeIdSchema.nullable(),
  authorEmail: z.string().nullable(),
  authorName: z.string().nullable(),
  voteCount: z.number(),
  commentCount: z.number(),
  createdAt: TimestampSchema,
  board: z.object({
    id: TypeIdSchema,
    name: z.string(),
    slug: z.string(),
  }),
  tags: z.array(
    z.object({
      id: TypeIdSchema,
      name: z.string(),
      color: HexColorSchema,
    })
  ),
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
      .meta({ description: 'Post content', example: 'It would be great to have...' }),
    boardId: TypeIdSchema.meta({
      description: 'Board ID',
      example: 'board_01h455vb4pex5vsknk084sn02q',
    }),
    authorEmail: z.string().email().optional().meta({ description: 'Author email' }),
    authorName: z.string().optional().meta({ description: 'Author name' }),
    tagIds: z.array(TypeIdSchema).optional().meta({ description: 'Tag IDs to assign' }),
  })
  .meta({ description: 'Create post request body' })

const UpdatePostSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    content: z.string().min(1).optional(),
    statusId: TypeIdSchema.nullable().optional(),
    boardId: TypeIdSchema.optional(),
    tagIds: z.array(TypeIdSchema).optional(),
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
        name: 'statusSlug',
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
        name: 'page',
        in: 'query',
        schema: { type: 'integer', default: 1 },
        description: 'Page number',
      },
      {
        name: 'limit',
        in: 'query',
        schema: { type: 'integer', default: 20, maximum: 100 },
        description: 'Items per page',
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
    description: 'Create a new feedback post',
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
          'application/json': { schema: createItemResponseSchema(PostSchema, 'Created post') },
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
    description: 'Get a single post by ID',
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
          'application/json': { schema: createItemResponseSchema(PostSchema, 'Post details') },
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
          'application/json': { schema: createItemResponseSchema(PostSchema, 'Updated post') },
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
