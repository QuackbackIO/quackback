/**
 * Apps integration schema registrations: public board/post discovery,
 * post creation, semantic suggestion, and ticket<->post linking used by
 * embedded app integrations (e.g. helpdesk plugins).
 *
 * Routes live under apps/web/src/routes/api/v1/apps/*.
 */
import 'zod-openapi'
import { z } from 'zod'
import { registerPath, TypeIdSchema, createItemResponseSchema, asSchema } from '../openapi'
import { TimestampSchema, UnauthorizedErrorSchema } from './common'

// ---------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------

const RequesterSchema = z
  .object({
    email: z.string().email(),
    name: z.string().optional(),
  })
  .meta({ description: 'Optional requester whose vote/identity is attached' })

const BoardSummarySchema = z.object({
  id: TypeIdSchema.meta({ example: 'board_01h455vb4pex5vsknk084sn02q' }),
  name: z.string(),
  slug: z.string(),
})

const SearchPostSchema = z.object({
  id: TypeIdSchema.meta({ example: 'post_01h455vb4pex5vsknk084sn02q' }),
  title: z.string(),
  voteCount: z.number(),
  statusName: z.string().nullable(),
  statusColor: z.string().nullable(),
  board: z.object({ name: z.string() }),
})

const SuggestPostSchema = z.object({
  id: TypeIdSchema.meta({ example: 'post_01h455vb4pex5vsknk084sn02q' }),
  title: z.string(),
  voteCount: z.number(),
  similarity: z.number().nullable().meta({
    description:
      'Cosine similarity (0-1) when AI embeddings are configured; null on text-search fallback',
  }),
  board: z.object({ name: z.string() }),
})

const CreatedPostSchema = z.object({
  id: TypeIdSchema.meta({ example: 'post_01h455vb4pex5vsknk084sn02q' }),
  title: z.string(),
  content: z.string(),
  voteCount: z.number(),
  boardId: TypeIdSchema,
  statusId: TypeIdSchema.nullable(),
  createdAt: TimestampSchema,
})

// ---------------------------------------------------------------------------
// GET /apps/boards
// ---------------------------------------------------------------------------

registerPath('/apps/boards', {
  get: {
    tags: ['Apps'],
    summary: 'List boards visible to the API key',
    description:
      'Returns the boards the team-scoped API key can see (id, name, slug), for use as a board picker in an embedded app.',
    responses: {
      200: {
        description: 'Boards',
        content: {
          'application/json': {
            schema: asSchema(z.object({ boards: z.array(BoardSummarySchema) })),
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

// ---------------------------------------------------------------------------
// POST /apps/posts
// ---------------------------------------------------------------------------

registerPath('/apps/posts', {
  post: {
    tags: ['Apps'],
    summary: 'Create a post',
    description:
      'Creates a post on a board. Optionally links the created post to an external ticket and/or attaches a requester whose vote is added.',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: asSchema(
            z.object({
              boardId: z.string().min(1).meta({ description: 'Board TypeID' }),
              title: z.string().min(1).max(200),
              content: z.string().max(10000).optional().default(''),
              link: z
                .object({
                  integrationType: z.string().min(1),
                  externalId: z.string().min(1),
                  externalUrl: z.string().optional(),
                })
                .optional()
                .meta({ description: 'Optionally link the new post to an external ticket' }),
              requester: RequesterSchema.optional(),
            })
          ),
        },
      },
    },
    responses: {
      201: {
        description: 'Post created',
        content: {
          'application/json': { schema: createItemResponseSchema(CreatedPostSchema, 'Post') },
        },
      },
      401: {
        description: 'Unauthorized',
        content: { 'application/json': { schema: UnauthorizedErrorSchema } },
      },
    },
  },
})

// ---------------------------------------------------------------------------
// GET /apps/search
// ---------------------------------------------------------------------------

registerPath('/apps/search', {
  get: {
    tags: ['Apps'],
    summary: 'Search posts',
    description: 'Full-text search across visible posts, sorted by top votes.',
    parameters: [
      {
        name: 'q',
        in: 'query',
        schema: asSchema(z.string().optional()),
        description: 'Search query; empty query returns an empty list',
      },
      {
        name: 'limit',
        in: 'query',
        schema: asSchema(z.coerce.number().min(1).max(20).optional()),
        description: 'Max results (default 10, capped at 20)',
      },
    ],
    responses: {
      200: {
        description: 'Matching posts',
        content: {
          'application/json': {
            schema: asSchema(z.object({ posts: z.array(SearchPostSchema) })),
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

// ---------------------------------------------------------------------------
// GET /apps/suggest
// ---------------------------------------------------------------------------

registerPath('/apps/suggest', {
  get: {
    tags: ['Apps'],
    summary: 'Suggest similar posts',
    description:
      'Returns posts semantically similar to the supplied text via vector embeddings, falling back to text search when AI is not configured.',
    parameters: [
      {
        name: 'text',
        in: 'query',
        required: true,
        schema: asSchema(z.string()),
        description: 'Text to find similar posts for',
      },
      {
        name: 'limit',
        in: 'query',
        schema: asSchema(z.coerce.number().min(1).max(20).optional()),
        description: 'Max results (default 5, capped at 20)',
      },
    ],
    responses: {
      200: {
        description: 'Suggested posts',
        content: {
          'application/json': {
            schema: asSchema(z.object({ posts: z.array(SuggestPostSchema) })),
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

// ---------------------------------------------------------------------------
// POST /apps/link
// ---------------------------------------------------------------------------

registerPath('/apps/link', {
  post: {
    tags: ['Apps'],
    summary: 'Link a post to an external ticket',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: asSchema(
            z.object({
              postId: z.string().min(1).meta({ description: 'Post TypeID' }),
              integrationType: z.string().min(1),
              externalId: z.string().min(1),
              externalUrl: z.string().optional(),
              requester: RequesterSchema.optional(),
            })
          ),
        },
      },
    },
    responses: {
      201: { description: 'Linked' },
      401: {
        description: 'Unauthorized',
        content: { 'application/json': { schema: UnauthorizedErrorSchema } },
      },
    },
  },
})

// ---------------------------------------------------------------------------
// POST /apps/unlink
// ---------------------------------------------------------------------------

registerPath('/apps/unlink', {
  post: {
    tags: ['Apps'],
    summary: 'Unlink a post from an external ticket',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: asSchema(
            z.object({
              postId: z.string().min(1).meta({ description: 'Post TypeID' }),
              integrationType: z.string().min(1),
              externalId: z.string().min(1),
            })
          ),
        },
      },
    },
    responses: {
      200: {
        description: 'Unlinked',
        content: {
          'application/json': { schema: asSchema(z.object({ success: z.boolean() })) },
        },
      },
      401: {
        description: 'Unauthorized',
        content: { 'application/json': { schema: UnauthorizedErrorSchema } },
      },
    },
  },
})

// ---------------------------------------------------------------------------
// GET /apps/linked
// ---------------------------------------------------------------------------

registerPath('/apps/linked', {
  get: {
    tags: ['Apps'],
    summary: 'List posts linked to an external ticket',
    parameters: [
      {
        name: 'integrationType',
        in: 'query',
        required: true,
        schema: asSchema(z.string()),
      },
      {
        name: 'externalId',
        in: 'query',
        required: true,
        schema: asSchema(z.string()),
      },
    ],
    responses: {
      200: {
        description: 'Linked posts',
        content: {
          'application/json': {
            schema: asSchema(z.object({ posts: z.array(z.unknown()) })),
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
