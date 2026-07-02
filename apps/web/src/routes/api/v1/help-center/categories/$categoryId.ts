import { createFileRoute } from '@tanstack/react-router'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  noContentResponse,
  badRequestResponse,
  notFoundResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { parseTypeId } from '@/lib/server/domains/api/validation'
import { isFeatureEnabled } from '@/lib/server/domains/settings/settings.service'
import {
  getCategoryById,
  updateCategory,
  deleteCategory,
} from '@/lib/server/domains/help-center/help-center.service'
import { updateCategorySchema } from '@/lib/shared/schemas/help-center'
import { formatHelpCenterCategory } from './-serialize'
import type { HelpCenterCategoryId } from '@quackback/ids'

const updateCategoryBody = updateCategorySchema.omit({ id: true })

export const Route = createFileRoute('/api/v1/help-center/categories/$categoryId')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!(await isFeatureEnabled('helpCenter'))) return notFoundResponse('Knowledge base')

        try {
          await withApiKeyAuth(request, { role: 'team' })

          const categoryId = parseTypeId<HelpCenterCategoryId>(
            params.categoryId,
            'category',
            'category ID'
          )

          const category = await getCategoryById(categoryId)
          return successResponse(formatHelpCenterCategory(category))
        } catch (error) {
          return handleDomainError(error)
        }
      },

      PATCH: async ({ request, params }) => {
        if (!(await isFeatureEnabled('helpCenter'))) return notFoundResponse('Knowledge base')

        try {
          await withApiKeyAuth(request, { role: 'admin' })

          const categoryId = parseTypeId<HelpCenterCategoryId>(
            params.categoryId,
            'category',
            'category ID'
          )

          const body = await request.json()
          const parsed = updateCategoryBody.safeParse(body)

          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }

          const updated = await updateCategory(categoryId, parsed.data)
          return successResponse(formatHelpCenterCategory(updated))
        } catch (error) {
          return handleDomainError(error)
        }
      },

      DELETE: async ({ request, params }) => {
        if (!(await isFeatureEnabled('helpCenter'))) return notFoundResponse('Knowledge base')

        try {
          await withApiKeyAuth(request, { role: 'admin' })

          const categoryId = parseTypeId<HelpCenterCategoryId>(
            params.categoryId,
            'category',
            'category ID'
          )

          await deleteCategory(categoryId)
          return noContentResponse()
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
