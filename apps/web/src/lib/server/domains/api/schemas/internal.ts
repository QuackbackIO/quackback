/**
 * Session-authenticated internal API schema registrations.
 */
import 'zod-openapi'
import { z } from 'zod'
import { asSchema, registerPath } from '../openapi'

const PortalTabConfigSchema = z.object({
  feedback: z.boolean().optional(),
  roadmap: z.boolean().optional(),
  changelog: z.boolean().optional(),
  myTickets: z.boolean().optional(),
  helpCenter: z.boolean().optional(),
  support: z.boolean().optional(),
})

registerPath('/internal/portal-tabs', {
  get: {
    tags: ['Internal'],
    summary: 'Get the effective portal tab config for the current user',
    security: [],
    responses: {
      200: {
        description: 'Effective portal tab config',
        content: {
          'application/json': {
            schema: asSchema(z.object({ config: PortalTabConfigSchema })),
          },
        },
      },
      401: { description: 'Session required' },
    },
  },
  post: {
    tags: ['Internal'],
    summary: 'Update organization portal tab config',
    security: [],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: asSchema(z.object({ config: PortalTabConfigSchema.optional() })),
        },
      },
    },
    responses: {
      200: { description: 'Portal tab config updated' },
      400: { description: 'Invalid configuration' },
      401: { description: 'Session required' },
      403: { description: 'Admin only' },
    },
  },
})
