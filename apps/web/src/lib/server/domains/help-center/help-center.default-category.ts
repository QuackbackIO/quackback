import { db, helpCenterCategories, and, eq, isNull, type Transaction } from '@/lib/server/db'
import type { KbCategoryId } from '@quackback/ids'

/** The category an article lands in when nobody picked one. */
export const DEFAULT_HELP_CATEGORY = { name: 'General', slug: 'general' } as const

type Executor = typeof db | Transaction

function findLiveDefault(executor: Executor) {
  return executor.query.helpCenterCategories.findFirst({
    where: and(
      eq(helpCenterCategories.slug, DEFAULT_HELP_CATEGORY.slug),
      isNull(helpCenterCategories.deletedAt)
    ),
    columns: { id: true },
  })
}

/**
 * The live General category, created on first use. An article always needs a
 * category, so a first article saved before any category exists files here
 * instead of failing. Safe under concurrent first saves: the slug is unique,
 * so the loser of the insert reads the winner's row. A General that was
 * deleted keeps its slug, so a fresh one takes a suffixed slug rather than
 * reviving the deleted row. A new one is labelled `locale`, the main language
 * (English when the caller does not know it, as on a new workspace).
 */
export async function ensureDefaultHelpCategory(
  executor: Executor = db,
  locale?: string
): Promise<KbCategoryId> {
  const existing = await findLiveDefault(executor)
  if (existing) return existing.id as KbCategoryId

  const [created] = await executor
    .insert(helpCenterCategories)
    .values({ ...DEFAULT_HELP_CATEGORY, ...(locale ? { locale } : {}) })
    .onConflictDoNothing({ target: helpCenterCategories.slug })
    .returning({ id: helpCenterCategories.id })
  if (created) return created.id as KbCategoryId

  const raced = await findLiveDefault(executor)
  if (raced) return raced.id as KbCategoryId

  for (let suffix = 2; ; suffix++) {
    const [fresh] = await executor
      .insert(helpCenterCategories)
      .values({
        name: DEFAULT_HELP_CATEGORY.name,
        slug: `${DEFAULT_HELP_CATEGORY.slug}-${suffix}`,
        ...(locale ? { locale } : {}),
      })
      .onConflictDoNothing({ target: helpCenterCategories.slug })
      .returning({ id: helpCenterCategories.id })
    if (fresh) return fresh.id as KbCategoryId
  }
}
