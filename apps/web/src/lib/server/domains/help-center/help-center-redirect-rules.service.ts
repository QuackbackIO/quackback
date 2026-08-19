/**
 * Redirect rules for the /hc site (domains/languages §2): admin-defined
 * `path -> published article|category` 301s. Many rules may point at the
 * same target; `path` is the unique key. `targetType`/`targetId` is a
 * polymorphic reference with no FK (a single FK can't span kb_articles and
 * kb_categories), so deleting a target requires an explicit cascade — see
 * {@link deleteRedirectRulesForTarget}, called from the article/category
 * delete services.
 */
import {
  db,
  eq,
  and,
  desc,
  helpCenterRedirectRules,
  helpCenterArticles,
  helpCenterCategories,
} from '@/lib/server/db'
import type { KbArticleId, KbCategoryId, HcRedirectRuleId } from '@quackback/ids'
import { NotFoundError, ValidationError, ConflictError, InternalError } from '@/lib/shared/errors'
import { isUniqueViolation } from '@/lib/server/utils'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'help-center-redirect-rules' })

export type RedirectTargetType = 'article' | 'category'

export interface HelpCenterRedirectRule {
  id: HcRedirectRuleId
  path: string
  targetType: RedirectTargetType
  targetId: string
  /** Denormalized for the settings-card list; null if the target vanished. */
  targetLabel: string | null
  createdAt: Date
}

export interface CreateRedirectRuleInput {
  path: string
  targetType: RedirectTargetType
  targetId: string
}

/** `foo/bar`, `/foo/bar/`, `foo//bar` all normalize to `/foo/bar`. */
function normalizeRedirectPath(input: string): string {
  const trimmed = input.trim().replace(/\/+/g, '/')
  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  return withLeadingSlash.length > 1 ? withLeadingSlash.replace(/\/$/, '') : withLeadingSlash
}

async function requirePublishedTarget(
  targetType: RedirectTargetType,
  targetId: string
): Promise<string> {
  if (targetType === 'article') {
    const article = await db.query.helpCenterArticles.findFirst({
      where: eq(helpCenterArticles.id, targetId as KbArticleId),
      columns: { title: true, publishedAt: true, deletedAt: true },
    })
    if (!article || article.deletedAt) {
      throw new NotFoundError('HC_REDIRECT_TARGET_NOT_FOUND', 'Article not found')
    }
    if (!article.publishedAt) {
      throw new ValidationError(
        'HC_REDIRECT_TARGET_NOT_PUBLISHED',
        'Redirect target must be a published article'
      )
    }
    return article.title
  }

  const category = await db.query.helpCenterCategories.findFirst({
    where: eq(helpCenterCategories.id, targetId as KbCategoryId),
    columns: { name: true, isPublic: true, deletedAt: true },
  })
  if (!category || category.deletedAt) {
    throw new NotFoundError('HC_REDIRECT_TARGET_NOT_FOUND', 'Category not found')
  }
  if (!category.isPublic) {
    throw new ValidationError(
      'HC_REDIRECT_TARGET_NOT_PUBLISHED',
      'Redirect target must be a public category'
    )
  }
  return category.name
}

/** Best-effort label lookup for the settings-card list; null if the target vanished. */
async function lookupTargetLabel(
  targetType: RedirectTargetType,
  targetId: string
): Promise<string | null> {
  if (targetType === 'article') {
    const article = await db.query.helpCenterArticles.findFirst({
      where: eq(helpCenterArticles.id, targetId as KbArticleId),
      columns: { title: true },
    })
    return article?.title ?? null
  }
  const category = await db.query.helpCenterCategories.findFirst({
    where: eq(helpCenterCategories.id, targetId as KbCategoryId),
    columns: { name: true },
  })
  return category?.name ?? null
}

export async function listRedirectRules(): Promise<HelpCenterRedirectRule[]> {
  const rows = await db
    .select()
    .from(helpCenterRedirectRules)
    .orderBy(desc(helpCenterRedirectRules.createdAt))

  const withLabels = await Promise.all(
    rows.map(async (row) => {
      const targetLabel = await lookupTargetLabel(row.targetType, row.targetId).catch(() => null)
      return {
        id: row.id,
        path: row.path,
        targetType: row.targetType,
        targetId: row.targetId,
        targetLabel,
        createdAt: row.createdAt,
      }
    })
  )
  return withLabels
}

export async function createRedirectRule(
  input: CreateRedirectRuleInput
): Promise<HelpCenterRedirectRule> {
  const path = normalizeRedirectPath(input.path)
  const targetLabel = await requirePublishedTarget(input.targetType, input.targetId)

  try {
    const [row] = await db
      .insert(helpCenterRedirectRules)
      .values({ path, targetType: input.targetType, targetId: input.targetId })
      .returning()
    return { ...row, targetLabel }
  } catch (error) {
    if (error instanceof ValidationError || error instanceof NotFoundError) throw error
    if (isUniqueViolation(error)) {
      throw new ConflictError('HC_REDIRECT_PATH_TAKEN', `A redirect rule for "${path}" already exists`)
    }
    log.error({ err: error }, 'failed to create redirect rule')
    throw new InternalError('DATABASE_ERROR', 'Failed to create redirect rule', error)
  }
}

export async function deleteRedirectRule(id: HcRedirectRuleId): Promise<void> {
  await db.delete(helpCenterRedirectRules).where(eq(helpCenterRedirectRules.id, id))
}

/** Cascade hook for the article/category delete services (no DB-level FK). */
export async function deleteRedirectRulesForTarget(
  targetType: RedirectTargetType,
  targetId: string
): Promise<void> {
  await db
    .delete(helpCenterRedirectRules)
    .where(
      and(
        eq(helpCenterRedirectRules.targetType, targetType),
        eq(helpCenterRedirectRules.targetId, targetId)
      )
    )
}

/**
 * Resolve a requested /hc path to its redirect destination, or null. Used by
 * the /hc catch-all 404 handler. Skips rules whose target became unpublished
 * or vanished rather than 301'ing into a dead page (the rule itself is left
 * in place -- republishing the target makes it live again without re-entry).
 */
export async function resolveRedirectRule(path: string): Promise<string | null> {
  const rule = await db.query.helpCenterRedirectRules.findFirst({
    where: eq(helpCenterRedirectRules.path, normalizeRedirectPath(path)),
  })
  if (!rule) return null

  if (rule.targetType === 'article') {
    const article = await db.query.helpCenterArticles.findFirst({
      where: eq(helpCenterArticles.id, rule.targetId as KbArticleId),
      with: { category: true },
    })
    if (!article || article.deletedAt || !article.publishedAt) return null
    return `/hc/articles/${article.category.slug}/${article.slug}`
  }

  const category = await db.query.helpCenterCategories.findFirst({
    where: eq(helpCenterCategories.id, rule.targetId as KbCategoryId),
  })
  if (!category || category.deletedAt || !category.isPublic) return null
  return `/hc/categories/${category.slug}`
}
