import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import {
  helpCenterApiAccess,
  assertArticleOpenToKey,
} from '@/lib/server/domains/help-center/help-center-api-access'
import {
  successResponse,
  badRequestResponse,
  notFoundResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { parseTypeId } from '@/lib/server/domains/api/validation'
import { isFeatureEnabled } from '@/lib/server/domains/settings/settings.service'
import { recordArticleFeedback } from '@/lib/server/domains/help-center/help-center.service'
import type { KbArticleId, PrincipalId } from '@quackback/ids'
import { readJsonBody } from '@/lib/server/domains/api/request'

const feedbackBody = z.object({
  helpful: z.boolean(),
})

export const Route = createFileRoute('/api/v1/help-center/articles/$articleId/feedback')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        if (!(await isFeatureEnabled('helpCenter'))) return notFoundResponse('Knowledge base')

        try {
          const access = helpCenterApiAccess(await withApiKeyAuth(request))

          const articleId = parseTypeId<KbArticleId>(params.articleId, 'article', 'article ID')
          // A key votes only on an article it may read: a draft, or an article
          // in a private or gated category, needs help_center.manage.
          await assertArticleOpenToKey(access, articleId)

          const body = await readJsonBody(request)
          const parsed = feedbackBody.safeParse(body)

          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }

          await recordArticleFeedback(
            articleId,
            parsed.data.helpful,
            access.auth.principalId as PrincipalId
          )

          return successResponse({ success: true })
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
