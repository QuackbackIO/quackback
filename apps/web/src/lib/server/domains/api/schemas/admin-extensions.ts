/**
 * Additional admin and CRM schema registrations.
 */
import 'zod-openapi'
import { z } from 'zod'
import { asSchema, registerPath, TypeIdSchema } from '../openapi'

registerPath('/contacts/{contactId}/links', {
  get: {
    tags: ['Contacts'],
    summary: 'List portal-user links for a contact',
    parameters: [{ name: 'contactId', in: 'path', required: true, schema: asSchema(TypeIdSchema) }],
    responses: { 200: { description: 'Contact links' } },
  },
})

registerPath('/admin/usage', {
  get: {
    tags: ['Admin'],
    summary: 'Get workspace usage counters',
    description:
      'Trusted endpoint authenticated by ADMIN_API_TOKEN for external billing meters and usage tooling.',
    security: [],
    responses: {
      200: {
        description: 'Usage counters',
        content: {
          'application/json': {
            schema: asSchema(
              z.object({
                aiTokensThisMonth: z.number(),
                postCount: z.number(),
                boardCount: z.number(),
                teamSeatCount: z.number(),
              })
            ),
          },
        },
      },
      404: { description: 'ADMIN_API_TOKEN is not configured' },
    },
  },
})
