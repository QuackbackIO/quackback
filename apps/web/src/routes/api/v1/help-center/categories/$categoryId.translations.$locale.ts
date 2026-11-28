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
  removeCategoryTranslation,
  writeCategoryTranslation,
} from '@/lib/server/domains/help-center/help-center-translation-api'
import type { KbCategoryId } from '@quackback/ids'

const putBody = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
})

/** A collection's name and description in one language: write or delete. */
export const Route = createFileRoute(
  '/api/v1/help-center/categories/$categoryId/translations/$locale'
)({
  server: {
    handlers: {
      PUT: async ({ request, params }) => {
        if (!(await isFeatureEnabled('helpCenter'))) return notFoundResponse('Knowledge base')
        try {
          await withApiKeyAuth(request, { permission: PERMISSIONS.HELP_CENTER_MANAGE })
          const categoryId = parseTypeId<KbCategoryId>(
            params.categoryId,
            'kb_category',
            'category ID'
          )
          const locale = parseTranslationLocale(params.locale)
          const parsed = putBody.safeParse(await readJsonBody(request))
          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }
          return successResponse(await writeCategoryTranslation(categoryId, locale, parsed.data))
        } catch (error) {
          return handleDomainError(error)
        }
      },

      DELETE: async ({ request, params }) => {
        if (!(await isFeatureEnabled('helpCenter'))) return notFoundResponse('Knowledge base')
        try {
          await withApiKeyAuth(request, { permission: PERMISSIONS.HELP_CENTER_MANAGE })
          const categoryId = parseTypeId<KbCategoryId>(
            params.categoryId,
            'kb_category',
            'category ID'
          )
          await removeCategoryTranslation(categoryId, parseTranslationLocale(params.locale))
          return noContentResponse()
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
