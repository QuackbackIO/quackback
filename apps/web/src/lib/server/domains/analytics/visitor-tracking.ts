/**
 * Visitor tracking for the embedded widget: whether this workspace's plan
 * includes it, and which of the two per-workspace switches apply on top.
 *
 * Plan entitlement is a `visitorAnalytics` tier feature (see
 * tier-limits.types.ts). The two switches are widget settings the admin sets:
 * counting host-page views, and remembering returning visitors with a durable
 * device id. Both are sent to embeds only when the plan includes the feature.
 *
 * Defaults: an absent switch is on. Every plan includes visitor analytics, so
 * an absent switch resolves to on for every workspace the feature reaches.
 */
import { getTierLimits } from '@/lib/server/domains/settings/tier-limits.service'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'visitor-tracking' })

/**
 * Whether the workspace's plan includes visitor analytics. Fails closed: if
 * the limits cannot be read, nothing is counted.
 */
export async function isVisitorAnalyticsEntitled(): Promise<boolean> {
  try {
    const limits = await getTierLimits()
    return limits.features.visitorAnalytics === true
  } catch (error) {
    log.error({ err: error }, 'tier limits unreadable, visitor analytics off for this request')
    return false
  }
}

export interface VisitorTrackingSettings {
  /** The workspace's plan includes visitor analytics. */
  entitled: boolean
  /** Stored `visitorAnalytics` switch; undefined when never set. */
  analytics?: boolean
  /** Stored `visitorDeviceTracking` switch; undefined when never set. */
  deviceId?: boolean
}

/**
 * Resolve the two flags the widget SDK receives. Nothing is on unless the plan
 * includes the feature. Device tracking needs page-view counting on.
 */
export function resolveVisitorTracking(settings: VisitorTrackingSettings): {
  analytics: boolean
  deviceTracking: boolean
} {
  const analytics = settings.entitled && (settings.analytics ?? true)
  return { analytics, deviceTracking: analytics && (settings.deviceId ?? true) }
}
