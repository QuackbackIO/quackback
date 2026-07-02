/**
 * PortalTabService - Business logic for portal tab visibility configuration
 *
 * Manages both organization-level defaults and segment-level overrides.
 * Uses in-process caching for performance (portal nav renders on every request).
 * Cache is invalidated when settings or segment overrides are written.
 */

import {
  db,
  eq,
  settings,
  userSegments,
  segments as segmentsTable,
  portalTabSegmentOverrides,
} from '@/lib/server/db'
import type { UserId, SegmentId } from '@quackback/ids'
import { logger } from '@/lib/server/logger'
import {
  type PortalTabConfig,
  parsePortalTabConfig,
  serializePortalTabConfig,
  getDefaultPortalTabConfig,
  mergeTabConfigs,
} from './types'

const log = logger.child({ component: 'portal-tabs' })

// ============================================
// Cache
// ============================================

let cachedOrgTabConfig: PortalTabConfig | null = null

/**
 * Invalidate the org-level tab config cache.
 * Call when settings.portal_tab_config is written.
 */
export function invalidatePortalTabConfigCache(): void {
  cachedOrgTabConfig = null
}

// ============================================
// Organization-Level Config
// ============================================

/**
 * Get the organization-level portal tab configuration (defaults).
 * Returns all tabs enabled if no config is set.
 * Uses in-process cache for performance.
 */
export async function getOrgPortalTabConfig(): Promise<PortalTabConfig> {
  if (cachedOrgTabConfig !== null) {
    return cachedOrgTabConfig
  }

  try {
    const rows = await db
      .select({ portalTabConfig: settings.portalTabConfig })
      .from(settings)
      .limit(1)

    const raw = rows[0]?.portalTabConfig
    const config = raw ? parsePortalTabConfig(raw) : getDefaultPortalTabConfig()

    cachedOrgTabConfig = config
    return config
  } catch (error) {
    log.error({ error }, 'Failed to fetch org portal tab config, returning defaults')
    return getDefaultPortalTabConfig()
  }
}

/**
 * Update the organization-level portal tab configuration.
 * Invalidates cache after write.
 */
export async function setOrgPortalTabConfig(config: PortalTabConfig): Promise<void> {
  try {
    const serialized = serializePortalTabConfig(config)
    await db.update(settings).set({ portalTabConfig: serialized }).execute()

    invalidatePortalTabConfigCache()
  } catch (error) {
    log.error({ error, config }, 'Failed to update org portal tab config')
    throw new Error('Failed to update portal tab configuration', { cause: error })
  }
}

// ============================================
// Segment-Level Overrides
// ============================================

/**
 * Get segment-level overrides for a specific segment.
 * Returns null if no overrides exist.
 */
export async function getSegmentTabOverrides(
  segmentId: SegmentId
): Promise<PortalTabConfig | null> {
  try {
    const row = await db.query.portalTabSegmentOverrides.findFirst({
      where: eq(portalTabSegmentOverrides.segmentId, segmentId),
      columns: { overrides: true },
    })

    if (!row) return null
    return parsePortalTabConfig(JSON.stringify(row.overrides))
  } catch (error) {
    log.error({ error, segmentId }, 'Failed to fetch segment tab overrides')
    return null
  }
}

/**
 * Set or update segment-level tab overrides.
 * Creates or updates the override record.
 */
export async function setSegmentTabOverrides(
  segmentId: SegmentId,
  overrides: PortalTabConfig
): Promise<void> {
  try {
    const existing = await db.query.portalTabSegmentOverrides.findFirst({
      where: eq(portalTabSegmentOverrides.segmentId, segmentId),
      columns: { id: true },
    })

    if (existing) {
      await db
        .update(portalTabSegmentOverrides)
        .set({ overrides })
        .where(eq(portalTabSegmentOverrides.segmentId, segmentId))
        .execute()
    } else {
      await db
        .insert(portalTabSegmentOverrides)
        .values({
          segmentId,
          overrides,
        })
        .execute()
    }
  } catch (error) {
    log.error({ error, segmentId, overrides }, 'Failed to set segment tab overrides')
    throw new Error('Failed to update segment portal tab configuration', { cause: error })
  }
}

/**
 * Delete segment-level tab overrides (revert to org defaults).
 */
export async function deleteSegmentTabOverrides(segmentId: SegmentId): Promise<void> {
  try {
    await db
      .delete(portalTabSegmentOverrides)
      .where(eq(portalTabSegmentOverrides.segmentId, segmentId))
      .execute()
  } catch (error) {
    log.error({ error, segmentId }, 'Failed to delete segment tab overrides')
    throw new Error('Failed to delete segment portal tab configuration', { cause: error })
  }
}

// ============================================
// Effective Config (User-Level Resolution)
// ============================================

/**
 * Get the effective portal tab configuration for a specific user.
 *
 * Algorithm:
 * 1. Start with org-level defaults
 * 2. For each segment the user belongs to, fetch its overrides
 * 3. Merge all overrides using union logic (any segment enabling a tab makes it visible)
 * 4. Return the merged result
 *
 * This ensures users see the most permissive configuration across their segments.
 */
export async function getEffectiveTabConfigForUser(userId: UserId): Promise<PortalTabConfig> {
  try {
    // Fetch org-level defaults
    const orgConfig = await getOrgPortalTabConfig()

    // Fetch user's segment memberships
    const userSegmentMemberships = await db
      .selectDistinct({ segmentId: userSegments.segmentId })
      .from(userSegments)
      .innerJoin(segmentsTable, eq(userSegments.segmentId, segmentsTable.id))
      .where(eq(userSegments.principalId, userId as any))
      .execute()

    if (userSegmentMemberships.length === 0) {
      // User has no segments, return org defaults
      return orgConfig
    }

    // Fetch overrides for all user's segments
    const segmentIds = userSegmentMemberships.map((m) => m.segmentId)
    const overrideRecords = await db.query.portalTabSegmentOverrides.findMany({
      where: (t, { inArray }) => inArray(t.segmentId, segmentIds),
      columns: { overrides: true },
    })

    if (overrideRecords.length === 0) {
      // User has segments but no overrides, return org defaults
      return orgConfig
    }

    // Merge org config with all segment overrides using union logic
    const allConfigs = [
      orgConfig,
      ...overrideRecords.map((r) => parsePortalTabConfig(JSON.stringify(r.overrides))),
    ]

    return mergeTabConfigs(...allConfigs)
  } catch (error) {
    log.error({ error, userId }, 'Failed to get effective tab config for user, returning defaults')
    return getDefaultPortalTabConfig()
  }
}

/**
 * Get all segment overrides for display/management.
 * Used by admin UI to show which segments have custom configs.
 */
export async function getAllSegmentTabOverrides(): Promise<
  Array<{ segmentId: SegmentId; segmentName: string; overrides: PortalTabConfig }>
> {
  try {
    const rows = await db
      .select({
        segmentId: portalTabSegmentOverrides.segmentId,
        segmentName: segmentsTable.name,
        overrides: portalTabSegmentOverrides.overrides,
      })
      .from(portalTabSegmentOverrides)
      .innerJoin(segmentsTable, eq(portalTabSegmentOverrides.segmentId, segmentsTable.id))
      .execute()

    return rows.map((row) => ({
      segmentId: row.segmentId as SegmentId,
      segmentName: row.segmentName,
      overrides: parsePortalTabConfig(JSON.stringify(row.overrides)),
    }))
  } catch (error) {
    log.error({ error }, 'Failed to fetch all segment tab overrides')
    return []
  }
}
