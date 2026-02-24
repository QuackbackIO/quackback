import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  createdResponse,
  badRequestResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'

const identifyUserSchema = z.object({
  email: z.string().email('Valid email is required'),
  name: z.string().min(1).max(200).optional(),
  image: z.string().url().optional(),
  emailVerified: z.boolean().optional(),
  externalId: z.string().max(255).optional(),
  attributes: z.record(z.string(), z.unknown()).optional(),
})

export const Route = createFileRoute('/api/v1/users/identify')({
  server: {
    handlers: {
      /**
       * POST /api/v1/users/identify
       * Create or update a portal user by email.
       * User attributes must be configured in Settings before they can be set.
       */
      POST: async ({ request }) => {
        // Authenticate
        const authResult = await withApiKeyAuth(request, { role: 'team' })
        if (authResult instanceof Response) return authResult

        try {
          // Parse and validate body
          const body = await request.json()
          const parsed = identifyUserSchema.safeParse(body)

          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }

          // Import service function
          const { identifyPortalUser } = await import('@/lib/server/domains/users/user.service')

          const result = await identifyPortalUser(parsed.data)

          const data = {
            principalId: result.principalId,
            userId: result.userId,
            name: result.name,
            email: result.email,
            image: result.image,
            emailVerified: result.emailVerified,
            externalId: result.externalId,
            attributes: result.attributes,
            createdAt: result.createdAt.toISOString(),
            created: result.created,
          }

          return result.created ? createdResponse(data) : successResponse(data)
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
