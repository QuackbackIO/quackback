/**
 * Help Center Service - Core CRUD operations
 *
 * Handles categories and articles for the help center.
 */

import {
  db,
  helpCenterCategories,
  helpCenterArticles,
  helpCenterArticleFeedback,
  principal,
  eq,
  and,
  isNull,
  isNotNull,
  lte,
  lt,
  or,
  desc,
  asc,
  sql,
  inArray,
} from '@/lib/server/db'
import type { HelpCenterCategoryId, HelpCenterArticleId, PrincipalId } from '@quackback/ids'
import { NotFoundError, ValidationError } from '@/lib/shared/errors'
import { markdownToTiptapJson } from '@/lib/server/markdown-tiptap'
import { rehostExternalImages } from '@/lib/server/content/rehost-images'
import { slugify } from '@/lib/shared/utils'
import type {
  HelpCenterCategory,
  HelpCenterCategoryWithCount,
  HelpCenterArticleWithCategory,
  CreateCategoryInput,
  UpdateCategoryInput,
  CreateArticleInput,
  UpdateArticleInput,
  ListArticlesParams,
  ArticleListResult,
} from './help-center.types'
import { generateArticleEmbedding } from './help-center-embedding.service'

// ============================================================================
// Categories
// ============================================================================

export async function listCategories(): Promise<HelpCenterCategoryWithCount[]> {
  const now = new Date()

  const [categories, counts] = await Promise.all([
    db.query.helpCenterCategories.findMany({
      where: isNull(helpCenterCategories.deletedAt),
      orderBy: [asc(helpCenterCategories.position), asc(helpCenterCategories.name)],
    }),
    db
      .select({
        categoryId: helpCenterArticles.categoryId,
        count: sql<number>`count(*)::int`,
      })
      .from(helpCenterArticles)
      .where(
        and(
          isNull(helpCenterArticles.deletedAt),
          isNotNull(helpCenterArticles.publishedAt),
          lte(helpCenterArticles.publishedAt, now)
        )
      )
      .groupBy(helpCenterArticles.categoryId),
  ])

  const countMap = new Map(counts.map((c) => [c.categoryId, c.count]))

  return categories.map((cat) => ({
    ...cat,
    articleCount: countMap.get(cat.id as HelpCenterCategoryId) ?? 0,
  }))
}

export async function listPublicCategories(): Promise<HelpCenterCategoryWithCount[]> {
  const all = await listCategories()
  return all.filter((cat) => cat.isPublic && cat.articleCount > 0)
}

export async function getCategoryById(id: HelpCenterCategoryId): Promise<HelpCenterCategory> {
  const category = await db.query.helpCenterCategories.findFirst({
    where: and(eq(helpCenterCategories.id, id), isNull(helpCenterCategories.deletedAt)),
  })
  if (!category) {
    throw new NotFoundError('CATEGORY_NOT_FOUND', `Category ${id} not found`)
  }
  return category
}

export async function getCategoryBySlug(slug: string): Promise<HelpCenterCategory> {
  const category = await db.query.helpCenterCategories.findFirst({
    where: and(eq(helpCenterCategories.slug, slug), isNull(helpCenterCategories.deletedAt)),
  })
  if (!category) {
    throw new NotFoundError('CATEGORY_NOT_FOUND', `Category with slug "${slug}" not found`)
  }
  return category
}

export async function createCategory(input: CreateCategoryInput): Promise<HelpCenterCategory> {
  const name = input.name?.trim()
  if (!name) throw new ValidationError('VALIDATION_ERROR', 'Name is required')

  const slug = input.slug?.trim() || slugify(name)

  const [category] = await db
    .insert(helpCenterCategories)
    .values({
      name,
      slug,
      description: input.description?.trim() || null,
      isPublic: input.isPublic ?? true,
      position: input.position ?? 0,
      parentId: (input.parentId as HelpCenterCategoryId) ?? null,
      icon: input.icon ?? null,
    })
    .returning()

  return category
}

export async function updateCategory(
  id: HelpCenterCategoryId,
  input: UpdateCategoryInput
): Promise<HelpCenterCategory> {
  const updateData: Partial<typeof helpCenterCategories.$inferInsert> = { updatedAt: new Date() }
  if (input.name !== undefined) updateData.name = input.name.trim()
  if (input.slug !== undefined) updateData.slug = input.slug.trim()
  if (input.description !== undefined) updateData.description = input.description?.trim() || null
  if (input.isPublic !== undefined) updateData.isPublic = input.isPublic
  if (input.position !== undefined) updateData.position = input.position
  if (input.parentId !== undefined)
    updateData.parentId = (input.parentId as HelpCenterCategoryId) ?? null
  if (input.icon !== undefined) updateData.icon = input.icon ?? null

  const [updated] = await db
    .update(helpCenterCategories)
    .set(updateData)
    .where(and(eq(helpCenterCategories.id, id), isNull(helpCenterCategories.deletedAt)))
    .returning()

  if (!updated) throw new NotFoundError('CATEGORY_NOT_FOUND', `Category ${id} not found`)
  return updated
}

