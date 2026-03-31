import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  badRequestResponse,
  notFoundResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { validateTypeId } from '@/lib/server/domains/api/validation'
import { isFeatureEnabled } from '@/lib/server/domains/settings/settings.service'
import { recordArticleFeedback } from '@/lib/server/domains/help-center/help-center.service'
import type { HelpCenterArticleId, PrincipalId } from '@quackback/ids'

const feedbackBody = z.object({
  helpful: z.boolean(),
})

export const Route = createFileRoute('/api/v1/kb/articles/$articleId/feedback')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        if (!(await isFeatureEnabled('helpCenter'))) return notFoundResponse('Knowledge base')
        const authResult = await withApiKeyAuth(request, { role: 'team' })
        if (authResult instanceof Response) return authResult

        try {
          const { articleId } = params
          const validationError = validateTypeId(articleId, 'helpcenter_article', 'article ID')
          if (validationError) return validationError

          const body = await request.json()
          const parsed = feedbackBody.safeParse(body)

          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }

          await recordArticleFeedback(
            articleId as HelpCenterArticleId,
            parsed.data.helpful,
            authResult.principalId as PrincipalId
          )

          return successResponse({ success: true })
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
