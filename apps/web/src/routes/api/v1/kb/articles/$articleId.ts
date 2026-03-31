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
  getArticleById,
  updateArticle,
  publishArticle,
  unpublishArticle,
  deleteArticle,
} from '@/lib/server/domains/help-center/help-center.service'
import type { HelpCenterArticleId } from '@quackback/ids'

const updateArticleBody = z.object({
  categoryId: z.string().optional(),
  title: z.string().min(1).max(200).optional(),
  content: z.string().min(1).optional(),
  slug: z.string().max(200).optional(),
  publishedAt: z.string().datetime().nullable().optional(),
})

function formatArticle(article: {
  id: string
  slug: string
  title: string
  content: string
  publishedAt: Date | null
  viewCount: number
  helpfulCount: number
  notHelpfulCount: number
  createdAt: Date
  updatedAt: Date
  category: { id: string; slug: string; name: string }
  author: { id: string; name: string; avatarUrl: string | null } | null
}) {
  return {
    id: article.id,
    slug: article.slug,
    title: article.title,
    content: article.content,
    publishedAt: article.publishedAt?.toISOString() || null,
    viewCount: article.viewCount,
    helpfulCount: article.helpfulCount,
    notHelpfulCount: article.notHelpfulCount,
    createdAt: article.createdAt.toISOString(),
    updatedAt: article.updatedAt.toISOString(),
    category: article.category,
    author: article.author,
  }
}

export const Route = createFileRoute('/api/v1/kb/articles/$articleId')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!(await isFeatureEnabled('helpCenter'))) return notFoundResponse('Knowledge base')
        const authResult = await withApiKeyAuth(request, { role: 'team' })
        if (authResult instanceof Response) return authResult

        try {
          const { articleId } = params
          const validationError = validateTypeId(articleId, 'helpcenter_article', 'article ID')
          if (validationError) return validationError

          const article = await getArticleById(articleId as HelpCenterArticleId)
          return successResponse(formatArticle(article))
        } catch (error) {
          return handleDomainError(error)
        }
      },

      PATCH: async ({ request, params }) => {
        if (!(await isFeatureEnabled('helpCenter'))) return notFoundResponse('Knowledge base')
        const authResult = await withApiKeyAuth(request, { role: 'admin' })
        if (authResult instanceof Response) return authResult

        try {
          const { articleId } = params
          const validationError = validateTypeId(articleId, 'helpcenter_article', 'article ID')
          if (validationError) return validationError

          const body = await request.json()
          const parsed = updateArticleBody.safeParse(body)

          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }

          // Handle publish/unpublish via publishedAt
          if (parsed.data.publishedAt !== undefined) {
            if (parsed.data.publishedAt === null) {
              await unpublishArticle(articleId as HelpCenterArticleId)
            } else {
              await publishArticle(articleId as HelpCenterArticleId)
            }
          }

          const { publishedAt: _, ...updateData } = parsed.data
          const hasUpdates = Object.values(updateData).some((v) => v !== undefined)

          if (hasUpdates) {
            const updated = await updateArticle(articleId as HelpCenterArticleId, updateData)
            return successResponse(formatArticle(updated))
          }

          const article = await getArticleById(articleId as HelpCenterArticleId)
          return successResponse(formatArticle(article))
        } catch (error) {
          return handleDomainError(error)
        }
      },

      DELETE: async ({ request, params }) => {
        if (!(await isFeatureEnabled('helpCenter'))) return notFoundResponse('Knowledge base')
        const authResult = await withApiKeyAuth(request, { role: 'admin' })
        if (authResult instanceof Response) return authResult

        try {
          const { articleId } = params
          const validationError = validateTypeId(articleId, 'helpcenter_article', 'article ID')
          if (validationError) return validationError

          await deleteArticle(articleId as HelpCenterArticleId)
          return noContentResponse()
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
