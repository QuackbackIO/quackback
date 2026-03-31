import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  noContentResponse,
  badRequestResponse,
  notFoundResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { validateTypeId } from '@/lib/server/domains/api/validation'
import { isFeatureEnabled } from '@/lib/server/domains/settings/settings.service'
import {
  getCategoryById,
  updateCategory,
  deleteCategory,
} from '@/lib/server/domains/help-center/help-center.service'
import type { HelpCenterCategoryId } from '@quackback/ids'

const updateCategoryBody = z.object({
  name: z.string().min(1).max(200).optional(),
  slug: z.string().max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  isPublic: z.boolean().optional(),
  position: z.number().int().min(0).optional(),
})

function formatCategory(cat: {
  id: string
  slug: string
  name: string
  description: string | null
  isPublic: boolean
  position: number
  createdAt: Date
  updatedAt: Date
}) {
  return {
    id: cat.id,
    slug: cat.slug,
    name: cat.name,
    description: cat.description,
    isPublic: cat.isPublic,
    position: cat.position,
    createdAt: cat.createdAt.toISOString(),
    updatedAt: cat.updatedAt.toISOString(),
  }
}

export const Route = createFileRoute('/api/v1/kb/categories/$categoryId')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!(await isFeatureEnabled('helpCenter'))) return notFoundResponse('Knowledge base')
        const authResult = await withApiKeyAuth(request, { role: 'team' })
        if (authResult instanceof Response) return authResult

        try {
          const { categoryId } = params
          const validationError = validateTypeId(categoryId, 'helpcenter_category', 'category ID')
          if (validationError) return validationError

          const category = await getCategoryById(categoryId as HelpCenterCategoryId)
          return successResponse(formatCategory(category))
        } catch (error) {
          return handleDomainError(error)
        }
      },

      PATCH: async ({ request, params }) => {
        if (!(await isFeatureEnabled('helpCenter'))) return notFoundResponse('Knowledge base')
        const authResult = await withApiKeyAuth(request, { role: 'admin' })
        if (authResult instanceof Response) return authResult

        try {
          const { categoryId } = params
          const validationError = validateTypeId(categoryId, 'helpcenter_category', 'category ID')
          if (validationError) return validationError

          const body = await request.json()
          const parsed = updateCategoryBody.safeParse(body)

          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }

          const updated = await updateCategory(categoryId as HelpCenterCategoryId, parsed.data)
          return successResponse(formatCategory(updated))
        } catch (error) {
          return handleDomainError(error)
        }
      },

      DELETE: async ({ request, params }) => {
        if (!(await isFeatureEnabled('helpCenter'))) return notFoundResponse('Knowledge base')
        const authResult = await withApiKeyAuth(request, { role: 'admin' })
        if (authResult instanceof Response) return authResult

        try {
          const { categoryId } = params
          const validationError = validateTypeId(categoryId, 'helpcenter_category', 'category ID')
          if (validationError) return validationError

          await deleteCategory(categoryId as HelpCenterCategoryId)
          return noContentResponse()
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
