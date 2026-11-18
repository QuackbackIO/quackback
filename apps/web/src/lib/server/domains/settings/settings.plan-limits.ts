/**
 * The `settings.plan_limits_state` column: the only reader and writer.
 *
 * The column holds the plan limits state as JSON (its shape is owned by
 * `domains/plan-limits/plan-limits.rules.ts`). These helpers move raw values;
 * the plan-limits domain parses and validates them.
 */
import { db, eq, settings, sql } from '@/lib/server/db'
import type {
  StoredCloudConfig,
  StoredCloudIdentityProjection,
  StoredPlanLimitsState,
} from '@/lib/shared/db-types'
import { findSettingsCached, invalidateSettingsCache, parseJsonConfig } from './settings.helpers'
import { DEFAULT_HELP_CENTER_CONFIG } from './settings.types'

/** What the plan limits state is computed from, off the cached settings row. */
export interface PlanLimitsSources {
  /** The stored state, raw. Null when there is none. */
  planLimitsState: unknown
  tierLimits: string | null
  cloud: StoredCloudConfig | null
  cloudIdentity: StoredCloudIdentityProjection | null
  customCss: string | null
  helpCenterDomain: string | null
  autoTranslate: boolean
}

export async function readPlanLimitsSources(): Promise<PlanLimitsSources | null> {
  const row = await findSettingsCached()
  if (!row) return null
  const helpCenter = parseJsonConfig(row.helpCenterConfig, DEFAULT_HELP_CENTER_CONFIG)
  return {
    planLimitsState: row.planLimitsState ?? null,
    tierLimits: row.tierLimits ?? null,
    cloud: row.cloud ?? null,
    cloudIdentity: row.cloudIdentity ?? null,
    customCss: row.customCss ?? null,
    helpCenterDomain: helpCenter.domain?.domain ?? null,
    autoTranslate: helpCenter.autoTranslate?.enabled === true,
  }
}

/** The stored state straight from the database, for a caller that lost a race. */
export async function readPlanLimitsStateFresh(): Promise<unknown> {
  const [row] = await db.select({ state: settings.planLimitsState }).from(settings).limit(1)
  return row?.state ?? null
}

/**
 * Write `next` only if the column still holds `expected`, so two processes
 * detecting the same drop at once cannot both start a grace and move its
 * dates. Returns whether this write won.
 */
export async function compareAndSetPlanLimitsState(
  expected: unknown,
  next: StoredPlanLimitsState | null
): Promise<boolean> {
  const expectedJson = expected === null || expected === undefined ? null : JSON.stringify(expected)
  const nextValue = next === null ? null : sql`${JSON.stringify(next)}::jsonb`
  const updated = await db
    .update(settings)
    .set({ planLimitsState: nextValue as unknown as StoredPlanLimitsState | null })
    .where(
      expectedJson === null
        ? sql`${settings.planLimitsState} IS NULL`
        : sql`${settings.planLimitsState} = ${expectedJson}::jsonb`
    )
    .returning({ id: settings.id })
  if (updated.length > 0) await invalidateSettingsCache()
  return updated.length > 0
}

/**
 * Change the stored state under the row lock. `change` gets the current raw
 * value and returns the next one, or undefined to leave it as it is.
 */
export async function updatePlanLimitsState(
  change: (current: unknown) => StoredPlanLimitsState | null | undefined
): Promise<boolean> {
  const wrote = await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ id: settings.id, state: settings.planLimitsState })
      .from(settings)
      .limit(1)
      .for('update')
    if (!row) return false
    const next = change(row.state ?? null)
    if (next === undefined) return false
    await tx.update(settings).set({ planLimitsState: next }).where(eq(settings.id, row.id))
    return true
  })
  if (wrote) await invalidateSettingsCache()
  return wrote
}
