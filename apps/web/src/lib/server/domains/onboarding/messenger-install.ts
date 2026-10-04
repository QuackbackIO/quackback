/**
 * Putting Messenger on the customer's site: what the install sheet reads and
 * does. Detection rides the evidence the public widget endpoints already
 * record (`observeExternalWidgetRequest`); this reads it uncached, because the
 * sheet waits for the moment it first appears.
 */
import { db, settings } from '@/lib/server/db'
import { isTeamMember } from '@/lib/shared/roles'
import { ValidationError } from '@/lib/shared/errors'
import { incrementBucket } from '@/lib/server/utils/rate-bucket'
import { logger } from '@/lib/server/logger'
import { parseWidgetConfig } from '@/lib/server/domains/settings/settings.helpers'
import {
  updateWidgetConfig,
  widgetActivationConfig,
} from '@/lib/server/domains/settings/settings.widget'

const log = logger.child({ component: 'messenger-install' })

export interface MessengerInstallStatus {
  /** The site the widget was last seen on, or null until it first loads there. */
  seenHost: string | null
  seenAt: string | null
  /** Messenger is switched on, so a visitor on that site can use it. */
  enabled: boolean
}

export async function getMessengerInstallStatus(): Promise<MessengerInstallStatus> {
  const [row] = await db
    .select({
      firstSeenAt: settings.widgetInstalledFirstSeenAt,
      lastSeenAt: settings.widgetInstalledLastSeenAt,
      host: settings.widgetInstalledOriginHost,
      widgetConfig: settings.widgetConfig,
    })
    .from(settings)
    .limit(1)
  if (!row) return { seenHost: null, seenAt: null, enabled: false }
  const config = parseWidgetConfig(row.widgetConfig)
  const seen = Boolean(row.firstSeenAt)
  return {
    seenHost: seen ? (row.host ?? null) : null,
    seenAt: seen ? (row.lastSeenAt ?? row.firstSeenAt)!.toISOString() : null,
    enabled: config.enabled === true && config.messenger?.enabled === true,
  }
}

/** Switch Messenger on as the snippet goes out, so the first load already shows it. */
export async function readyMessengerForInstall(): Promise<void> {
  const [row] = await db.select({ widgetConfig: settings.widgetConfig }).from(settings).limit(1)
  if (!row) return
  const existing = parseWidgetConfig(row.widgetConfig)
  if (existing.enabled === true && existing.messenger?.enabled === true) return
  await updateWidgetConfig(widgetActivationConfig(existing, 'messenger'))
}

export const INSTALL_INSTRUCTIONS_PER_HOUR = 5

/** One teammate may send a few sets of instructions an hour. */
export async function assertInstallInstructionsAllowed(
  senderPrincipalId: string,
  senderRole: string
): Promise<void> {
  if (!isTeamMember(senderRole)) {
    throw new ValidationError('FORBIDDEN', 'Only teammates can send install instructions')
  }
  const { count } = await incrementBucket({
    key: `install-instructions:${senderPrincipalId}`,
    windowSeconds: 3600,
  })
  if (count !== null && count > INSTALL_INSTRUCTIONS_PER_HOUR) {
    log.warn({ principal_id: senderPrincipalId }, 'install instructions rate limited')
    throw new ValidationError('RATE_LIMITED', 'Too many instruction emails. Try again in an hour.')
  }
}
