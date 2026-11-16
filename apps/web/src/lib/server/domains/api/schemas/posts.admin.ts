/**
 * Post activity, merge and merge-suggestion API Schema Registrations
 */
import 'zod-openapi'
import { z } from 'zod'
import {
  registerPath,
  TypeIdSchema,
  createItemResponseSchema,
  createPaginatedResponseSchema,
  createRequestBodySchema,
  asSchema,
} from '../openapi'
import { TimestampSchema } from './common'
import { errorResponses } from './errors'

const ActivitySchema = z.object({
  id: TypeIdSchema,
  postId: TypeIdSchema.meta({ example: 'post_01h455vb4pex5vsknk084sn02q' }),
  principalId: TypeIdSchema.nullable().meta({ description: 'Who acted, null for system events' }),
  actorName: z.string().nullable(),
  type: z.string().meta({ description: 'Activity type', example: 'status.changed' }),
  metadata: z
    .record(z.string(), z.unknown())
    .meta({ description: 'Event details, shape depends on the type' }),
  createdAt: TimestampSchema,
})

const MergeBodySchema = createRequestBodySchema({
  canonicalPostId: TypeIdSchema.meta({
    description: 'The post that survives. Votes and comments move onto it.',
  }),
})

const MergeResultSchema = z.object({
  canonicalPost: z.object({ id: TypeIdSchema, voteCount: z.number().int() }),
  duplicatePost: z.object({ id: TypeIdSchema }),
})

const AcceptBodySchema = createRequestBodySchema({
  swapDirection: z.boolean().optional().meta({
    description: 'Merge the suggestion target into the source instead of the reverse',
  }),
})

const MergeSuggestionPostSchema = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string().nullable(),
  voteCount: z.number().int(),
  commentCount: z.number().int(),
  createdAt: TimestampSchema,
  boardName: z.string().nullable(),
  statusName: z.string().nullable(),
  statusColor: z.string().nullable(),
})

const MergeSuggestionSchema = z.object({
  id: TypeIdSchema,
  status: z.string(),
  hybridScore: z.number(),
  llmConfidence: z.number(),
  llmReasoning: z.string().nullable(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  sourcePost: MergeSuggestionPostSchema,
  targetPost: MergeSuggestionPostSchema,
})

const postIdParam = {
  name: 'postId',
  in: 'path',
  required: true,
  schema: { type: 'string' },
  description: 'Post ID',
} as const

const suggestionIdParam = {
  name: 'suggestionId',
  in: 'path',
  required: true,
  schema: { type: 'string' },
  description: 'Merge suggestion ID (post_merge_sug_...)',
} as const

const suggestionResult = (flag: string, description: string) => ({
  200: {
    description,
    content: {
      'application/json': {
        schema: createItemResponseSchema(
          z.object({ [flag]: z.literal(true), id: z.string() }),
          description
        ),
      },
    },
  },
})

registerPath('/posts/{postId}/activity', {
  get: {
    tags: ['Posts'],
    summary: 'Get post activity',
    description:
      'Returns the 200 most recent activity entries for a post, newest first. Requires the post.view_private permission.',
    parameters: [postIdParam],
    responses: {
      200: {
        description: 'Activity log',
        content: { 'application/json': { schema: z.object({ data: z.array(ActivitySchema) }) } },
      },
      ...errorResponses(400, 403, 404),
    },
  },
})

registerPath('/posts/{postId}/merge', {
  post: {
    tags: ['Posts'],
    summary: 'Merge a duplicate post',
    description:
      'Merges this post (the duplicate) into a canonical post. Requires the post.merge permission.',
    parameters: [postIdParam],
    requestBody: {
      required: true,
      content: { 'application/json': { schema: asSchema(MergeBodySchema) } },
    },
    responses: {
      200: {
        description: 'Posts merged',
        content: {
          'application/json': {
            schema: createItemResponseSchema(MergeResultSchema, 'Merge result'),
          },
        },
      },
      ...errorResponses(400, 403, 404, 409),
    },
  },
})

registerPath('/suggestions', {
  get: {
    tags: ['Posts'],
    summary: 'List pending merge suggestions',
    description:
      'Returns pending post-to-post merge suggestions sorted by creation time or hybrid duplicate relevance score. Requires the suggestion.view permission.',
    parameters: [
      {
        name: 'sort',
        in: 'query',
        required: false,
        schema: { type: 'string', enum: ['newest', 'relevance'] },
        description: 'Sort order (default: newest)',
      },
      {
        name: 'limit',
        in: 'query',
        required: false,
        schema: { type: 'integer', minimum: 1, maximum: 100 },
        description: 'Maximum number of suggestions to return (1-100, default: 50)',
      },
      {
        name: 'postId',
        in: 'query',
        required: false,
        schema: { type: 'string' },
        description: 'Filter suggestions where the post is source or target (post_xxx)',
      },
    ],
    responses: {
      200: {
        description: 'Pending merge suggestions',
        content: {
          'application/json': {
            schema: createPaginatedResponseSchema(
              MergeSuggestionSchema,
              'List of pending merge suggestions'
            ),
          },
        },
      },
      ...errorResponses(400, 401, 403),
    },
  },
})

registerPath('/suggestions/{suggestionId}/accept', {
  post: {
    tags: ['Posts'],
    summary: 'Accept a merge suggestion',
    description:
      'Accepts a suggested post-to-post merge. The body is optional. Requires the suggestion.manage permission.',
    parameters: [suggestionIdParam],
    requestBody: {
      required: false,
      content: { 'application/json': { schema: asSchema(AcceptBodySchema) } },
    },
    responses: {
      ...suggestionResult('accepted', 'Suggestion accepted'),
      ...errorResponses(400, 403, 404, 409),
    },
  },
})

registerPath('/suggestions/{suggestionId}/dismiss', {
  post: {
    tags: ['Posts'],
    summary: 'Dismiss a merge suggestion',
    description: 'Requires the suggestion.manage permission.',
    parameters: [suggestionIdParam],
    responses: {
      ...suggestionResult('dismissed', 'Suggestion dismissed'),
      ...errorResponses(400, 403, 404, 409),
    },
  },
})

registerPath('/suggestions/{suggestionId}/restore', {
  post: {
    tags: ['Posts'],
    summary: 'Restore a dismissed merge suggestion',
    description:
      'Returns a dismissed suggestion to pending. Requires the suggestion.manage permission.',
    parameters: [suggestionIdParam],
    responses: {
      ...suggestionResult('restored', 'Suggestion restored'),
      ...errorResponses(400, 403, 404, 409),
    },
  },
})
