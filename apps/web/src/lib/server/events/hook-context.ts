/**
 * Hook context - centralized resolution of workspace/portal data.
 *
 * This module provides a single point of context resolution for the hook system,
 * eliminating duplicate database queries across hook handlers.
 */

import { db } from '@/lib/server/db'
import { getBaseUrl } from '@/lib/server/config'
import type { EmailBrand } from '@quackback/email'
import { emailBranding } from '@/lib/server/email/email-brand'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'hook-context' })

/**
 * Centralized hook context containing workspace data needed by all hooks.
 * Built once per event, passed to all hook target resolvers.
 */
export interface HookContext {
  /** Workspace display name */
  workspaceName: string
  /** Portal base URL for constructing post links */
  portalBaseUrl: string
  /** Email header image: the published brand icon, else the workspace logo; null if neither */
  logoUrl: string | null
  /** The published design's email colours; absent keeps Quackback gold */
  emailBrand?: EmailBrand
}

/**
 * Build hook context by querying workspace settings ONCE.
 *
 * @returns HookContext or null if settings not found
 */
export async function buildHookContext(): Promise<HookContext | null> {
  const settings = await db.query.settings.findFirst({
    columns: { name: true, logoKey: true, featureFlags: true },
  })

  if (!settings) {
    log.error('no workspace settings found')
    return null
  }

  const { logoUrl, brand } = await emailBranding(settings)
  return {
    workspaceName: settings.name,
    portalBaseUrl: getBaseUrl(),
    logoUrl: logoUrl ?? null,
    ...(brand && { emailBrand: brand }),
  }
}
