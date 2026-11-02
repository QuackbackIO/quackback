/**
 * Post activity, merge and merge-suggestion API Schema Registrations
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

const MoveBodySchema = createRequestBodySchema({
  boardId: TypeIdSchema.meta({
    description: 'The board to move the post to',
    example: 'board_01h455vb4pex5vsknk084sn02q',
  }),
})

const MoveResultSchema = z.object({
  id: TypeIdSchema.meta({ example: 'post_01h455vb4pex5vsknk084sn02q' }),
  boardId: TypeIdSchema.meta({ example: 'board_01h455vb4pex5vsknk084sn02q' }),
})

const AcceptBodySchema = createRequestBodySchema({
  swapDirection: z.boolean().optional().meta({
    description: 'Merge the suggestion target into the source instead of the reverse',
  }),
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

registerPath('/posts/{postId}/move', {
  post: {
    tags: ['Posts'],
    summary: 'Move a post to another board',
    description:
      'Moves a post to a different board, keeping its votes and comments, and records a board-changed activity entry. Requires the post.set_board permission.',
    parameters: [postIdParam],
    requestBody: {
      required: true,
      content: { 'application/json': { schema: asSchema(MoveBodySchema) } },
    },
    responses: {
      200: {
        description: 'Post moved',
        content: {
          'application/json': {
            schema: createItemResponseSchema(MoveResultSchema, 'Moved post'),
          },
        },
      },
      ...errorResponses(400, 401, 403, 404),
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
