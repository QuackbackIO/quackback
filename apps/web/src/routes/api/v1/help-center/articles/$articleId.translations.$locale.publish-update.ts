import { createFileRoute } from '@tanstack/react-router'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import { PERMISSIONS } from '@/lib/shared/permissions'
import {
  successResponse,
  notFoundResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { parseTypeId } from '@/lib/server/domains/api/validation'
import { isFeatureEnabled } from '@/lib/server/domains/settings/settings.service'
import {
  parseTranslationLocale,
  publishArticleTranslationUpdate,
} from '@/lib/server/domains/help-center/help-center-translation-api'
import type { KbArticleId } from '@quackback/ids'

/** Make the AI update waiting for review the translation's text, current with the article. */
export const Route = createFileRoute(
  '/api/v1/help-center/articles/$articleId/translations/$locale/publish-update'
)({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        if (!(await isFeatureEnabled('helpCenter'))) return notFoundResponse('Knowledge base')
        try {
          await withApiKeyAuth(request, { permission: PERMISSIONS.HELP_CENTER_MANAGE })
          const articleId = parseTypeId<KbArticleId>(params.articleId, 'article', 'article ID')
          const locale = parseTranslationLocale(params.locale)
          return successResponse(await publishArticleTranslationUpdate(articleId, locale))
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
