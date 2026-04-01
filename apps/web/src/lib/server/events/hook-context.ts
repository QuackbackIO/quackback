/**
 * Hook context - centralized resolution of workspace/portal data.
 *
 * This module provides a single point of context resolution for the hook system,
 * eliminating duplicate database queries across hook handlers.
 */

import { db } from '@/lib/server/db'
import { getBaseUrl } from '@/lib/server/config'
import { getPublicUrlOrNull } from '@/lib/server/storage/s3'

/**
 * Centralized hook context containing workspace data needed by all hooks.
 * Built once per event, passed to all hook target resolvers.
 */
export interface HookContext {
  /** Workspace display name */
  workspaceName: string
  /** Portal base URL for constructing post links */
  portalBaseUrl: string
  /** Brand logo URL (proxied through app), or null if not set */
  logoUrl: string | null
}

/**
 * Build hook context by querying workspace settings ONCE.
 *
 * @returns HookContext or null if settings not found
 */
export async function buildHookContext(): Promise<HookContext | null> {
  const settings = await db.query.settings.findFirst({
    columns: { name: true, logoKey: true },
  })

  if (!settings) {
    console.error('[Targets] No workspace settings found')
    return null
  }

  return {
    workspaceName: settings.name,
    portalBaseUrl: getBaseUrl(),
    logoUrl: getPublicUrlOrNull(settings.logoKey),
  }
}
