/**
 * Server reads that a settings page owned by a narrower permission needs, and
 * the permissions any one of which passes each. Pure and client-safe: the
 * server functions enforce them, and settings-page-access.test.ts reads them
 * to check each page's gate against its reads.
 */
import { PERMISSIONS, type PermissionKey } from './permissions'

/**
 * The GitHub issues channel's connection status: read by Settings > Support >
 * GitHub (channel_account.manage) and the Channels hub (settings.manage).
 */
export const GITHUB_CHANNEL_STATUS_READ_PERMISSIONS: readonly PermissionKey[] = [
  PERMISSIONS.SETTINGS_MANAGE,
  PERMISSIONS.CHANNEL_ACCOUNT_MANAGE,
]

/** Who reads the workspace moderation default (Settings > Moderation). */
export const PORTAL_MODERATION_READ_PERMISSIONS: readonly PermissionKey[] = [
  PERMISSIONS.SETTINGS_MANAGE,
  PERMISSIONS.SETTINGS_MODERATION,
]

/** Who reads the portal's tabs and welcome message (Settings > Portal > Design). */
export const PORTAL_DESIGN_READ_PERMISSIONS: readonly PermissionKey[] = [
  PERMISSIONS.SETTINGS_MANAGE,
  PERMISSIONS.SETTINGS_BRANDING,
]

/**
 * Who saves the portal's tabs and welcome message (`updatePortalDesignFn`):
 * the Design tab's own permission or settings.manage. Nothing else of the
 * portal config saves with settings.branding.
 */
export const PORTAL_DESIGN_WRITE_PERMISSIONS: readonly PermissionKey[] = [
  PERMISSIONS.SETTINGS_MANAGE,
  PERMISSIONS.SETTINGS_BRANDING,
]

/**
 * The portal page config read (`fetchPortalPageConfigFn`): any one of these
 * passes, and each viewer gets only the parts their permissions read.
 */
export const PORTAL_PAGE_CONFIG_READ_PERMISSIONS: readonly PermissionKey[] = [
  PERMISSIONS.SETTINGS_MANAGE,
  PERMISSIONS.SETTINGS_MODERATION,
  PERMISSIONS.SETTINGS_BRANDING,
]
