import { PERMISSIONS, type PermissionKey } from './permissions'

/**
 * Who can open the Domains page: a holder of any permission that owns one of
 * the kinds of domain it lists (web addresses, email sending, sign-in).
 * Kept apart from the settings nav so a route loader can read it without
 * pulling the page registry into the app entry.
 */
export const DOMAINS_PAGE_PERMISSIONS = [
  PERMISSIONS.SETTINGS_CUSTOM_DOMAIN,
  PERMISSIONS.CHANNEL_ACCOUNT_MANAGE,
  PERMISSIONS.AUTH_MANAGE,
] as const satisfies readonly PermissionKey[]
