import { db, eq, principal, type Database, type Transaction } from '@/lib/server/db'
import type { Actor } from '@/lib/server/policy/types'
import { permissionsForPrincipal } from '@/lib/server/policy/permissions'
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'
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
import type { ThemeConfig } from '@/lib/shared/theme/types'
import { parseIdentityProjection } from '@/lib/server/domains/settings/cloud/identity-projection'

export const AREAS: Record<SettingsArea, { permission: PermissionKey; href: string }> = {
  branding: { permission: PERMISSIONS.SETTINGS_BRANDING, href: '/admin/settings/portal' },
  // Portal settings opens with the branding permission alone.
  portal: { permission: PERMISSIONS.SETTINGS_BRANDING, href: '/admin/settings/portal' },
  messenger: {
    permission: PERMISSIONS.SETTINGS_MANAGE,
    href: '/admin/settings/channels/messenger',
  },
  modules: { permission: PERMISSIONS.SETTINGS_MANAGE, href: '/admin/settings/general' },
  office_hours: {
    permission: PERMISSIONS.OFFICE_HOURS_MANAGE,
    href: '/admin/settings/office-hours',
  },
  changelog: { permission: PERMISSIONS.CHANGELOG_MANAGE, href: '/admin/settings/changelog' },
}

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

export function areaValues(row: SettingsRecord, area: SettingsArea): Record<string, unknown> {
  switch (area) {
    case 'branding': {
      const config = parseJsonOrNull<ThemeConfig>(row.brandingConfig) ?? {}
      return {
        ...config,
        themeMode: config.themeMode ?? 'user',
        light: { ...config.light, ...expandTheme(config.light ?? {}, { mode: 'light' }) },
        dark: { ...config.dark, ...expandTheme(config.dark ?? {}, { mode: 'dark' }) },
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
