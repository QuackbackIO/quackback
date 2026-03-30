/**
 * Posts Votes API Schema Registrations
 */
import 'zod-openapi'
import { z } from 'zod'
import { registerPath, TypeIdSchema, createItemResponseSchema, asSchema } from '../openapi'
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
