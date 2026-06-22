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
  sql,
} from '@/lib/server/db'
import type { HelpCenterArticleId, HelpCenterCategoryId, PrincipalId } from '@quackback/ids'
import { NotFoundError, ValidationError } from '@/lib/shared/errors'
import { isTeamMember } from '@/lib/shared/roles'
import { markdownToTiptapJson } from '@/lib/server/markdown-tiptap'
import { rehostExternalImages } from '@/lib/server/content/rehost-images'
import { slugify } from '@/lib/shared/utils'
import type {
  HelpCenterArticleWithCategory,
  CreateArticleInput,
  UpdateArticleInput,
} from './help-center.types'
import { generateArticleEmbedding } from './help-center-embedding.service'
import { canActorViewCategory, type HelpCenterVisibilityActor } from './help-center.visibility'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'help-center-articles' })

/**
 * Best-effort webhook dispatch for help-center article lifecycle events.
 * Lazy import + `service` actor + try/catch so a dispatch failure never aborts
 * the mutation. Mirrors the config-plane fire helpers.
 */
async function fireArticleEvent(
  kind: 'created' | 'updated' | 'published' | 'unpublished' | 'deleted',
  article: HelpCenterArticleWithCategory,
  changedFields?: string[]
): Promise<void> {
  try {
    const {
      dispatchHelpCenterArticleCreated,
      dispatchHelpCenterArticleUpdated,
      dispatchHelpCenterArticlePublished,
      dispatchHelpCenterArticleUnpublished,
      dispatchHelpCenterArticleDeleted,
    } = await import('@/lib/server/events/dispatch')
    const actor = { type: 'service' as const, displayName: 'help-center-system' }
    const ref = {
      id: article.id,
      categoryId: article.categoryId,
      slug: article.slug,
      title: article.title,
      authorPrincipalId: article.principalId ?? null,
      publishedAt: article.publishedAt ? article.publishedAt.toISOString() : null,
      createdAt: article.createdAt ? article.createdAt.toISOString() : null,
      updatedAt: article.updatedAt ? article.updatedAt.toISOString() : null,
    }
    if (kind === 'created') await dispatchHelpCenterArticleCreated(actor, ref)
    else if (kind === 'updated')
      await dispatchHelpCenterArticleUpdated(actor, ref, changedFields ?? [])
    else if (kind === 'published') await dispatchHelpCenterArticlePublished(actor, ref)
    else if (kind === 'unpublished') await dispatchHelpCenterArticleUnpublished(actor, ref)
    else await dispatchHelpCenterArticleDeleted(actor, ref)
  } catch (err) {
    log.error({ err }, `failed to dispatch help_center.article.${kind} event`)
  }
}

function normalizeIdArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

// ============================================================================
// Articles
// ============================================================================

export async function resolveArticleWithCategory(
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

export async function getPublicArticleBySlug(
  slug: string,
  actor: HelpCenterVisibilityActor | null = null
): Promise<HelpCenterArticleWithCategory> {
  const now = new Date()
  // Join the parent category so the public lookup also enforces
  // category.isPublic. Without that check, an article under a category
  // an admin had flagged private was still reachable by slug — the
  // category's intent was respected only in the list/nav UI.
  const rows = await db
    .select({
      article: helpCenterArticles,
      category: {
        id: helpCenterCategories.id,
        isPublic: helpCenterCategories.isPublic,
        visibility: helpCenterCategories.visibility,
        allowedSegmentIds: helpCenterCategories.allowedSegmentIds,
        allowedPrincipalIds: helpCenterCategories.allowedPrincipalIds,
      },
    })
    .from(helpCenterArticles)
    .innerJoin(helpCenterCategories, eq(helpCenterArticles.categoryId, helpCenterCategories.id))
    .where(
      and(
        eq(helpCenterArticles.slug, slug),
        isNull(helpCenterArticles.deletedAt),
        isNotNull(helpCenterArticles.publishedAt),
        lte(helpCenterArticles.publishedAt, now),
        isNull(helpCenterCategories.deletedAt),
        eq(helpCenterCategories.isPublic, true)
      )
    )
    .limit(1)
  const row = rows[0]
  const article = row?.article
  if (!article || !row?.category) {
    throw new NotFoundError('ARTICLE_NOT_FOUND', `Article not found`)
  }

  const canView = canActorViewCategory(
    {
      ...row.category,
      allowedSegmentIds: normalizeIdArray(row.category.allowedSegmentIds),
      allowedPrincipalIds: normalizeIdArray(row.category.allowedPrincipalIds),
    },
    actor
  )

  if (!canView) {
    throw new NotFoundError('ARTICLE_NOT_FOUND', `Article not found`)
  }

  // Increment view count (fire and forget)
  db.update(helpCenterArticles)
    .set({ viewCount: sql`${helpCenterArticles.viewCount} + 1` })
    .where(eq(helpCenterArticles.id, article.id))
    .catch(() => {})

  return resolveArticleWithCategory(article)
}

export async function createArticle(
  input: CreateArticleInput,
  principalId: PrincipalId,
  authorPrincipalId?: PrincipalId
): Promise<HelpCenterArticleWithCategory> {
  const title = input.title?.trim()
  const content = input.content?.trim()
  if (!title) throw new ValidationError('VALIDATION_ERROR', 'Title is required')
  if (!content) throw new ValidationError('VALIDATION_ERROR', 'Content is required')

  let effectivePrincipalId: PrincipalId
  if (authorPrincipalId !== undefined) {
    const author = await db.query.principal.findFirst({
      where: eq(principal.id, authorPrincipalId),
      columns: { id: true, role: true, type: true },
    })
    if (!author) throw new ValidationError('VALIDATION_ERROR', 'Author not found')
    if (author.type !== 'user' || !isTeamMember(author.role))
      throw new ValidationError('VALIDATION_ERROR', 'Author must be a team member')
    effectivePrincipalId = authorPrincipalId
  } else {
    // Service principals (API keys) have no human identity and cannot be article bylines.
    // Require an explicit authorId instead of silently using the API key as the author.
    const caller = await db.query.principal.findFirst({
      where: eq(principal.id, principalId),
      columns: { type: true },
    })
    if (caller?.type !== 'user') {
      throw new ValidationError(
        'VALIDATION_ERROR',
        'Service principals must provide an explicit authorId'
      )
    }
    effectivePrincipalId = principalId
  }
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
      principalId: effectivePrincipalId,
      position: input.position ?? null,
      description: input.description?.trim() || null,
    })
    .returning()

  const resolved = await resolveArticleWithCategory(article)

  // Fire-and-forget: generate embedding for the new article
  generateArticleEmbedding(article.id, title, content, resolved.category?.name).catch((err) =>
    log.error({ article_id: article.id, err }, 'article embedding generation failed')
  )

  void fireArticleEvent('created', resolved)

  return resolved
}

