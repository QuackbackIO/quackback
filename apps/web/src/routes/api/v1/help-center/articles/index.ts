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
import { parseOptionalTypeId } from '@/lib/server/domains/api/validation'
import { isFeatureEnabled } from '@/lib/server/domains/settings/settings.service'
import { listArticles, createArticle } from '@/lib/server/domains/help-center/help-center.service'
import { formatArticle } from './-serialize'
import type { PrincipalId } from '@quackback/ids'

const createArticleBody = z.object({
  categoryId: z.string().min(1, 'Category ID is required'),
  title: z.string().min(1, 'Title is required').max(200),
  content: z.string().min(1, 'Content is required'),
  slug: z.string().max(200).optional(),
  description: z.string().max(300).optional(),
  authorId: z.string().optional(),
})

export const Route = createFileRoute('/api/v1/help-center/articles/')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!(await isFeatureEnabled('helpCenter'))) return notFoundResponse('Knowledge base')

        try {
          await withApiKeyAuth(request, { role: 'team' })

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

        try {
          const { principalId } = await withApiKeyAuth(request, { role: 'team' })

          const body = await request.json()
          const parsed = createArticleBody.safeParse(body)

          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }

          const { authorId, ...articleData } = parsed.data

          const authorPrincipalId = parseOptionalTypeId<PrincipalId>(
            authorId,
            'principal',
            'author ID'
          )

          const article = await createArticle(
            articleData,
            principalId as PrincipalId,
            authorPrincipalId
          )
          return createdResponse(formatArticle(article))
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
