import { createFileRoute } from '@tanstack/react-router'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  createdResponse,
  badRequestResponse,
  notFoundResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { isFeatureEnabled } from '@/lib/server/domains/settings/settings.service'
import {
  listCategories,
  createCategory,
} from '@/lib/server/domains/help-center/help-center.service'
import { createCategorySchema } from '@/lib/shared/schemas/help-center'
import { formatHelpCenterCategory } from './-serialize'

export const Route = createFileRoute('/api/v1/help-center/categories/')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!(await isFeatureEnabled('helpCenter'))) return notFoundResponse('Knowledge base')

        try {
          await withApiKeyAuth(request, { role: 'team' })

          const categories = await listCategories()
          return successResponse(
            categories.map((cat) => ({
              ...formatHelpCenterCategory(cat),
              articleCount: cat.articleCount,
            }))
          )
        } catch (error) {
          return handleDomainError(error)
        }
      },

      POST: async ({ request }) => {
        if (!(await isFeatureEnabled('helpCenter'))) return notFoundResponse('Knowledge base')

        try {
          await withApiKeyAuth(request, { role: 'admin' })

          const body = await request.json()
          const parsed = createCategorySchema.safeParse(body)

          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }

          const category = await createCategory(parsed.data)
          return createdResponse(formatHelpCenterCategory(category))
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
