/**
 * Shared serializers for widget-profiles API responses (colocated route helper;
 * the `-` prefix keeps it out of the generated route tree).
 */
import { toIsoString, toIsoStringOrNull } from '@/lib/shared/utils/date'
import type {
  WidgetApplicationRow,
  WidgetApplicationWithProfiles,
  WidgetEnvironmentProfileRow,
} from '@/lib/server/domains/widget-profiles/widget-profile.service'

type JsonObject = Record<string, unknown>

export function serializeWidgetEnvironmentProfile(profile: WidgetEnvironmentProfileRow) {
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

export function serializeWidgetApplication(
  app: WidgetApplicationRow & { profiles?: WidgetEnvironmentProfileRow[] }
) {
  return {
    id: app.id,
    key: app.key,
    name: app.name,
    description: app.description,
    archivedAt: toIsoStringOrNull(app.archivedAt),
    createdAt: toIsoString(app.createdAt),
    updatedAt: toIsoString(app.updatedAt),
    profiles: (app.profiles ?? []).map(serializeWidgetEnvironmentProfile),
  }
}

export function serializeWidgetApplicationWithProfiles(app: WidgetApplicationWithProfiles) {
  return serializeWidgetApplication(app)
}
