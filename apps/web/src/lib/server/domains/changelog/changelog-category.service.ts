/**
 * Changelog category (label) service — CRUD, manual ordering, and the
 * entry <-> category link writer used by createChangelog/updateChangelog.
 *
 * Note: authorization (changelog.manage) is checked at the server-function
 * layer, not here.
 */
import {
  db,
  eq,
  inArray,
  asc,
  sql,
  changelogCategories,
  changelogEntryCategories,
} from '@/lib/server/db'
import type { ChangelogCategoryId, ChangelogId } from '@quackback/ids'
import { NotFoundError, ValidationError, ConflictError } from '@/lib/shared/errors'
import type { Actor } from '@/lib/server/policy/types'
import { segmentGateAllows } from '@/lib/server/policy/segment-gate'
import type {
  ChangelogCategory,
  CreateChangelogCategoryInput,
  UpdateChangelogCategoryInput,
} from './changelog-category.types'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'changelog-categories' })

const HEX_COLOR_RE = /^#[0-9A-Fa-f]{6}$/

function validateName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) {
    throw new ValidationError('VALIDATION_ERROR', 'Category name is required')
  }
  if (trimmed.length > 50) {
    throw new ValidationError('VALIDATION_ERROR', 'Category name must not exceed 50 characters')
  }
  return trimmed
}

function validateColor(color: string): string {
  if (!HEX_COLOR_RE.test(color)) {
    throw new ValidationError('VALIDATION_ERROR', 'Color must be a valid hex color (e.g., #6b7280)')
  }
  return color
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
  const color = validateColor(input.color || '#6b7280')

  const existing = await db.query.changelogCategories.findFirst({
    where: sql`lower(${changelogCategories.name}) = lower(${name})`,
  })
  if (existing) {
    throw new ConflictError('DUPLICATE_NAME', `A category named "${name}" already exists`)
  }

  const [{ maxPosition }] = await db
    .select({ maxPosition: sql<number>`coalesce(max(${changelogCategories.position}), -1)::int` })
    .from(changelogCategories)

  const [category] = await db
    .insert(changelogCategories)
    .values({
      name,
      color,
      segmentIds: input.segmentIds ?? [],
      position: maxPosition + 1,
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

  const cases = ids
    .map((id, i) => sql`WHEN ${changelogCategories.id} = ${id} THEN ${sql.raw(String(i))}`)
    .reduce((acc, curr) => sql`${acc} ${curr}`, sql``)

  await db
    .update(changelogCategories)
    .set({ position: sql`CASE ${cases} END` })
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
