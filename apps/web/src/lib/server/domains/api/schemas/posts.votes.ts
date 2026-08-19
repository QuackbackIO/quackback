/**
 * Posts Votes API Schema Registrations
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

// Response schema
const VoteResultSchema = z
  .object({
    voted: z.boolean().meta({ description: 'Whether the post is now voted' }),
    voteCount: z.number().meta({ description: 'Current vote count' }),
  })
  .meta({ description: 'Vote result' })

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

// Register POST and DELETE /posts/{postId}/vote/proxy
const ProxyVoteBodySchema = z
  .object({
    voterPrincipalId: TypeIdSchema.meta({ description: 'Principal ID of the voter' }),
  })
  .meta({ description: 'Proxy vote request body' })

registerPath('/posts/{postId}/vote/proxy', {
  post: {
    tags: ['Votes'],
    summary: 'Add a proxy vote',
    description:
      'Add a vote on behalf of another user (insert-only, never toggles). Requires team role.',
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
      content: { 'application/json': { schema: asSchema(ProxyVoteBodySchema) } },
    },
    responses: {
      200: {
        description: 'Proxy vote added',
        content: {
          'application/json': {
            schema: createItemResponseSchema(VoteResultSchema, 'Vote result'),
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
  delete: {
    tags: ['Votes'],
    summary: 'Remove a vote',
    description: 'Remove any vote (proxy, integration, or direct) for a user. Requires team role.',
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
      content: { 'application/json': { schema: asSchema(ProxyVoteBodySchema) } },
    },
    responses: {
      204: { description: 'Vote removed' },
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

// Response schema for a single voter
const VoterSchema = z
  .object({
    principalId: TypeIdSchema.meta({ description: 'Principal ID of the voter' }),
    displayName: z.string().nullable().meta({ description: 'Voter display name' }),
    email: z.string().nullable().meta({ description: 'Voter email address' }),
    avatarUrl: z.string().nullable().meta({ description: 'Voter avatar URL' }),
    isAnonymous: z
      .boolean()
      .meta({ description: 'Whether the voter is anonymous (identity stripped)' }),
    sourceType: z
      .string()
      .nullable()
      .meta({ description: 'Source of the vote (e.g. an integration)' }),
    sourceExternalUrl: z
      .string()
      .nullable()
      .meta({ description: 'External URL the vote originated from' }),
    addedByName: z
      .string()
      .nullable()
      .meta({ description: 'Name of the team member who added the vote on behalf' }),
    createdAt: z.string().meta({ description: 'When the vote was cast' }),
  })
  .meta({ description: 'Post voter' })

// Register GET /posts/{postId}/voters
registerPath('/posts/{postId}/voters', {
  get: {
    tags: ['Votes'],
    summary: 'List voters on a post',
    description: 'Returns a paginated list of voters on a post, newest votes first',
    parameters: [
      {
        name: 'postId',
        in: 'path',
        required: true,
        schema: { type: 'string' },
        description: 'Post ID',
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
        description: 'List of voters',
        content: {
          'application/json': {
            schema: createPaginatedResponseSchema(VoterSchema, 'Paginated voters list'),
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
