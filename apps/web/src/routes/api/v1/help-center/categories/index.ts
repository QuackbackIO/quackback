import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
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

const createCategoryBody = z.object({
  name: z.string().min(1, 'Name is required').max(200),
  slug: z.string().max(200).optional(),
  description: z.string().max(2000).optional(),
  isPublic: z.boolean().optional(),
  position: z.number().int().min(0).optional(),
  parentId: z.string().nullable().optional(),
  icon: z.string().max(50).nullable().optional(),
})

function formatCategory(cat: {
  id: string
  slug: string
  name: string
  description: string | null
  icon: string | null
  parentId: string | null
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
    icon: cat.icon,
    parentId: cat.parentId,
    isPublic: cat.isPublic,
    position: cat.position,
    createdAt: cat.createdAt.toISOString(),
    updatedAt: cat.updatedAt.toISOString(),
  }
}

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
              ...formatCategory(cat),
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
          const parsed = createCategoryBody.safeParse(body)

          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }

          const category = await createCategory(parsed.data)
          return createdResponse(formatCategory(category))
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
