/**
 * Changelog category (label) service — CRUD, manual ordering, and the
 * entry <-> category link writer used by createChangelog/updateChangelog.
 *
 * Note: authorization (changelog.manage) is checked at the server-function
 * layer, not here.
 */
import {
  db,
  and,
  or,
  eq,
  inArray,
  asc,
  sql,
  changelogEntries,
  changelogCategories,
  changelogEntryCategories,
} from '@/lib/server/db'
import type { SQL } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import type { ChangelogCategoryId, ChangelogId } from '@quackback/ids'
import { NotFoundError, ValidationError, ConflictError } from '@/lib/shared/errors'
import { TAXONOMY_DEFAULT_COLOR } from '@/lib/shared/schemas/taxonomy'
import {
  assertHexColor,
  assertTrimmedName,
  nextPosition,
  positionCaseSql,
} from '@/lib/server/utils'
import type { Actor } from '@/lib/server/policy/types'
import { segmentGateAllows, segmentGateFilter } from '@/lib/server/policy/segment-gate'
import type {
  ChangelogCategory,
  CreateChangelogCategoryInput,
  UpdateChangelogCategoryInput,
} from './changelog-category.types'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'changelog-categories' })

function validateName(name: string): string {
  return assertTrimmedName(name, {
    required: 'Category name is required',
    tooLong: 'Category name must not exceed 50 characters',
  })
}

function validateColor(color: string): string {
  return assertHexColor(color, 'Color must be a valid hex color (e.g., #6b7280)')
}

/** List categories ordered for the Labels settings card and the filter chips. */
export async function listChangelogCategories(): Promise<ChangelogCategory[]> {
  return db.query.changelogCategories.findMany({
    orderBy: [asc(changelogCategories.position), asc(changelogCategories.createdAt)],
  })
}

export async function createChangelogCategory(
  input: CreateChangelogCategoryInput
): Promise<ChangelogCategory> {
  log.debug({ name: input.name }, 'create changelog category')
  const name = validateName(input.name)
  const color = validateColor(input.color || TAXONOMY_DEFAULT_COLOR)

  const existing = await db.query.changelogCategories.findFirst({
    where: sql`lower(${changelogCategories.name}) = lower(${name})`,
  })
  if (existing) {
    throw new ConflictError('DUPLICATE_NAME', `A category named "${name}" already exists`)
  }

  const [category] = await db
    .insert(changelogCategories)
    .values({
      name,
      color,
      segmentIds: input.segmentIds ?? [],
      position: await nextPosition(changelogCategories, changelogCategories.position),
    })
    .returning()

  return category
}

export async function updateChangelogCategory(
  id: ChangelogCategoryId,
  input: UpdateChangelogCategoryInput
): Promise<ChangelogCategory> {
  log.debug({ category_id: id }, 'update changelog category')
  const existing = await db.query.changelogCategories.findFirst({
    where: eq(changelogCategories.id, id),
  })
  if (!existing) {
    throw new NotFoundError('CATEGORY_NOT_FOUND', `Category with ID ${id} not found`)
  }

  const updateData: Record<string, unknown> = {}

  if (input.name !== undefined) {
    const name = validateName(input.name)
    const duplicate = await db.query.changelogCategories.findFirst({
      where: sql`lower(${changelogCategories.name}) = lower(${name}) AND ${changelogCategories.id} != ${id}`,
    })
    if (duplicate) {
      throw new ConflictError('DUPLICATE_NAME', `A category named "${name}" already exists`)
    }
    updateData.name = name
  }
  if (input.color !== undefined) {
    updateData.color = validateColor(input.color)
  }
  if (input.segmentIds !== undefined) {
    updateData.segmentIds = input.segmentIds
  }

  if (Object.keys(updateData).length === 0) {
    return existing
  }

  const [updated] = await db
    .update(changelogCategories)
    .set(updateData)
    .where(eq(changelogCategories.id, id))
    .returning()

  return updated
}

/** Delete a category. Entry links cascade via the FK. */
export async function deleteChangelogCategory(id: ChangelogCategoryId): Promise<void> {
  log.debug({ category_id: id }, 'delete changelog category')
  const result = await db
    .delete(changelogCategories)
    .where(eq(changelogCategories.id, id))
    .returning({ id: changelogCategories.id })

  if (result.length === 0) {
    throw new NotFoundError('CATEGORY_NOT_FOUND', `Category with ID ${id} not found`)
  }
}

/** Reorder categories — single batch UPDATE with a CASE expression. */
export async function reorderChangelogCategories(ids: ChangelogCategoryId[]): Promise<void> {
  log.debug({ count: ids?.length ?? 0 }, 'reorder changelog categories')
  if (!ids || ids.length === 0) {
    throw new ValidationError('VALIDATION_ERROR', 'Category IDs are required')
  }

  await db
    .update(changelogCategories)
    .set({ position: positionCaseSql(changelogCategories.id, ids) })
    .where(inArray(changelogCategories.id, ids))
}

/**
 * Get the category ids linked to a changelog entry.
 */
export async function getEntryCategoryIds(entryId: ChangelogId): Promise<ChangelogCategoryId[]> {
  const rows = await db.query.changelogEntryCategories.findMany({
    where: eq(changelogEntryCategories.changelogEntryId, entryId),
    columns: { categoryId: true },
  })
  return rows.map((r) => r.categoryId)
}

/**
 * Get the categories (full rows) linked to a set of changelog entries, keyed
 * by entry id. Used by the list/detail readers so every consumer projects
 * categories the same way.
 */
