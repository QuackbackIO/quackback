import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
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
import { requireAuth } from './auth-helpers'
import { toIsoString, toIsoStringOrNull } from '@/lib/shared/utils/date'
import type { WidgetApplicationId, WidgetProfileId } from '@quackback/ids'

function normalizeKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '-')
}

type JsonObject = Record<string, any>

function serializeProfile(profile: typeof widgetEnvironmentProfiles.$inferSelect) {
  return {
    id: profile.id,
    applicationId: profile.applicationId,
    environment: profile.environment,
    displayName: profile.displayName,
    enabled: profile.enabled,
    allowedOrigins: profile.allowedOrigins,
    configOverrides: profile.configOverrides as JsonObject,
    contentFilters: profile.contentFilters as JsonObject,
    supportConfig: profile.supportConfig as JsonObject,
    archivedAt: toIsoStringOrNull(profile.archivedAt),
    createdAt: toIsoString(profile.createdAt),
    updatedAt: toIsoString(profile.updatedAt),
  }
}

function serializeApplication(
  app: typeof widgetApplications.$inferSelect & {
    profiles?: Array<typeof widgetEnvironmentProfiles.$inferSelect>
  }
) {
  return {
    id: app.id,
    key: app.key,
    name: app.name,
    description: app.description,
    archivedAt: toIsoStringOrNull(app.archivedAt),
    createdAt: toIsoString(app.createdAt),
    updatedAt: toIsoString(app.updatedAt),
    profiles: (app.profiles ?? []).map(serializeProfile),
  }
}

const jsonRecord = z.record(z.string(), z.unknown())

const applicationSchema = z.object({
  id: z.string().optional(),
  key: z.string().min(1).max(120),
  name: z.string().min(1).max(200),
  description: z.string().max(1000).nullable().optional(),
})

const profileSchema = z.object({
  id: z.string().optional(),
  applicationId: z.string().min(1),
  environment: z.string().min(1).max(80),
  displayName: z.string().min(1).max(200).optional(),
  enabled: z.boolean().optional(),
  allowedOrigins: z.array(z.string().min(1).max(300)).optional(),
  configOverrides: jsonRecord.optional(),
  contentFilters: jsonRecord.optional(),
  supportConfig: jsonRecord.optional(),
})

export const listWidgetApplicationsFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuth({ roles: ['admin'] })
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
  return apps.map(serializeApplication)
})

export const upsertWidgetApplicationFn = createServerFn({ method: 'POST' })
  .inputValidator(applicationSchema)
  .handler(async ({ data }) => {
    await requireAuth({ roles: ['admin'] })
    const patch = {
      key: normalizeKey(data.key),
      name: data.name.trim(),
      description: data.description?.trim() || null,
    }

    if (data.id) {
      const [updated] = await db
        .update(widgetApplications)
        .set(patch)
        .where(
          and(
            eq(widgetApplications.id, data.id as WidgetApplicationId),
            isNull(widgetApplications.archivedAt)
          )
        )
        .returning()
      return updated ? serializeApplication(updated) : null
    }

    const [created] = await db.insert(widgetApplications).values(patch).returning()
    return serializeApplication(created)
  })

export const upsertWidgetEnvironmentProfileFn = createServerFn({ method: 'POST' })
  .inputValidator(profileSchema)
  .handler(async ({ data }) => {
    await requireAuth({ roles: ['admin'] })
    const environment = normalizeKey(data.environment)
    const patch = {
      applicationId: data.applicationId as WidgetApplicationId,
      environment,
      displayName: data.displayName?.trim() || environment,
      enabled: data.enabled ?? true,
      allowedOrigins: data.allowedOrigins ?? [],
      configOverrides: (data.configOverrides ?? {}) as WidgetProfileConfigOverrides,
      contentFilters: (data.contentFilters ?? {}) as WidgetProfileContentFilters,
      supportConfig: (data.supportConfig ?? {}) as WidgetProfileSupportConfig,
    }

    if (data.id) {
      const [updated] = await db
        .update(widgetEnvironmentProfiles)
        .set(patch)
        .where(
          and(
            eq(widgetEnvironmentProfiles.id, data.id as WidgetProfileId),
            isNull(widgetEnvironmentProfiles.archivedAt)
          )
        )
        .returning()
      return updated ? serializeProfile(updated) : null
    }

    const [created] = await db.insert(widgetEnvironmentProfiles).values(patch).returning()
    return serializeProfile(created)
  })
