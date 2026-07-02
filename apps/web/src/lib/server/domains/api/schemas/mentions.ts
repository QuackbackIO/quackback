/**
 * Session-authenticated mention helper schema registrations.
 */
import 'zod-openapi'
import { z } from 'zod'
import { asSchema, registerPath, TypeIdSchema } from '../openapi'

const MentionSuggestionSchema = z.object({
  principalId: TypeIdSchema,
  displayName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  role: z.string(),
})

registerPath('/mentions/suggest', {
  get: {
    tags: ['Mentions'],
    summary: 'Suggest principals for @-mention typeahead',
    security: [],
    parameters: [
      { name: 'q', in: 'query', schema: asSchema(z.string().optional()) },
      { name: 'scope', in: 'query', schema: asSchema(z.enum(['team']).optional()) },
    ],
    responses: {
      200: {
        description: 'Mention suggestions',
        content: {
          'application/json': { schema: asSchema(z.array(MentionSuggestionSchema)) },
        },
      },
      403: { description: 'Session user required' },
      429: { description: 'Rate limit exceeded' },
    },
  },
})