export async function deleteCategory(id: HelpCenterCategoryId): Promise<void> {
  const result = await db
    .update(helpCenterCategories)
    .set({ deletedAt: new Date() })
    .where(and(eq(helpCenterCategories.id, id), isNull(helpCenterCategories.deletedAt)))
    .returning()

  if (result.length === 0) {
    throw new NotFoundError('CATEGORY_NOT_FOUND', `Category ${id} not found`)
  }
}

// ============================================================================
// Articles
// ============================================================================

async function resolveArticleWithCategory(
  article: typeof helpCenterArticles.$inferSelect
): Promise<HelpCenterArticleWithCategory> {
  const [category, authorRecord] = await Promise.all([
    db.query.helpCenterCategories.findFirst({
      where: eq(helpCenterCategories.id, article.categoryId),
      columns: { id: true, slug: true, name: true },
    }),
    article.principalId
      ? db.query.principal.findFirst({
          where: eq(principal.id, article.principalId),
          columns: { id: true, displayName: true, avatarUrl: true },
        })
      : null,
  ])

  return {
    ...article,
    category: category
      ? { id: category.id as HelpCenterCategoryId, slug: category.slug, name: category.name }
      : { id: article.categoryId as HelpCenterCategoryId, slug: '', name: 'Unknown' },
    author: authorRecord?.displayName
      ? {
          id: authorRecord.id as PrincipalId,
          name: authorRecord.displayName,
          avatarUrl: authorRecord.avatarUrl,
        }
      : null,
  }
}

export async function getArticleById(
  id: HelpCenterArticleId
): Promise<HelpCenterArticleWithCategory> {
  const article = await db.query.helpCenterArticles.findFirst({
    where: and(eq(helpCenterArticles.id, id), isNull(helpCenterArticles.deletedAt)),
  })
  if (!article) {
    throw new NotFoundError('ARTICLE_NOT_FOUND', `Article ${id} not found`)
  }
  return resolveArticleWithCategory(article)
}

export async function getArticleBySlug(slug: string): Promise<HelpCenterArticleWithCategory> {
  const article = await db.query.helpCenterArticles.findFirst({
    where: and(eq(helpCenterArticles.slug, slug), isNull(helpCenterArticles.deletedAt)),
  })
  if (!article) {
    throw new NotFoundError('ARTICLE_NOT_FOUND', `Article with slug "${slug}" not found`)
  }
  return resolveArticleWithCategory(article)
}

export async function getPublicArticleBySlug(slug: string): Promise<HelpCenterArticleWithCategory> {
  const now = new Date()
  const article = await db.query.helpCenterArticles.findFirst({
    where: and(
      eq(helpCenterArticles.slug, slug),
      isNull(helpCenterArticles.deletedAt),
      isNotNull(helpCenterArticles.publishedAt),
      lte(helpCenterArticles.publishedAt, now)
    ),
  })
  if (!article) {
    throw new NotFoundError('ARTICLE_NOT_FOUND', `Article not found`)
  }

  // Increment view count (fire and forget)
  db.update(helpCenterArticles)
    .set({ viewCount: sql`${helpCenterArticles.viewCount} + 1` })
    .where(eq(helpCenterArticles.id, article.id))
    .catch(() => {})

  return resolveArticleWithCategory(article)
}

