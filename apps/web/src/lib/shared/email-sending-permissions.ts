import { PERMISSIONS, type PermissionKey } from './permissions'

/**
 * Who may change how a workspace sends email. Sending addresses, their domains
 * and the From of every kind of customer email are workspace settings, whatever
 * products are on, so they belong to the workspace settings permission rather
 * than to Support.
 */
export const EMAIL_SENDING_PERMISSION = PERMISSIONS.SETTINGS_MANAGE

/**
 * Who may choose where support replies come from: an admin, or whoever runs the
 * support inbox. The one sender a support lead may change.
 */
export const SUPPORT_SENDER_PERMISSIONS = [
  PERMISSIONS.SETTINGS_MANAGE,
  PERMISSIONS.CHANNEL_ACCOUNT_MANAGE,
] as const satisfies readonly PermissionKey[]

/**
 * Who may read the address a kind of email is sent from: an admin, or whoever
 * manages the product that sends it, so its settings page can say.
 */
export const SURFACE_SENDER_READ_PERMISSIONS = {
  support: SUPPORT_SENDER_PERMISSIONS,
  feedback: [PERMISSIONS.SETTINGS_MANAGE, PERMISSIONS.BOARD_MANAGE],
  changelog: [PERMISSIONS.SETTINGS_MANAGE, PERMISSIONS.CHANGELOG_MANAGE],
  status: [PERMISSIONS.SETTINGS_MANAGE, PERMISSIONS.STATUS_PAGE_MANAGE],
} as const satisfies Record<string, readonly PermissionKey[]>
