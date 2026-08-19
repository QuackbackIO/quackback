/**
 * Notification preference matrix - per-type x per-channel overrides.
 *
 * The matrix is intentionally string-keyed by notification type rather than
 * depending on the NotificationType enum, so adding a new notification type
 * never requires a schema/migration change here.
 *
 * Precedence (see shouldNotify):
 *   1. emailMuted is a global kill switch for the email and push channels
 *      only - it never affects inApp.
 *   2. An explicit matrix entry for (type, channel) wins.
 *   3. Legacy boolean fallback for the two legacy-mapped (type, email) pairs
 *      only, when no explicit matrix entry exists.
 *   4. Default to true.
 */

import type { NotificationPreferencesData } from './subscription.types'

export type NotificationChannel = 'inApp' | 'email' | 'push'

export type NotificationMatrix = Partial<
  Record<string, Partial<Record<NotificationChannel, boolean>>>
>

/**
 * Determine whether a notification of `type` should be delivered on
 * `channel`, given a member's stored preferences.
 */
export function shouldNotify(
  prefs: NotificationPreferencesData,
  type: string,
  channel: NotificationChannel
): boolean {
  // 1. emailMuted is a global kill switch for email + push only.
  if ((channel === 'email' || channel === 'push') && prefs.emailMuted) {
    return false
  }

  // 2. Explicit matrix entry wins.
  const explicit = prefs.matrix?.[type]?.[channel]
  if (typeof explicit === 'boolean') {
    return explicit
  }

  // 3. Legacy-boolean fallback for the two legacy-mapped (type, email) pairs.
  if (channel === 'email') {
    if (type === 'comment_created') {
      return prefs.emailNewComment
    }
    if (type === 'post_status_changed') {
      return prefs.emailStatusChange
    }
  }

  // 4. Default true.
  return true
}
