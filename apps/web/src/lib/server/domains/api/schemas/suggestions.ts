/**
 * Suggestions schema registrations: AI-generated feedback suggestions and
 * their accept / dismiss / restore lifecycle actions.
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
import { TimestampSchema, UnauthorizedErrorSchema } from './common'

// ---------------------------------------------------------------------------
// Suggestions
// ---------------------------------------------------------------------------

const SuggestionRawItemSchema = z
  .object({
    id: TypeIdSchema,
    sourceType: z.string(),
    externalUrl: z.string().nullable(),
    author: z.string().nullable(),
  })
  .nullable()

const SuggestionSchema = z.object({
  id: TypeIdSchema.meta({ example: 'feedback_suggestion_01h455vb4pex5vsknk084sn02q' }),
  suggestionType: z.enum(['create_post', 'vote_on_post', 'duplicate_post']),
  status: z.enum(['pending', 'dismissed']),
  suggestedTitle: z.string().nullable(),
  suggestedBody: z.string().nullable(),
  reasoning: z.string().nullable(),
  similarityScore: z.number().nullable(),
  rawItem: SuggestionRawItemSchema,
  targetPost: z.unknown(),
  sourcePost: z.unknown(),
  board: z.unknown(),
  signal: z.unknown(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})

registerPath('/suggestions', {
  get: {
    tags: ['Suggestions'],
    summary: 'List AI-generated feedback suggestions',
    parameters: [
      {
        name: 'status',
        in: 'query',
        schema: asSchema(z.enum(['pending', 'dismissed']).optional()),
      },
      {
        name: 'type',
        in: 'query',
        schema: asSchema(z.enum(['create_post', 'vote_on_post', 'duplicate_post']).optional()),
      },
      {
        name: 'sort',
        in: 'query',
        schema: asSchema(z.enum(['newest', 'relevance']).optional()),
      },
      {
        name: 'limit',
        in: 'query',
        schema: asSchema(z.coerce.number().min(1).max(100).optional()),
      },
      { name: 'cursor', in: 'query', schema: asSchema(z.string().optional()) },
    ],
    responses: {
      200: {
        description: 'Suggestions',
        content: {
          'application/json': {
            schema: createPaginatedResponseSchema(SuggestionSchema, 'Suggestions'),
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

registerPath('/suggestions/{suggestionId}/accept', {
  post: {
    tags: ['Suggestions'],
    summary: 'Accept a suggestion',
    description:
      'Accepts a feedback or merge suggestion. For `vote_on_post` with no edits this proxies a vote; ' +
      'otherwise a post is created. The suggestion ID is a `feedback_suggestion_*` or `merge_sug_*` TypeID.',
    parameters: [
      { name: 'suggestionId', in: 'path', required: true, schema: asSchema(TypeIdSchema) },
    ],
    requestBody: {
      required: false,
      content: {
        'application/json': {
          schema: asSchema(
            z.object({
              edits: z
                .object({
                  title: z.string().optional(),
                  body: z.string().optional(),
                  boardId: z.string().optional(),
                  statusId: z.string().optional(),
                })
                .optional(),
              swapDirection: z.boolean().optional(),
            })
          ),
        },
      },
    },
    responses: {
      200: {
        description: 'Suggestion accepted',
        content: {
          'application/json': {
            schema: createItemResponseSchema(
              z.object({
                accepted: z.literal(true),
                id: TypeIdSchema,
                resultPostId: TypeIdSchema.optional(),
              }),
              'Accept result'
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

registerPath('/suggestions/{suggestionId}/dismiss', {
  post: {
    tags: ['Suggestions'],
    summary: 'Dismiss a suggestion',
    parameters: [
      { name: 'suggestionId', in: 'path', required: true, schema: asSchema(TypeIdSchema) },
    ],
    responses: {
      200: {
        description: 'Suggestion dismissed',
        content: {
          'application/json': {
            schema: createItemResponseSchema(
              z.object({ dismissed: z.literal(true), id: TypeIdSchema }),
              'Dismiss result'
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

registerPath('/suggestions/{suggestionId}/restore', {
  post: {
    tags: ['Suggestions'],
    summary: 'Restore a dismissed suggestion back to pending',
    parameters: [
      { name: 'suggestionId', in: 'path', required: true, schema: asSchema(TypeIdSchema) },
    ],
    responses: {
      200: {
        description: 'Suggestion restored',
        content: {
          'application/json': {
            schema: createItemResponseSchema(
              z.object({ restored: z.literal(true), id: TypeIdSchema }),
              'Restore result'
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
