import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import {
  helpCenterApiAccess,
  assertArticleOpenToKey,
} from '@/lib/server/domains/help-center/help-center-api-access'

import { PERMISSIONS } from '@/lib/shared/permissions'
import {
  successResponse,
  noContentResponse,
  badRequestResponse,
  notFoundResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { parseTypeId, parseOptionalTypeId } from '@/lib/server/domains/api/validation'
import { isFeatureEnabled } from '@/lib/server/domains/settings/settings.service'
import {
  getArticleById,
  updateArticle,
  publishArticle,
  unpublishArticle,
  deleteArticle,
} from '@/lib/server/domains/help-center/help-center.service'
import { contentJsonToMarkdown } from '@/lib/server/markdown-tiptap'
import type { TiptapContent } from '@/lib/server/db'
import type { KbArticleId, KbCategoryId, PrincipalId } from '@quackback/ids'
import { readJsonBody } from '@/lib/server/domains/api/request'

const updateArticleBody = z.object({
  categoryId: z.string().optional(),
  title: z.string().trim().min(1).max(200).optional(),
  content: z.string().min(1).optional(),
  slug: z.string().max(200).optional(),
  description: z.string().max(300).optional(),
  publishedAt: z.string().datetime().nullable().optional(),
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
    // back to the stored column for legacy rows.
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

export const Route = createFileRoute('/api/v1/help-center/articles/$articleId')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!(await isFeatureEnabled('helpCenter'))) return notFoundResponse('Knowledge base')

        try {
          const access = helpCenterApiAccess(await withApiKeyAuth(request))

          const articleId = parseTypeId<KbArticleId>(params.articleId, 'article', 'article ID')

          // A draft, or an article in a private or gated category, needs
          // help_center.manage.
          await assertArticleOpenToKey(access, articleId)
          const article = await getArticleById(articleId)
          return successResponse(formatArticle(article))
        } catch (error) {
          return handleDomainError(error)
        }
      },

      PATCH: async ({ request, params }) => {
        if (!(await isFeatureEnabled('helpCenter'))) return notFoundResponse('Knowledge base')

        try {
          await withApiKeyAuth(request, { permission: PERMISSIONS.HELP_CENTER_MANAGE })

          const articleId = parseTypeId<KbArticleId>(params.articleId, 'article', 'article ID')

          const body = await readJsonBody(request)
          const parsed = updateArticleBody.safeParse(body)

          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }

          const authorPrincipalId = parseOptionalTypeId<PrincipalId>(
            parsed.data.authorId,
            'principal',
            'author ID'
          )

          const { publishedAt: _, authorId: __, ...fields } = parsed.data
          const updateData = {
            ...fields,
            categoryId: parseOptionalTypeId<KbCategoryId>(
              fields.categoryId,
              'kb_category',
              'category ID'
            ),
          }
          // authorPrincipalId is included because reassigning the author requires
          // the same updateArticle call even when no other fields change.
          const hasUpdates =
            Object.values(updateData).some((v) => v !== undefined) ||
            authorPrincipalId !== undefined

          // Validate + apply field/author updates first so a bad authorId
          // never leaves the article in a partially-published state.
          let currentArticle = null
          if (hasUpdates) {
            currentArticle = await updateArticle(articleId, updateData, authorPrincipalId)
          }

          // Only change publish state after all validation passes
          if (parsed.data.publishedAt !== undefined) {
            if (parsed.data.publishedAt === null) {
              currentArticle = await unpublishArticle(articleId)
            } else {
              currentArticle = await publishArticle(articleId)
            }
          }

          if (currentArticle) return successResponse(formatArticle(currentArticle))
          const article = await getArticleById(articleId)
          return successResponse(formatArticle(article))
        } catch (error) {
          return handleDomainError(error)
        }
      },

      DELETE: async ({ request, params }) => {
        if (!(await isFeatureEnabled('helpCenter'))) return notFoundResponse('Knowledge base')

        try {
          // Soft delete (deleteArticle sets deletedAt).
          await withApiKeyAuth(request, { permission: PERMISSIONS.HELP_CENTER_MANAGE })

          const articleId = parseTypeId<KbArticleId>(params.articleId, 'article', 'article ID')

          await deleteArticle(articleId)
          return noContentResponse()
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
