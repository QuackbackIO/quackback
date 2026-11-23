import { db, eq, principal, type Database, type Transaction } from '@/lib/server/db'
import type { Actor } from '@/lib/server/policy/types'
import { permissionsForPrincipal } from '@/lib/server/policy/permissions'
import type { PermissionKey } from '@/lib/shared/permissions'
import { SETTINGS_AREA_META } from '@/lib/shared/settings-registry'
import { ForbiddenError, ValidationError } from '@/lib/shared/errors'
import { settingsAreaSchema, type SettingsArea } from '@/lib/shared/assistant/settings-proposals'
import { resolveOfficeHoursSchedule } from '@/lib/server/domains/settings/settings.office-hours'
import { resolveChangelogSettings } from '@/lib/server/domains/settings/settings.changelog'
import {
  parseJsonOrNull,
  parseWidgetConfig,
  requireSettings,
  type SettingsRecord,
} from '@/lib/server/domains/settings/settings.helpers'
import { resolveFeatureFlags } from '@/lib/server/domains/settings/settings.types'
import { getPublicUrlOrNull } from '@/lib/server/storage/s3'
import { isWidgetMessengerEnabled } from '@/lib/shared/support-surfaces'
import { expandTheme } from '@/lib/shared/theme/expand'
import { PICKED_KEYS } from '@/lib/shared/theme/base'
import type { ThemeConfig } from '@/lib/shared/theme/types'
import { parseIdentityProjection } from '@/lib/server/domains/settings/cloud/identity-projection'

/** Each area's write permission and page, read from the settings registry. */
export const AREAS: Record<SettingsArea, { permission: PermissionKey; href: string }> =
  Object.fromEntries(
    Object.entries(SETTINGS_AREA_META).map(([id, meta]) => [
      id,
      { permission: meta.permission, href: meta.href },
    ])
  ) as Record<SettingsArea, { permission: PermissionKey; href: string }>

export function assertWorkspaceNameWritable(row: SettingsRecord): void {
  if (parseIdentityProjection(row.cloudIdentity))
    throw new ValidationError(
      'SETTINGS_NAME_MANAGED',
      'Open General settings to change this workspace name. Use navigate_workspace with destination general.'
    )
}

/** Resolve permissions again so an open card cannot retain revoked authority. */
export async function requireAreaPermission(
  actor: Actor,
  area: SettingsArea,
  executor: Database | Transaction,
  requiredPermission: PermissionKey = AREAS[area].permission
) {
  if (!actor.principalId)
    throw new ForbiddenError(
      'SETTINGS_PERMISSION_REQUIRED',
      'Ask a workspace owner to make this change.'
    )
  const [record] = await executor
    .select({ role: principal.role })
    .from(principal)
    .where(eq(principal.id, actor.principalId))
    .limit(1)
  if (!record || (record.role !== 'admin' && record.role !== 'member'))
    throw new ForbiddenError(
      'SETTINGS_PERMISSION_REQUIRED',
      'Ask a workspace owner to make this change.'
    )
  const permissions = await permissionsForPrincipal(actor.principalId, record.role, executor)
  if (
    !permissions.has(requiredPermission) ||
    (actor.permissions !== undefined && !actor.permissions.has(requiredPermission))
  )
    throw new ForbiddenError(
      'SETTINGS_PERMISSION_REQUIRED',
      'Ask a workspace owner to make this change.'
    )
}

/**
 * A theme side as a change reads it: every variable expanded, and each
 * colour as picked where it is drawn otherwise (a change sets the colour
 * picked; the picked-colour variables themselves are never shown).
 */
function shownSide(side: ThemeConfig['light'], mode: 'light' | 'dark'): Record<string, unknown> {
  const out: Record<string, unknown> = { ...side, ...expandTheme(side ?? {}, { mode }) }
  for (const [key, picked] of Object.entries(PICKED_KEYS)) {
    if (side?.[picked]) out[key] = side[picked]
    delete out[picked]
  }
  return out
}

export function areaValues(row: SettingsRecord, area: SettingsArea): Record<string, unknown> {
  switch (area) {
    case 'branding': {
      const config = parseJsonOrNull<ThemeConfig>(row.brandingConfig) ?? {}
      return {
        ...config,
        themeMode: config.themeMode ?? 'user',
        light: shownSide(config.light, 'light'),
        dark: shownSide(config.dark, 'dark'),
        logoKey: row.logoKey,
      }
    }
    case 'portal':
      return { displayName: parseIdentityProjection(row.cloudIdentity)?.displayName ?? row.name }
    case 'messenger': {
      const widget = parseWidgetConfig(row.widgetConfig)
      return {
        enabled: isWidgetMessengerEnabled(resolveFeatureFlags(row.featureFlags), widget),
        welcomeMessage: widget.messenger?.welcomeMessage ?? '',
      }
    }
    case 'modules': {
      const flags = resolveFeatureFlags(row.featureFlags)
      return {
        supportInbox: flags.supportInbox,
        supportTickets: flags.supportTickets,
        helpCenter: flags.helpCenter,
        statusPage: flags.statusPage,
      }
    }
    case 'office_hours':
      return { ...resolveOfficeHoursSchedule(row.metadata, row.widgetConfig) }
    case 'changelog': {
      const config = resolveChangelogSettings(row.metadata)
      return {
        audience: config.audience,
        autoSubscribe: config.autoSubscribe,
        emailsDisabled: config.emailsDisabled,
      }
    }
  }
}
export async function getSettingsForActor(
  actor: Actor,
  area: SettingsArea,
  executor: Database | Transaction = db
) {
  settingsAreaSchema.parse(area)
  await requireAreaPermission(actor, area, executor)
  const row = await requireSettings(executor)
  const managedName = area === 'portal' && parseIdentityProjection(row.cloudIdentity) !== null
  return {
    area,
    settings: areaValues(row, area),
    // An operator-managed name is shown, read-only, on General.
    settingsHref: managedName ? '/admin/settings/general' : AREAS[area].href,
    ...(area === 'portal' ? { readOnly: managedName } : {}),
    ...(area === 'branding' ? { logoUrl: getPublicUrlOrNull(row.logoKey) } : {}),
  }
}
