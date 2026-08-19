import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  createdResponse,
  badRequestResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { PERMISSIONS } from '@/lib/shared/permissions'

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
        try {
          const auth = await withApiKeyAuth(request, { permission: PERMISSIONS.PEOPLE_MANAGE })

          // Parse and validate body
          const body = await request.json()
          const parsed = identifyUserSchema.safeParse(body)

          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }

          // Import service function
          const { identifyPortalUser } = await import('@/lib/server/domains/users/user.identify')

          const result = await identifyPortalUser(parsed.data)

          // Asserting a verified email over the API is a trust decision — it
          // grants the same portal access as a confirmed address. Audit who
          // (which key) vouched for it, both on create-verified and on an
          // existing user flipped false -> true.
          if (result.emailVerifiedAsserted) {
            const { recordAuditEvent } = await import('@/lib/server/audit/log')
            await recordAuditEvent({
              event: 'user.email_verified.asserted',
              actor: {
                userId: auth.principal?.userId ?? null,
                email: auth.principal?.user?.email ?? null,
                role: auth.role,
                type: 'api_key',
                authMethod: 'api_key',
              },
              headers: request.headers,
              target: { type: 'user', id: result.userId },
              before: result.created ? null : { emailVerified: false },
              after: { emailVerified: true },
              metadata: {
                source: 'api.users.identify',
                apiKeyId: auth.apiKey.id,
                created: result.created,
              },
            })
          }

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