export async function listArticles(params: ListArticlesParams): Promise<ArticleListResult> {
  const { categoryId, status = 'all', search, cursor, limit = 20 } = params
  const now = new Date()

  const conditions = [isNull(helpCenterArticles.deletedAt)]

  if (categoryId) {
    conditions.push(eq(helpCenterArticles.categoryId, categoryId as HelpCenterCategoryId))
  }

  if (status === 'published') {
    conditions.push(isNotNull(helpCenterArticles.publishedAt))
    conditions.push(lte(helpCenterArticles.publishedAt, now))
  } else if (status === 'draft') {
    conditions.push(isNull(helpCenterArticles.publishedAt))
  }

  if (search?.trim()) {
    conditions.push(
      sql`${helpCenterArticles.searchVector} @@ websearch_to_tsquery('english', ${search.trim()})`
    )
  }

  if (cursor) {
    const cursorEntry = await db.query.helpCenterArticles.findFirst({
      where: eq(helpCenterArticles.id, cursor as HelpCenterArticleId),
      columns: { createdAt: true },
    })
    if (cursorEntry?.createdAt) {
      conditions.push(
        or(
          lt(helpCenterArticles.createdAt, cursorEntry.createdAt),
          and(
            eq(helpCenterArticles.createdAt, cursorEntry.createdAt),
            lt(helpCenterArticles.id, cursor as HelpCenterArticleId)
          )
        )!
      )
    }
  }

  const articles = await db.query.helpCenterArticles.findMany({
    where: and(...conditions),
    orderBy: [desc(helpCenterArticles.createdAt), desc(helpCenterArticles.id)],
    limit: limit + 1,
  })

  const hasMore = articles.length > limit
  const items = hasMore ? articles.slice(0, limit) : articles

  // Batch resolve categories and authors
  const categoryIds = [...new Set(items.map((a) => a.categoryId))]
  const principalIds = [
    ...new Set(items.map((a) => a.principalId).filter(Boolean)),
  ] as PrincipalId[]

  const [categories, principals] = await Promise.all([
    categoryIds.length > 0
      ? db.query.helpCenterCategories.findMany({
          where: inArray(helpCenterCategories.id, categoryIds),
          columns: { id: true, slug: true, name: true },
        })
      : [],
    principalIds.length > 0
      ? db.query.principal.findMany({
          where: inArray(principal.id, principalIds),
          columns: { id: true, displayName: true, avatarUrl: true },
        })
      : [],
  ])

  const categoryMap = new Map(categories.map((c) => [c.id, c]))
  const authorMap = new Map(principals.map((p) => [p.id, p]))

  const resolved: HelpCenterArticleWithCategory[] = items.map((article) => {
    const cat = categoryMap.get(article.categoryId)
    const author = article.principalId ? authorMap.get(article.principalId) : null
    return {
      ...article,
      category: cat
        ? { id: cat.id as HelpCenterCategoryId, slug: cat.slug, name: cat.name }
        : { id: article.categoryId as HelpCenterCategoryId, slug: '', name: 'Unknown' },
      author: author?.displayName
        ? { id: author.id as PrincipalId, name: author.displayName, avatarUrl: author.avatarUrl }
        : null,
    }
  })

  return {
    items: resolved,
    nextCursor: hasMore && items.length > 0 ? items[items.length - 1].id : null,
    hasMore,
  }
}

export async function listPublicArticles(params: {
  categoryId?: string
  search?: string
  cursor?: string
  limit?: number
}): Promise<ArticleListResult> {
  return listArticles({ ...params, status: 'published' })
}

export async function listPublicArticlesForCategory(categoryId: string) {
  return db
    .select({
      id: helpCenterArticles.id,
      slug: helpCenterArticles.slug,
      title: helpCenterArticles.title,
      description: helpCenterArticles.description,
      position: helpCenterArticles.position,
      publishedAt: helpCenterArticles.publishedAt,
    })
    .from(helpCenterArticles)
    .where(
      and(
        eq(helpCenterArticles.categoryId, categoryId as HelpCenterCategoryId),
        isNotNull(helpCenterArticles.publishedAt),
        isNull(helpCenterArticles.deletedAt)
      )
    )
    .orderBy(asc(helpCenterArticles.position), asc(helpCenterArticles.publishedAt))
}

export async function createArticle(
  input: CreateArticleInput,
  principalId: PrincipalId
): Promise<HelpCenterArticleWithCategory> {
  const title = input.title?.trim()
  const content = input.content?.trim()
  if (!title) throw new ValidationError('VALIDATION_ERROR', 'Title is required')
  if (!content) throw new ValidationError('VALIDATION_ERROR', 'Content is required')

  const slug = input.slug?.trim() || slugify(title)

  const parsedContentJson = input.contentJson ?? markdownToTiptapJson(content)
  const contentJson = await rehostExternalImages(parsedContentJson, {
    contentType: 'help-center',
    principalId,
  })

  const [article] = await db
    .insert(helpCenterArticles)
    .values({
      categoryId: input.categoryId as HelpCenterCategoryId,
      title,
      content,
      contentJson,
      slug,
      principalId,
      position: input.position ?? null,
      description: input.description?.trim() || null,
    })
    .returning()

  const resolved = await resolveArticleWithCategory(article)

  // Fire-and-forget: generate embedding for the new article
  generateArticleEmbedding(article.id, title, content, resolved.category?.name).catch((err) =>
    console.error(`[KB Embedding] Failed for article ${article.id}:`, err)
  )

  return resolved
}

