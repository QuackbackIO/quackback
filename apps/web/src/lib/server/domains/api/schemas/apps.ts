/**
 * Apps API Schema Registrations
 *
 * Endpoints called from embedded apps in external help desks. Responses carry
 * permissive CORS headers and are never cached.
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
import { TimestampSchema } from './common'
import { errorResponses } from './errors'

const RequesterSchema = z.object({
  email: z.string().email(),
  name: z.string().optional(),
})

const LinkBodySchema = createRequestBodySchema({
  postId: TypeIdSchema,
  integrationType: z.string().min(1).meta({ description: 'Integration key', example: 'zendesk' }),
  externalId: z.string().min(1).meta({ description: 'Ticket ID in the external system' }),
  externalUrl: z.string().optional(),
  requester: RequesterSchema.optional().meta({
    description: 'When given, a vote is recorded for this person',
  }),
})

const UnlinkBodySchema = createRequestBodySchema({
  postId: TypeIdSchema,
  integrationType: z.string().min(1),
  externalId: z.string().min(1),
})

const CreatePostBodySchema = createRequestBodySchema({
  boardId: TypeIdSchema,
  title: z.string().min(1).max(200),
  content: z.string().max(10000).optional().meta({ description: 'Markdown body, default empty' }),
  link: z
    .object({
      integrationType: z.string().min(1),
      externalId: z.string().min(1),
      externalUrl: z.string().optional(),
    })
    .optional()
    .meta({ description: 'Link the external ticket to the new post' }),
  requester: RequesterSchema.optional().meta({
    description: 'Author and first voter of the post. Defaults to the API key owner.',
  }),
})

const LinkResultSchema = z.object({
  linkId: z.string(),
  voted: z.boolean(),
  voteCount: z.number().int(),
  principalId: TypeIdSchema.nullable(),
})

const LinkedPostSchema = z.object({
  id: TypeIdSchema,
  title: z.string(),
  voteCount: z.number().int(),
  statusName: z.string().nullable(),
  statusColor: z.string().nullable(),
  board: z.object({ name: z.string() }),
  linkId: z.string(),
  linkedAt: TimestampSchema,
})

const CreatedPostSchema = z.object({
  id: TypeIdSchema,
  title: z.string(),
  content: z.string().meta({ description: 'Markdown body' }),
  voteCount: z.number().int(),
  boardId: TypeIdSchema,
  statusId: TypeIdSchema.nullable(),
  createdAt: TimestampSchema,
})

const limitParam = (def: number) => ({
  name: 'limit',
  in: 'query' as const,
  required: false,
  schema: { type: 'integer' as const, minimum: 1, maximum: 20, default: def },
  description: 'Maximum results (capped at 20)',
})

registerPath('/apps/boards', {
  get: {
    tags: ['Apps'],
    summary: 'List boards for an embedded app',
    description:
      'Returns the boards the API key owner can see, with name and slug only. Requires the read:feedback scope and the post.view_private permission.',
    responses: {
      200: {
        description: 'Boards',
        content: {
          'application/json': {
            schema: createItemResponseSchema(
              z.object({
                boards: z.array(z.object({ id: TypeIdSchema, name: z.string(), slug: z.string() })),
              }),
              'Boards'
            ),
          },
        },
      },
      ...errorResponses(403),
    },
  },
})

registerPath('/apps/search', {
  get: {
    tags: ['Apps'],
    summary: 'Search posts',
    description:
      'Text search across posts, ordered by votes. An empty query returns no posts. Requires the post.view_private permission.',
    parameters: [
      {
        name: 'q',
        in: 'query',
        required: false,
        schema: { type: 'string' },
        description: 'Search text',
      },
      limitParam(10),
    ],
    responses: {
      200: {
        description: 'Matching posts',
        content: {
          'application/json': {
            schema: createItemResponseSchema(
              z.object({
                posts: z.array(
                  z.object({
                    id: TypeIdSchema,
                    title: z.string(),
                    voteCount: z.number().int(),
                    statusName: z.string().nullable(),
                    statusColor: z.string().nullable(),
                    board: z.object({ name: z.string() }),
                  })
                ),
              }),
              'Matching posts'
            ),
          },
        },
      },
      ...errorResponses(403),
    },
  },
})

registerPath('/apps/suggest', {
  get: {
    tags: ['Apps'],
    summary: 'Suggest similar posts',
    description:
      'Finds posts similar to a piece of text. Uses semantic similarity when AI is configured and falls back to text search otherwise, in which case similarity is null. Requires the post.view_private permission.',
    parameters: [
      {
        name: 'text',
        in: 'query',
        required: true,
        schema: { type: 'string' },
        description: 'Text to match, for example a ticket subject',
      },
      limitParam(5),
    ],
    responses: {
      200: {
        description: 'Similar posts',
        content: {
          'application/json': {
            schema: createItemResponseSchema(
              z.object({
                posts: z.array(
                  z.object({
                    id: TypeIdSchema,
                    title: z.string(),
                    voteCount: z.number().int(),
                    similarity: z.number().nullable(),
                    board: z.object({ name: z.string() }),
                  })
                ),
              }),
              'Similar posts'
            ),
          },
        },
      },
      ...errorResponses(400, 403),
    },
  },
})

registerPath('/apps/linked', {
  get: {
    tags: ['Apps'],
    summary: 'List posts linked to an external ticket',
    description: 'Requires the integration.view permission.',
    parameters: [
      {
        name: 'integrationType',
        in: 'query',
        required: true,
        schema: { type: 'string' },
        description: 'Integration key',
      },
      {
        name: 'externalId',
        in: 'query',
        required: true,
        schema: { type: 'string' },
        description: 'Ticket ID in the external system',
      },
    ],
    responses: {
      200: {
        description: 'Linked posts',
        content: {
          'application/json': {
            schema: createItemResponseSchema(
              z.object({ posts: z.array(LinkedPostSchema) }),
              'Linked posts'
            ),
          },
        },
      },
      ...errorResponses(400, 403),
    },
  },
})

registerPath('/apps/link', {
  post: {
    tags: ['Apps'],
    summary: 'Link an external ticket to a post',
    description:
      'Links the ticket to the post. Linking again is idempotent. When a requester is given, a vote is recorded for them. Requires the post.vote_on_behalf permission.',
    requestBody: {
      required: true,
      content: { 'application/json': { schema: asSchema(LinkBodySchema) } },
    },
    responses: {
      201: {
        description: 'Ticket linked',
        content: {
          'application/json': { schema: createItemResponseSchema(LinkResultSchema, 'Link result') },
        },
      },
      ...errorResponses(400, 403, 404),
    },
  },
})

registerPath('/apps/unlink', {
  post: {
    tags: ['Apps'],
    summary: 'Unlink an external ticket from a post',
    description: 'Requires the post.vote_on_behalf permission.',
    requestBody: {
      required: true,
      content: { 'application/json': { schema: asSchema(UnlinkBodySchema) } },
    },
    responses: {
      200: {
        description: 'Ticket unlinked',
        content: {
          'application/json': {
            schema: createItemResponseSchema(z.object({ success: z.boolean() }), 'Result'),
          },
        },
      },
      ...errorResponses(400, 403),
    },
  },
})

registerPath('/apps/posts', {
  post: {
    tags: ['Apps'],
    summary: 'Create a post from an external ticket',
    description:
      'Creates a post, optionally authored by a requester and linked to the external ticket. Skips moderation because the API key is a team credential. Requires the post.create permission.',
    requestBody: {
      required: true,
      content: { 'application/json': { schema: asSchema(CreatePostBodySchema) } },
    },
    responses: {
      201: {
        description: 'Post created',
        content: {
          'application/json': { schema: createItemResponseSchema(CreatedPostSchema, 'Post') },
        },
      },
      ...errorResponses(400, 403, 404),
    },
  },
})
