/**
 * Post action schema registrations: merge and activity endpoints.
 */
import 'zod-openapi'
import { z } from 'zod'
import { asSchema, createItemResponseSchema, registerPath, TypeIdSchema } from '../openapi'
import { TimestampSchema, ValidationErrorSchema } from './common'

const PostActivitySchema = z.object({
  id: TypeIdSchema,
  postId: TypeIdSchema,
  principalId: TypeIdSchema.nullable(),
  actorName: z.string().nullable(),
  type: z.string(),
  metadata: z.unknown(),
  createdAt: TimestampSchema,
})

registerPath('/posts/{postId}/activity', {
  get: {
    tags: ['Posts'],
    summary: 'List post activity',
    parameters: [{ name: 'postId', in: 'path', required: true, schema: asSchema(TypeIdSchema) }],
    responses: {
      200: {
        description: 'Activity rows',
        content: {
          'application/json': {
            schema: asSchema(z.object({ data: z.array(PostActivitySchema) })),
          },
        },
      },
    },
  },
})

registerPath('/posts/{postId}/merge', {
  post: {
    tags: ['Posts'],
    summary: 'Merge a duplicate post into a canonical post',
    parameters: [{ name: 'postId', in: 'path', required: true, schema: asSchema(TypeIdSchema) }],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: asSchema(z.object({ canonicalPostId: TypeIdSchema })),
        },
      },
    },
    responses: {
      200: {
        description: 'Merge result',
        content: {
          'application/json': {
            schema: createItemResponseSchema(
              z.object({
                canonicalPost: z.object({ id: TypeIdSchema, voteCount: z.number() }),
                duplicatePost: z.object({ id: TypeIdSchema }),
              }),
              'Merge result'
            ),
          },
        },
      },
      400: {
        description: 'Validation error',
        content: { 'application/json': { schema: ValidationErrorSchema } },
      },
    },
  },
})
