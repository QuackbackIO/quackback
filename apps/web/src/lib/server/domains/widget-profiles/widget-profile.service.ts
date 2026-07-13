/**
 * WidgetProfileService - Business logic for widget applications and their
 * per-environment profiles.
 *
 * A widget application is a stable public integration key for an external app.
 * Each application can have one active profile per environment. This module
 * holds the plain async logic (list + upsert) so both the TanStack server
 * functions (functions/widget-profiles.ts) and the REST routes under
 * /api/v1/widget-profiles can share a single implementation.
 */

import {
  and,
  asc,
  db,
  eq,
  isNull,
  widgetApplications,
  widgetEnvironmentProfiles,
  type WidgetProfileConfigOverrides,
  type WidgetProfileContentFilters,
  type WidgetProfileSupportConfig,
} from '@/lib/server/db'
import type { WidgetApplicationId, WidgetProfileId } from '@quackback/ids'

export type WidgetApplicationRow = typeof widgetApplications.$inferSelect
export type WidgetEnvironmentProfileRow = typeof widgetEnvironmentProfiles.$inferSelect
export type WidgetApplicationWithProfiles = WidgetApplicationRow & {
  profiles: WidgetEnvironmentProfileRow[]
}

/**
 * Normalize a host-supplied key / environment to the stored canonical form:
 * trimmed, lowercased, with disallowed characters collapsed to hyphens.
 */
export function normalizeWidgetKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '-')
}

export interface UpsertWidgetApplicationInput {
  id?: string
  key: string
  name: string
  description?: string | null
}

export interface UpsertWidgetEnvironmentProfileInput {
  id?: string
  applicationId: string
  environment: string
  displayName?: string
  enabled?: boolean
  allowedOrigins?: string[]
  configOverrides?: Record<string, unknown>
  contentFilters?: Record<string, unknown>
  supportConfig?: Record<string, unknown>
}

/**
 * List all active widget applications, each with its active environment
 * profiles, ordered by application name then environment.
 */
export async function listWidgetApplications(): Promise<WidgetApplicationWithProfiles[]> {
  const apps = await db.query.widgetApplications.findMany({
    where: isNull(widgetApplications.archivedAt),
    orderBy: [asc(widgetApplications.name)],
    with: {
      profiles: {
        where: isNull(widgetEnvironmentProfiles.archivedAt),
        orderBy: [asc(widgetEnvironmentProfiles.environment)],
      },
    },
  })
  return apps as WidgetApplicationWithProfiles[]
}

/**
 * Create or update a widget application. When `id` is supplied the matching
 * active row is updated; otherwise a new application is inserted. Returns the
 * persisted row, or null when an update targeted a missing/archived row.
 */
export async function upsertWidgetApplication(
  input: UpsertWidgetApplicationInput
): Promise<WidgetApplicationRow | null> {
  const patch = {
    key: normalizeWidgetKey(input.key),
    name: input.name.trim(),
    description: input.description?.trim() || null,
  }

  if (input.id) {
    const [updated] = await db
      .update(widgetApplications)
      .set(patch)
      .where(
        and(
          eq(widgetApplications.id, input.id as WidgetApplicationId),
          isNull(widgetApplications.archivedAt)
        )
      )
      .returning()
    return updated ?? null
  }

  const [created] = await db.insert(widgetApplications).values(patch).returning()
  return created
}

/**
 * Create or update a widget environment profile. When `id` is supplied the
 * matching active row is updated; otherwise a new profile is inserted. The
 * environment is normalized; an absent display name defaults to the
 * normalized environment. Returns the persisted row, or null when an update
 * targeted a missing/archived row.
 */
export async function upsertWidgetEnvironmentProfile(
  input: UpsertWidgetEnvironmentProfileInput
): Promise<WidgetEnvironmentProfileRow | null> {
  const environment = normalizeWidgetKey(input.environment)
  const patch = {
    applicationId: input.applicationId as WidgetApplicationId,
    environment,
    displayName: input.displayName?.trim() || environment,
    enabled: input.enabled ?? true,
    allowedOrigins: input.allowedOrigins ?? [],
    configOverrides: (input.configOverrides ?? {}) as WidgetProfileConfigOverrides,
    contentFilters: (input.contentFilters ?? {}) as WidgetProfileContentFilters,
    supportConfig: (input.supportConfig ?? {}) as WidgetProfileSupportConfig,
  }

  if (input.id) {
    const [updated] = await db
      .update(widgetEnvironmentProfiles)
      .set(patch)
      .where(
        and(
          eq(widgetEnvironmentProfiles.id, input.id as WidgetProfileId),
          isNull(widgetEnvironmentProfiles.archivedAt)
        )
      )
      .returning()
    return updated ?? null
  }

  const [created] = await db.insert(widgetEnvironmentProfiles).values(patch).returning()
  return created
}
