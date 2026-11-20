import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { apiKeyHolds, withApiKeyAuth } from '@/lib/server/domains/api/auth'
import { PERMISSIONS } from '@/lib/shared/permissions'
import {
  successResponse,
  createdResponse,
  badRequestResponse,
  notFoundResponse,
  handleDomainError,
  parsePaginationParams,
} from '@/lib/server/domains/api/responses'
import { parseOptionalTypeId, parseTypeId } from '@/lib/server/domains/api/validation'
import { isFeatureEnabled } from '@/lib/server/domains/settings/settings.service'
import {
  listArticles,
  listPublicArticles,
  createArticle,
} from '@/lib/server/domains/help-center/help-center.service'
import { contentJsonToMarkdown } from '@/lib/server/markdown-tiptap'
import type { TiptapContent } from '@/lib/server/db'
import type { KbCategoryId, PrincipalId } from '@quackback/ids'
import { parseCursor, readJsonBody } from '@/lib/server/domains/api/request'

const createArticleBody = z.object({
  categoryId: z.string().min(1, 'Category ID is required'),
  title: z.string().min(1, 'Title is required').max(200),
  content: z.string().min(1, 'Content is required'),
  slug: z.string().max(200).optional(),
  description: z.string().max(300).optional(),
  authorId: z.string().optional(),
})

function formatArticle(article: {
  id: string
  slug: string
  title: string
  description: string | null
  content: string
  contentJson: TiptapContent | null
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
    description: article.description,
    // Render markdown from the canonical contentJson so images survive; falls
    // back to the stored column for legacy rows (and the list query, which
    // omits contentJson for performance).
    content: contentJsonToMarkdown(article.contentJson, article.content),
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

export const Route = createFileRoute('/api/v1/help-center/articles/')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!(await isFeatureEnabled('helpCenter'))) return notFoundResponse('Knowledge base')

        try {
          const auth = await withApiKeyAuth(request)

          const url = new URL(request.url)
          const { limit } = parsePaginationParams(url)
          const cursor = parseCursor(url)
          const categoryId = parseOptionalTypeId<KbCategoryId>(
            url.searchParams.get('categoryId'),
            'kb_category',
            'categoryId'
          )
          const status = (url.searchParams.get('status') as 'draft' | 'published' | 'all') ?? 'all'
          const search = url.searchParams.get('search') ?? undefined

          // Drafts, private categories and gated articles are team material:
          // a key without help_center.manage reads the published public slice.
          const result = apiKeyHolds(auth, PERMISSIONS.HELP_CENTER_MANAGE)
            ? await listArticles({ categoryId, status, search, cursor, limit })
            : await listPublicArticles({ categoryId, search, cursor, limit })

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
          const { principalId } = await withApiKeyAuth(request, {
            permission: PERMISSIONS.HELP_CENTER_MANAGE,
          })

          const body = await readJsonBody(request)
          const parsed = createArticleBody.safeParse(body)

          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }

          const { authorId, ...articleData } = parsed.data
          const categoryId = parseTypeId<KbCategoryId>(
            articleData.categoryId,
            'kb_category',
            'category ID'
          )

          const authorPrincipalId = parseOptionalTypeId<PrincipalId>(
            authorId,
            'principal',
            'author ID'
          )

          const article = await createArticle(
            { ...articleData, categoryId },
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
