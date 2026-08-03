/**
 * Changelog Visibility Service
 *
 * Manages per-segment and org-level changelog category/product visibility.
 *
 * Logic mirrors portal-tab.service.ts:
 * - Org-level defaults stored in settings.changelog_visibility_config
 * - Segment-level overrides stored in changelog_segment_visibility table
 * - Effective visibility for a user = UNION across all their segments + org defaults
 *   (most permissive wins: if any config is unrestricted, the user sees everything)
 */

import {
  db,
  eq,
  settings,
  userSegments,
  segments as segmentsTable,
  changelogSegmentVisibility,
} from '@/lib/server/db'
import type { SegmentId, UserId } from '@quackback/ids'
import { logger } from '@/lib/server/logger'
import type { ChangelogVisibilityConfig } from '@/lib/server/db'

const log = logger.child({ component: 'changelog-visibility' })

// ============================================
// Cache
// ============================================

let cachedOrgVisibilityConfig: ChangelogVisibilityConfig | null = null

/** Invalidate the org-level changelog visibility config cache. */
export function invalidateChangelogVisibilityCache(): void {
  cachedOrgVisibilityConfig = null
}

// ============================================
// Parse / Serialize
// ============================================

function parseVisibilityConfig(raw: string | null | undefined): ChangelogVisibilityConfig {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return {}
    return {
      restrictCategories:
        typeof parsed.restrictCategories === 'boolean' ? parsed.restrictCategories : undefined,
      allowedCategoryIds: Array.isArray(parsed.allowedCategoryIds) ? parsed.allowedCategoryIds : [],
      restrictProducts:
        typeof parsed.restrictProducts === 'boolean' ? parsed.restrictProducts : undefined,
      allowedProductIds: Array.isArray(parsed.allowedProductIds) ? parsed.allowedProductIds : [],
    }
  } catch {
    return {}
  }
}

// ============================================
// Effective config resolution
// ============================================

/**
 * Merge multiple ChangelogVisibilityConfig values using union (most permissive) logic.
 *
 * For each dimension (categories / products):
 *   - If ANY config has restrict=false (or absent) → no restriction (null)
 *   - If ALL configs restrict → union of their allowed ID sets
 *
 * Returns: `{ allowedCategoryIds: string[] | null, allowedProductIds: string[] | null }`
 *   null = no restriction (all visible)
 *   string[] = only these IDs are visible (plus entries with no category/product)
 */
export function mergeChangelogVisibilityConfigs(configs: ChangelogVisibilityConfig[]): {
  allowedCategoryIds: string[] | null
  allowedProductIds: string[] | null
} {
  if (configs.length === 0) {
    return { allowedCategoryIds: null, allowedProductIds: null }
  }

  // Categories
  const categoryRestricted = configs.every((c) => c.restrictCategories === true)
  let allowedCategoryIds: string[] | null
  if (categoryRestricted) {
    const union = new Set<string>()
    for (const c of configs) {
      for (const id of c.allowedCategoryIds ?? []) {
        union.add(id)
      }
    }
    allowedCategoryIds = Array.from(union)
  } else {
    allowedCategoryIds = null // unrestricted
  }

  // Products
  const productRestricted = configs.every((c) => c.restrictProducts === true)
  let allowedProductIds: string[] | null
  if (productRestricted) {
    const union = new Set<string>()
    for (const c of configs) {
      for (const id of c.allowedProductIds ?? []) {
        union.add(id)
      }
    }
    allowedProductIds = Array.from(union)
  } else {
    allowedProductIds = null // unrestricted
  }

  return { allowedCategoryIds, allowedProductIds }
}

// ============================================
// Organization-Level Config
// ============================================

export async function getOrgChangelogVisibility(): Promise<ChangelogVisibilityConfig> {
  if (cachedOrgVisibilityConfig !== null) {
    return cachedOrgVisibilityConfig
  }
  try {
    const rows = await db
      .select({ changelogVisibilityConfig: settings.changelogVisibilityConfig })
      .from(settings)
      .limit(1)
    const raw = rows[0]?.changelogVisibilityConfig
    const config = parseVisibilityConfig(raw)
    cachedOrgVisibilityConfig = config
    return config
  } catch (error) {
    log.error({ error }, 'Failed to fetch org changelog visibility config, returning defaults')
    return {}
  }
}

export async function setOrgChangelogVisibility(config: ChangelogVisibilityConfig): Promise<void> {
  try {
    await db
      .update(settings)
      .set({ changelogVisibilityConfig: JSON.stringify(config) })
      .execute()
    invalidateChangelogVisibilityCache()
  } catch (error) {
    log.error({ error, config }, 'Failed to update org changelog visibility config')
    throw new Error('Failed to update changelog visibility configuration', { cause: error })
  }
}

// ============================================
// Segment-Level Overrides
// ============================================

export async function getSegmentChangelogVisibility(
  segmentId: SegmentId
): Promise<ChangelogVisibilityConfig | null> {
  try {
    const row = await db.query.changelogSegmentVisibility.findFirst({
      where: eq(changelogSegmentVisibility.segmentId, segmentId),
    })
    if (!row) return null
    return {
      restrictCategories: row.restrictCategories,
      allowedCategoryIds: row.allowedCategoryIds,
      restrictProducts: row.restrictProducts,
      allowedProductIds: row.allowedProductIds,
    }
  } catch (error) {
    log.error({ error, segmentId }, 'Failed to fetch segment changelog visibility')
    return null
  }
}

