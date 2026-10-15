/**
 * The settings registry's pure half: what each area is, how risky a change to
 * it is, who may read and write it, and the shapes of its value and its patch.
 *
 * The app, the REST API and MCP all read this one table, so an area's risk,
 * permission and schemas cannot differ between them. The server half
 * (`domains/settings-registry`) adds the handlers that read, apply and undo.
 */
import { z } from 'zod'
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'
import { officeHoursScheduleSchema } from '@/lib/shared/office-hours'
import { settingsPatchSchemas, type SettingsArea } from '@/lib/shared/assistant/settings-proposals'

export {
  SETTINGS_AREAS,
  settingsAreaSchema,
  type SettingsArea,
} from '@/lib/shared/assistant/settings-proposals'

export const SETTINGS_RISKS = ['low', 'medium', 'high', 'critical'] as const
export type SettingsRisk = (typeof SETTINGS_RISKS)[number]

export interface SettingsAreaMeta {
  id: SettingsArea
  title: string
  description: string
  /**
   * A low-risk change applies at once. Medium and above is filed as an
   * approval and applied when a qualified person decides it.
   */
  risk: SettingsRisk
  /** Needed to read the area and to write it. Reading is never wider than writing. */
  permission: PermissionKey
  /** The page in the app that edits the area. */
  href: string
}

/**
 * What customers see or are emailed about (Messenger, product modules,
 * changelog email) is medium. Branding, the workspace name and hours are low.
 */
export const SETTINGS_AREA_META: Record<SettingsArea, SettingsAreaMeta> = {
  branding: {
    id: 'branding',
    title: 'Branding',
    description: 'Theme mode and the light and dark colors, font and radius.',
    risk: 'low',
    permission: PERMISSIONS.SETTINGS_BRANDING,
    href: '/admin/settings/portal',
  },
  portal: {
    id: 'portal',
    title: 'Workspace name',
    description: 'The name shown across the portal.',
    risk: 'low',
    // Portal settings opens with the branding permission alone.
    permission: PERMISSIONS.SETTINGS_BRANDING,
    href: '/admin/settings/portal',
  },
  office_hours: {
    id: 'office_hours',
    title: 'Office hours',
    description: 'When the team is available: timezone, weekly intervals and holidays.',
    risk: 'low',
    permission: PERMISSIONS.OFFICE_HOURS_MANAGE,
    href: '/admin/settings/hours-sla',
  },
  messenger: {
    id: 'messenger',
    title: 'Messenger',
    description: 'Whether the customer Messenger is on, and its welcome message.',
    risk: 'medium',
    permission: PERMISSIONS.SETTINGS_MANAGE,
    href: '/admin/settings/channels/messenger',
  },
  modules: {
    id: 'modules',
    title: 'Modules',
    description: 'Which products are on: support inbox, tickets, help center and status page.',
    risk: 'medium',
    permission: PERMISSIONS.SETTINGS_MANAGE,
    href: '/admin/settings/general',
  },
  changelog: {
    id: 'changelog',
    title: 'Changelog',
    description: 'Who can read the changelog and whether it sends email.',
    risk: 'medium',
    permission: PERMISSIONS.CHANGELOG_MANAGE,
    href: '/admin/settings/changelog',
  },
}

const themeVariables = z.record(z.string(), z.unknown())

/** The value of each area, as the registry reads it. */
export const settingsReadSchemas = {
  branding: z.object({
    themeMode: z.enum(['light', 'dark', 'user']),
    light: themeVariables,
    dark: themeVariables,
    /** Read-only here; a logo is chosen on the branding page. */
    logoKey: z.string().nullable(),
  }),
  portal: z.object({ displayName: z.string() }),
  messenger: z.object({ enabled: z.boolean(), welcomeMessage: z.string() }),
  modules: z.object({
    supportInbox: z.boolean(),
    supportTickets: z.boolean(),
    helpCenter: z.boolean(),
    statusPage: z.boolean(),
  }),
  office_hours: officeHoursScheduleSchema,
  changelog: z.object({
    audience: z.enum(['public', 'authenticated']),
    autoSubscribe: z.boolean(),
    emailsDisabled: z.boolean(),
  }),
} as const satisfies Record<SettingsArea, z.ZodType>

/** The merge patch each area accepts. */
export const settingsAreaPatchSchemas = settingsPatchSchemas

/** Any area's patch, for a surface that names the area in a separate field. */
export const settingsAnyAreaPatchSchema = z.union([
  settingsPatchSchemas.branding,
  settingsPatchSchemas.portal,
  settingsPatchSchemas.messenger,
  settingsPatchSchemas.modules,
  settingsPatchSchemas.office_hours,
  settingsPatchSchemas.changelog,
])

/** A field an operator or the config file holds, so no one may change it here. */
export const lockedFieldSchema = z.object({
  field: z.string(),
  reason: z.enum(['config_file', 'operator']),
})
export type LockedField = z.infer<typeof lockedFieldSchema>

export const settingsChangeEntrySchema = z.object({
  path: z.array(z.string()),
  before: z.unknown(),
  after: z.unknown(),
})
export type SettingsChangeEntry = z.infer<typeof settingsChangeEntrySchema>

/** A receipt id: an audit row for a direct write, an approval for one a person decided. */
export const settingsReceiptIdSchema = z
  .string()
  .regex(/^(?:audit|assistant_action)_[0-9a-z]{26}$/, 'Not a settings receipt id')

/** What a write did, with the values before and after. */
export const settingsReceiptSchema = z.object({
  id: settingsReceiptIdSchema,
  area: z.string(),
  appliedAt: z.string(),
  revision: z.string(),
  changes: z.array(settingsChangeEntrySchema),
  before: z.record(z.string(), z.unknown()),
  after: z.record(z.string(), z.unknown()),
  undoable: z.boolean(),
})
export type SettingsReceipt = z.infer<typeof settingsReceiptSchema>
