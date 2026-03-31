import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  createdResponse,
  badRequestResponse,
  notFoundResponse,
  handleDomainError,
  parsePaginationParams,
} from '@/lib/server/domains/api/responses'
import { isFeatureEnabled } from '@/lib/server/domains/settings/settings.service'
import { listArticles, createArticle } from '@/lib/server/domains/help-center/help-center.service'
import type { PrincipalId } from '@quackback/ids'

const createArticleBody = z.object({
  categoryId: z.string().min(1, 'Category ID is required'),
  title: z.string().min(1, 'Title is required').max(200),
  content: z.string().min(1, 'Content is required'),
  slug: z.string().max(200).optional(),
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

export const Route = createFileRoute('/api/v1/kb/articles/')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!(await isFeatureEnabled('helpCenter'))) return notFoundResponse('Knowledge base')
        const authResult = await withApiKeyAuth(request, { role: 'team' })
        if (authResult instanceof Response) return authResult

        try {
          const url = new URL(request.url)
          const { cursor, limit } = parsePaginationParams(url)
          const categoryId = url.searchParams.get('categoryId') ?? undefined
          const status = (url.searchParams.get('status') as 'draft' | 'published' | 'all') ?? 'all'
          const search = url.searchParams.get('search') ?? undefined

          const result = await listArticles({ categoryId, status, search, cursor, limit })

          return successResponse(result.items.map(formatArticle), {
            pagination: {
              cursor: result.nextCursor,
              hasMore: result.hasMore,
            },
          })
        } catch (error) {
          return handleDomainError(error)
        }
      },

      POST: async ({ request }) => {
        if (!(await isFeatureEnabled('helpCenter'))) return notFoundResponse('Knowledge base')
        const authResult = await withApiKeyAuth(request, { role: 'admin' })
        if (authResult instanceof Response) return authResult

        try {
          const body = await request.json()
          const parsed = createArticleBody.safeParse(body)

          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }

          const article = await createArticle(parsed.data, authResult.principalId as PrincipalId)
          return createdResponse(formatArticle(article))
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