export async function setSegmentChangelogVisibility(
  segmentId: SegmentId,
  config: ChangelogVisibilityConfig
): Promise<void> {
  try {
    const existing = await db.query.changelogSegmentVisibility.findFirst({
      where: eq(changelogSegmentVisibility.segmentId, segmentId),
      columns: { id: true },
    })
    const values = {
      restrictCategories: config.restrictCategories ?? false,
      allowedCategoryIds: config.allowedCategoryIds ?? [],
      restrictProducts: config.restrictProducts ?? false,
      allowedProductIds: config.allowedProductIds ?? [],
    }
    if (existing) {
      await db
        .update(changelogSegmentVisibility)
        .set(values)
        .where(eq(changelogSegmentVisibility.segmentId, segmentId))
        .execute()
    } else {
      await db
        .insert(changelogSegmentVisibility)
        .values({ segmentId, ...values })
        .execute()
    }
  } catch (error) {
    log.error({ error, segmentId, config }, 'Failed to set segment changelog visibility')
    throw new Error('Failed to update segment changelog visibility', { cause: error })
  }
}

export async function deleteSegmentChangelogVisibility(segmentId: SegmentId): Promise<void> {
  try {
    await db
      .delete(changelogSegmentVisibility)
      .where(eq(changelogSegmentVisibility.segmentId, segmentId))
      .execute()
  } catch (error) {
    log.error({ error, segmentId }, 'Failed to delete segment changelog visibility')
    throw new Error('Failed to delete segment changelog visibility', { cause: error })
  }
}

export async function getAllSegmentChangelogVisibilities(): Promise<
  Array<{
    segmentId: SegmentId
    segmentName: string
    config: ChangelogVisibilityConfig
  }>
> {
  try {
    const rows = await db
      .select({
        segmentId: changelogSegmentVisibility.segmentId,
        segmentName: segmentsTable.name,
        restrictCategories: changelogSegmentVisibility.restrictCategories,
        allowedCategoryIds: changelogSegmentVisibility.allowedCategoryIds,
        restrictProducts: changelogSegmentVisibility.restrictProducts,
        allowedProductIds: changelogSegmentVisibility.allowedProductIds,
      })
      .from(changelogSegmentVisibility)
      .innerJoin(segmentsTable, eq(changelogSegmentVisibility.segmentId, segmentsTable.id))
      .execute()
    return rows.map((row) => ({
      segmentId: row.segmentId as SegmentId,
      segmentName: row.segmentName,
      config: {
        restrictCategories: row.restrictCategories,
        allowedCategoryIds: row.allowedCategoryIds,
        restrictProducts: row.restrictProducts,
        allowedProductIds: row.allowedProductIds,
      },
    }))
  } catch (error) {
    log.error({ error }, 'Failed to fetch all segment changelog visibilities')
    return []
  }
}

// ============================================
// Effective Visibility (User-Level Resolution)
// ============================================

/**
 * Get the effective changelog visibility for a specific portal user.
 *
 * Returns:
 *   allowedCategoryIds — null = all categories visible; string[] = only these (+ uncategorized)
 *   allowedProductIds  — null = all products visible; string[] = only these (+ no-product)
 *
 * Algorithm:
 * 1. Get org-level default
 * 2. Get user's segment memberships
 * 3. Get per-segment visibility rows
 * 4. Merge using union (most permissive) logic
 */
export async function getEffectiveChangelogVisibilityForUser(userId: UserId): Promise<{
  allowedCategoryIds: string[] | null
  allowedProductIds: string[] | null
}> {
  try {
    const orgConfig = await getOrgChangelogVisibility()

    const userSegmentMemberships = await db
      .selectDistinct({ segmentId: userSegments.segmentId })
      .from(userSegments)
      .innerJoin(segmentsTable, eq(userSegments.segmentId, segmentsTable.id))
      .where(eq(userSegments.principalId, userId as any))
      .execute()

    if (userSegmentMemberships.length === 0) {
      return mergeChangelogVisibilityConfigs([orgConfig])
    }

    const segmentIds = userSegmentMemberships.map((m) => m.segmentId)
    const visibilityRows = await db.query.changelogSegmentVisibility.findMany({
      where: (t, { inArray }) => inArray(t.segmentId, segmentIds),
    })

    const segmentConfigs: ChangelogVisibilityConfig[] = visibilityRows.map((row) => ({
      restrictCategories: row.restrictCategories,
      allowedCategoryIds: row.allowedCategoryIds,
      restrictProducts: row.restrictProducts,
      allowedProductIds: row.allowedProductIds,
    }))

    return mergeChangelogVisibilityConfigs([orgConfig, ...segmentConfigs])
  } catch (error) {
    log.error({ error, userId }, 'Failed to get effective changelog visibility for user')
    return { allowedCategoryIds: null, allowedProductIds: null }
  }
}