export async function updateArticle(
  id: HelpCenterArticleId,
  input: UpdateArticleInput,
  authorPrincipalId?: PrincipalId
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
  const updated = await db.transaction(async (tx) => {
    if (authorPrincipalId !== undefined) {
      const author = await tx.query.principal.findFirst({
        where: eq(principal.id, authorPrincipalId),
        columns: { id: true, role: true, type: true },
      })
      if (!author) throw new ValidationError('VALIDATION_ERROR', 'Author not found')
      if (author.type !== 'user')
        throw new ValidationError('VALIDATION_ERROR', 'Author must be a team member')
      if (!isTeamMember(author.role)) {
        // Allow re-asserting a former human team member who already owns the article.
        // Both reads are inside the transaction so a concurrent author reassignment
        // cannot slip between the role check and the ownership check.
        const existing = await tx.query.helpCenterArticles.findFirst({
          where: eq(helpCenterArticles.id, id),
          columns: { principalId: true },
        })
        if (existing?.principalId !== authorPrincipalId) {
          throw new ValidationError('VALIDATION_ERROR', 'Author must be a team member')
        }
      }
      updateData.principalId = authorPrincipalId
    }

    const [row] = await tx
      .update(helpCenterArticles)
      .set(updateData)
      .where(and(eq(helpCenterArticles.id, id), isNull(helpCenterArticles.deletedAt)))
      .returning()

    return row
  })

  if (!updated) throw new NotFoundError('ARTICLE_NOT_FOUND', `Article ${id} not found`)

  const resolved = await resolveArticleWithCategory(updated)

  // Fire-and-forget: re-generate embedding when title or content changed
  if (input.title || input.content) {
    generateArticleEmbedding(id, resolved.title, resolved.content, resolved.category?.name).catch(
      (err) => log.error({ article_id: id, err }, 'article embedding generation failed')
    )
  }

  // Report the changed columns (drop the always-present updatedAt bump).
  const changedFields = Object.keys(updateData).filter((k) => k !== 'updatedAt')
  void fireArticleEvent('updated', resolved, changedFields)

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
  const resolved = await resolveArticleWithCategory(updated)
  void fireArticleEvent('published', resolved)
  return resolved
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
  const resolved = await resolveArticleWithCategory(updated)
  void fireArticleEvent('unpublished', resolved)
  return resolved
}

export async function deleteArticle(id: HelpCenterArticleId): Promise<void> {
  const [deleted] = await db
    .update(helpCenterArticles)
    .set({ deletedAt: new Date() })
    .where(and(eq(helpCenterArticles.id, id), isNull(helpCenterArticles.deletedAt)))
    .returning()

  if (!deleted) {
    throw new NotFoundError('ARTICLE_NOT_FOUND', `Article ${id} not found`)
  }

  const resolved = await resolveArticleWithCategory(deleted)
  void fireArticleEvent('deleted', resolved)
}

export async function restoreArticle(
  id: HelpCenterArticleId
): Promise<HelpCenterArticleWithCategory> {
  log.debug({ article_id: id }, 'restore article')
  const article = await db.query.helpCenterArticles.findFirst({
    where: eq(helpCenterArticles.id, id),
  })

  if (!article) {
    throw new NotFoundError('ARTICLE_NOT_FOUND', `Article ${id} not found`)
  }

  if (!article.deletedAt) {
    throw new ValidationError('VALIDATION_ERROR', 'Article is not deleted')
  }

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  if (new Date(article.deletedAt) < thirtyDaysAgo) {
    throw new ValidationError(
      'RESTORE_EXPIRED',
      'Articles can only be restored within 30 days of deletion'
    )
  }

  const [restored] = await db
    .update(helpCenterArticles)
    .set({ deletedAt: null, updatedAt: new Date() })
    .where(eq(helpCenterArticles.id, id))
    .returning()

  if (!restored) {
    throw new NotFoundError('ARTICLE_NOT_FOUND', `Article ${id} not found`)
  }

  return resolveArticleWithCategory(restored)
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