export async function updateArticle(
  id: HelpCenterArticleId,
  input: UpdateArticleInput
): Promise<HelpCenterArticleWithCategory> {
  const updateData: Partial<typeof helpCenterArticles.$inferInsert> = { updatedAt: new Date() }
  if (input.title !== undefined) updateData.title = input.title.trim()
  if (input.content !== undefined || input.contentJson !== undefined) {
    if (input.content !== undefined) {
      updateData.content = input.content.trim()
    }
    const parsed = input.contentJson ?? markdownToTiptapJson((input.content ?? '').trim())
    updateData.contentJson = await rehostExternalImages(parsed, {
      contentType: 'help-center',
    })
  }
  if (input.categoryId !== undefined)
    updateData.categoryId = input.categoryId as HelpCenterCategoryId
  if (input.slug !== undefined) updateData.slug = input.slug.trim()
  if (input.position !== undefined) updateData.position = input.position
  if (input.description !== undefined) updateData.description = input.description?.trim() || null

  const [updated] = await db
    .update(helpCenterArticles)
    .set(updateData)
    .where(and(eq(helpCenterArticles.id, id), isNull(helpCenterArticles.deletedAt)))
    .returning()

  if (!updated) throw new NotFoundError('ARTICLE_NOT_FOUND', `Article ${id} not found`)

  const resolved = await resolveArticleWithCategory(updated)

  // Fire-and-forget: re-generate embedding when title or content changed
  if (input.title || input.content) {
    generateArticleEmbedding(id, resolved.title, resolved.content, resolved.category?.name).catch(
      (err) => console.error(`[KB Embedding] Failed for article ${id}:`, err)
    )
  }

  return resolved
}

export async function publishArticle(
  id: HelpCenterArticleId
): Promise<HelpCenterArticleWithCategory> {
  const [updated] = await db
    .update(helpCenterArticles)
    .set({ publishedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(helpCenterArticles.id, id), isNull(helpCenterArticles.deletedAt)))
    .returning()
  if (!updated) throw new NotFoundError('ARTICLE_NOT_FOUND', `Article ${id} not found`)
  return resolveArticleWithCategory(updated)
}

export async function unpublishArticle(
  id: HelpCenterArticleId
): Promise<HelpCenterArticleWithCategory> {
  const [updated] = await db
    .update(helpCenterArticles)
    .set({ publishedAt: null, updatedAt: new Date() })
    .where(and(eq(helpCenterArticles.id, id), isNull(helpCenterArticles.deletedAt)))
    .returning()
  if (!updated) throw new NotFoundError('ARTICLE_NOT_FOUND', `Article ${id} not found`)
  return resolveArticleWithCategory(updated)
}

export async function deleteArticle(id: HelpCenterArticleId): Promise<void> {
  const result = await db
    .update(helpCenterArticles)
    .set({ deletedAt: new Date() })
    .where(and(eq(helpCenterArticles.id, id), isNull(helpCenterArticles.deletedAt)))
    .returning()

  if (result.length === 0) {
    throw new NotFoundError('ARTICLE_NOT_FOUND', `Article ${id} not found`)
  }
}

// ============================================================================
// Article Feedback
// ============================================================================

export async function recordArticleFeedback(
  articleId: HelpCenterArticleId,
  helpful: boolean,
  principalId?: PrincipalId | null
): Promise<void> {
  await db.transaction(async (tx) => {
    if (principalId) {
      const existing = await tx.query.helpCenterArticleFeedback.findFirst({
        where: and(
          eq(helpCenterArticleFeedback.articleId, articleId),
          eq(helpCenterArticleFeedback.principalId, principalId)
        ),
      })

      if (existing) {
        if (existing.helpful === helpful) return
        await tx
          .update(helpCenterArticleFeedback)
          .set({ helpful })
          .where(eq(helpCenterArticleFeedback.id, existing.id))
        await tx
          .update(helpCenterArticles)
          .set({
            helpfulCount: helpful
              ? sql`${helpCenterArticles.helpfulCount} + 1`
              : sql`${helpCenterArticles.helpfulCount} - 1`,
            notHelpfulCount: helpful
              ? sql`${helpCenterArticles.notHelpfulCount} - 1`
              : sql`${helpCenterArticles.notHelpfulCount} + 1`,
          })
          .where(eq(helpCenterArticles.id, articleId))
        return
      }
    }

    await tx.insert(helpCenterArticleFeedback).values({
      articleId,
      principalId: principalId ?? null,
      helpful,
    })
    await tx
      .update(helpCenterArticles)
      .set(
        helpful
          ? { helpfulCount: sql`${helpCenterArticles.helpfulCount} + 1` }
          : { notHelpfulCount: sql`${helpCenterArticles.notHelpfulCount} + 1` }
      )
      .where(eq(helpCenterArticles.id, articleId))
  })
}
