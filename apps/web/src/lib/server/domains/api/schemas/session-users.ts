/**
 * Session-authenticated user helper schema registrations.
 */
import 'zod-openapi'
import { z } from 'zod'
import { asSchema, registerPath, TypeIdSchema } from '../openapi'
import { TimestampSchema } from './common'

registerPath('/users/{principalId}/card', {
  get: {
    tags: ['Users'],
    summary: 'Get a principal hover-card payload',
    security: [],
    parameters: [
      { name: 'principalId', in: 'path', required: true, schema: asSchema(TypeIdSchema) },
    ],
    responses: {
      200: {
        description: 'Principal card',
        content: {
          'application/json': {
            schema: asSchema(
              z.object({
                principalId: TypeIdSchema,
                displayName: z.string(),
                avatarUrl: z.string().nullable(),
                role: z.string(),
                joinedAt: TimestampSchema,
              })
            ),
          },
        },
      },
      403: { description: 'Session user required' },
      404: { description: 'Principal not found' },
    },
  },
})
