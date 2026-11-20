import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import { badRequestResponse, handleDomainError } from '@/lib/server/domains/api/responses'
import { parseTypeId } from '@/lib/server/domains/api/validation'
import { PERMISSIONS } from '@/lib/shared/permissions'
import type { PostId } from '@quackback/ids'
import { appJsonResponse, preflightResponse, withCors } from '@/lib/server/integrations/apps/cors'
import { readJsonBody } from '@/lib/server/domains/api/request'

const unlinkSchema = z.object({
  postId: z.string().min(1),
  integrationType: z.string().min(1),
  externalId: z.string().min(1),
})

export const Route = createFileRoute('/api/v1/apps/unlink')({
  server: {
    handlers: {
      OPTIONS: () => preflightResponse(),

      POST: async ({ request }) => {
        try {
          await withApiKeyAuth(request, { permission: PERMISSIONS.POST_VOTE_ON_BEHALF })

          const body = await readJsonBody(request)
          const parsed = unlinkSchema.safeParse(body)

          if (!parsed.success) {
            return withCors(
              badRequestResponse('Invalid request body', {
                errors: parsed.error.flatten().fieldErrors,
              })
            )
          }

          const postId = parseTypeId<PostId>(parsed.data.postId, 'post', 'post ID')

          const { unlinkTicketFromPost } = await import('@/lib/server/integrations/apps/service')

          await unlinkTicketFromPost({
            postId,
            integrationType: parsed.data.integrationType,
            externalId: parsed.data.externalId,
          })

          return appJsonResponse({ success: true })
        } catch (error) {
          return withCors(handleDomainError(error))
        }
      },
    },
  },
})
