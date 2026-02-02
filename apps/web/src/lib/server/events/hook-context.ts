/**
 * Hook context - centralized resolution of workspace/portal data.
 *
 * This module provides a single point of context resolution for the hook system,
 * eliminating duplicate database queries across hook handlers.
 */

import { db } from '@/lib/server/db'
import { getBaseUrl } from './hook-utils'

/**
 * Centralized hook context containing workspace data needed by all hooks.
 * Built once per event, passed to all hook target resolvers.
 */
export interface HookContext {
  /** Workspace settings ID (for token decryption) */
  workspaceId: string
  /** Workspace display name */
  workspaceName: string
  /** Workspace slug */
  workspaceSlug: string
  /** Portal base URL for constructing post links */
  portalBaseUrl: string
}

/**
 * Build hook context by querying workspace settings ONCE.
 *
 * @returns HookContext or null if settings not found
 */
export async function buildHookContext(): Promise<HookContext | null> {
  const settings = await db.query.settings.findFirst({
    columns: { id: true, name: true, slug: true },
  })

  if (!settings) {
    console.error('[context] No workspace settings found')
    return null
  }

  const portalBaseUrl = getBaseUrl()

  return {
    workspaceId: settings.id,
    workspaceName: settings.name,
    workspaceSlug: settings.slug,
    portalBaseUrl,
  }
}

/**
 * Resolve portal base URL for a workspace slug.
 * Uses BASE_URL environment variable.
 */
export function resolvePortalUrl(_slug: string): string {
  return getBaseUrl()
}
