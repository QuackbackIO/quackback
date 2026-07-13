import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { widgetApplications, widgetEnvironmentProfiles } from '@/lib/server/db'
import {
  listWidgetApplications,
  upsertWidgetApplication,
  upsertWidgetEnvironmentProfile,
} from '@/lib/server/domains/widget-profiles/widget-profile.service'
import { requireAuth } from './auth-helpers'
import { toIsoString, toIsoStringOrNull } from '@/lib/shared/utils/date'

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
  const apps = await listWidgetApplications()
  return apps.map(serializeApplication)
})

export const upsertWidgetApplicationFn = createServerFn({ method: 'POST' })
  .inputValidator(applicationSchema)
  .handler(async ({ data }) => {
    await requireAuth({ roles: ['admin'] })
    const application = await upsertWidgetApplication(data)
    return application ? serializeApplication(application) : null
  })

export const upsertWidgetEnvironmentProfileFn = createServerFn({ method: 'POST' })
  .inputValidator(profileSchema)
  .handler(async ({ data }) => {
    await requireAuth({ roles: ['admin'] })
    const profile = await upsertWidgetEnvironmentProfile(data)
    return profile ? serializeProfile(profile) : null
  })
