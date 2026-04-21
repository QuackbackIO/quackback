import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import { badRequestResponse, handleDomainError } from '@/lib/server/domains/api/responses'
import { parseTypeId } from '@/lib/server/domains/api/validation'
import type { PostId } from '@quackback/ids'
import { appJsonResponse, preflightResponse } from '@/lib/server/integrations/apps/cors'

const linkSchema = z.object({
  postId: z.string().min(1),
  integrationType: z.string().min(1),
  externalId: z.string().min(1),
  externalUrl: z.string().optional(),
  requester: z
    .object({
      email: z.string().email(),
      name: z.string().optional(),
    })
    .optional(),
})

export const Route = createFileRoute('/api/v1/apps/link')({
  server: {
    handlers: {
      OPTIONS: () => preflightResponse(),

      POST: async ({ request }) => {
        try {
          const { principalId } = await withApiKeyAuth(request, { role: 'team' })

          const body = await request.json()
          const parsed = linkSchema.safeParse(body)

          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }

          const postId = parseTypeId<PostId>(parsed.data.postId, 'post', 'post ID')

          const { linkTicketToPost } = await import('@/lib/server/integrations/apps/service')

          const result = await linkTicketToPost(
            {
              postId,
              integrationType: parsed.data.integrationType,
              externalId: parsed.data.externalId,
              externalUrl: parsed.data.externalUrl,
              requester: parsed.data.requester,
            },
            principalId
          )

          return appJsonResponse(result, 201)
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