export async function getCategoriesForEntries(
  entryIds: ChangelogId[]
): Promise<Map<ChangelogId, ChangelogCategory[]>> {
  const map = new Map<ChangelogId, ChangelogCategory[]>()
  if (entryIds.length === 0) return map

  const rows = await db.query.changelogEntryCategories.findMany({
    where: inArray(changelogEntryCategories.changelogEntryId, entryIds),
    with: { category: true },
  })

  for (const row of rows) {
    const existing = map.get(row.changelogEntryId) ?? []
    existing.push(row.category)
    map.set(row.changelogEntryId, existing)
  }
  return map
}

/**
 * Replace the full set of categories linked to a changelog entry. Validates
 * that every id refers to an existing category, silently dropping unknowns
 * (mirrors linkPostsToChangelog's tolerant-invalid-id behavior).
 */
export async function setEntryCategories(
  entryId: ChangelogId,
  categoryIds: ChangelogCategoryId[]
): Promise<void> {
  await db
    .delete(changelogEntryCategories)
    .where(eq(changelogEntryCategories.changelogEntryId, entryId))

  if (categoryIds.length === 0) return

  const existingCategories = await db.query.changelogCategories.findMany({
    where: inArray(changelogCategories.id, categoryIds),
    columns: { id: true },
  })
  const validIds = new Set(existingCategories.map((c) => c.id))
  const toLink = categoryIds.filter((id) => validIds.has(id))

  if (toLink.length > 0) {
    await db.insert(changelogEntryCategories).values(
      toLink.map((categoryId) => ({
        changelogEntryId: entryId,
        categoryId,
      }))
    )
  }
}

/**
 * Category-level segment gating (the cheap per-category audience mechanism):
 * an entry is visible to `actor` only when EVERY one of its gated categories
 * (non-empty segmentIds) includes at least one of the actor's segments.
 * Categories with an empty segmentIds list ([] = everyone) never restrict.
 * An entry with no categories, or only ungated ones, is always visible.
 * Team actors bypass the gate entirely (mirrors `tierAllows`/`boardViewFilter`).
 * Per-category semantics come from the shared segment-gate primitive
 * (policy/segment-gate.ts).
 */
export function categoryGateAllows(
  categories: Array<{ segmentIds: string[] }>,
  actor: Actor
): boolean {
  return categories.every((category) => segmentGateAllows(actor, category.segmentIds))
}

/**
 * SQL twin of {@link categoryGateAllows} for the entry whose id is `entryId`:
 * true when none of the entry's categories gates the actor out. Row-by-row
 * truthiness must match categoryGateAllows exactly.
 */
export function categoryGateCondition(actor: Actor, entryId: SQL | AnyPgColumn): SQL {
  const gate = segmentGateFilter(actor, sql.raw('"gated_category"."segment_ids"'))
  return sql`NOT EXISTS (
    SELECT 1 FROM ${changelogEntryCategories} "gated_link"
    JOIN ${changelogCategories} "gated_category"
      ON "gated_category"."id" = "gated_link"."category_id"
    WHERE "gated_link"."changelog_entry_id" = ${entryId} AND NOT (${gate})
  )`
}

/**
 * Condition restricting a changelog list to entries carrying at least one of
 * the given categories (labels), by id and/or by case-insensitive name. The
 * two are OR-ed: `{ categoryIds: [a], categories: ['fixes'] }` matches an
 * entry with either.
 *
 * Shaped as `inArray(changelogEntries.id, <subquery>)` rather than a join, so
 * it composes into an existing `where` without disturbing `limit + 1` cursor
 * pagination or fanning out duplicate rows for a multi-label entry. The same
 * `inArray(entity.id, subquery)` shape as the tagIds filter in post.inbox.ts,
 * and for the same reason: a relational-query-builder caller can't safely
 * correlate a raw `EXISTS` subquery to the outer table, because the builder
 * rewrites column references to the outer alias.
 *
 * Returns undefined when neither list has a usable entry, so callers can skip
 * pushing it into their conditions. Note the asymmetry that makes that safe:
 * an all-blank `categories` array (e.g. `?labels=,`) yields undefined —
 * "no filter requested" — whereas a name that is merely unknown yields a
 * condition matching nothing, which is the honest answer to "give me entries
 * labelled X" when no such label exists.
 */
export function categoryFilterCondition(params: {
  categoryIds?: ChangelogCategoryId[]
  categories?: string[]
}): SQL<unknown> | undefined {
  const categoryIds = (params.categoryIds ?? []).filter(Boolean)
  const names = (params.categories ?? []).map((c) => c.trim().toLowerCase()).filter(Boolean)

  if (categoryIds.length === 0 && names.length === 0) return undefined

  const matchConditions: SQL<unknown>[] = []
  if (categoryIds.length > 0) matchConditions.push(inArray(changelogCategories.id, categoryIds))
  if (names.length > 0) {
    matchConditions.push(inArray(sql`lower(trim(${changelogCategories.name}))`, names))
  }

  const entryIdsWithMatchingCategories = db
    .selectDistinct({ changelogEntryId: changelogEntryCategories.changelogEntryId })
    .from(changelogEntryCategories)
    .innerJoin(changelogCategories, eq(changelogEntryCategories.categoryId, changelogCategories.id))
    .where(and(or(...matchConditions)))

  return inArray(changelogEntries.id, entryIdsWithMatchingCategories)
}
