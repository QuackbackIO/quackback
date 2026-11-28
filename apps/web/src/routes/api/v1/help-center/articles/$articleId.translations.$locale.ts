import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import { PERMISSIONS } from '@/lib/shared/permissions'
import {
  successResponse,
  noContentResponse,
  badRequestResponse,
  notFoundResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { parseTypeId } from '@/lib/server/domains/api/validation'
import { isFeatureEnabled } from '@/lib/server/domains/settings/settings.service'
import { readJsonBody } from '@/lib/server/domains/api/request'
import {
  parseTranslationLocale,
  removeArticleTranslation,
  writeArticleTranslation,
} from '@/lib/server/domains/help-center/help-center-translation-api'
import type { KbArticleId } from '@quackback/ids'

const putBody = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(300).nullable().optional(),
  content: z.string().min(1),
  status: z.enum(['draft', 'published']).optional(),
})

/** One language of an article: write it from Markdown, or delete it. */
export const Route = createFileRoute(
  '/api/v1/help-center/articles/$articleId/translations/$locale'
)({
  server: {
    handlers: {
      PUT: async ({ request, params }) => {
        if (!(await isFeatureEnabled('helpCenter'))) return notFoundResponse('Knowledge base')
        try {
          await withApiKeyAuth(request, { permission: PERMISSIONS.HELP_CENTER_MANAGE })
          const articleId = parseTypeId<KbArticleId>(params.articleId, 'article', 'article ID')
          const locale = parseTranslationLocale(params.locale)
          const parsed = putBody.safeParse(await readJsonBody(request))
          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }
          return successResponse(await writeArticleTranslation(articleId, locale, parsed.data))
        } catch (error) {
          return handleDomainError(error)
        }
      },

      DELETE: async ({ request, params }) => {
        if (!(await isFeatureEnabled('helpCenter'))) return notFoundResponse('Knowledge base')
        try {
          await withApiKeyAuth(request, { permission: PERMISSIONS.HELP_CENTER_MANAGE })
          const articleId = parseTypeId<KbArticleId>(params.articleId, 'article', 'article ID')
          await removeArticleTranslation(articleId, parseTranslationLocale(params.locale))
          return noContentResponse()
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
