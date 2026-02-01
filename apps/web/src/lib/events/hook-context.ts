/**
 * Hook context - centralized resolution of workspace/portal data.
 *
 * This module provides a single point of context resolution for the hook system,
 * eliminating duplicate database queries across hook handlers.
 */

import { drizzle } from 'drizzle-orm/neon-http'
import { neon } from '@neondatabase/serverless'
import { eq, and } from 'drizzle-orm'
import { db } from '@/lib/db'
import { getRootUrl } from './hook-utils'
import { workspace, workspaceDomain } from '@/lib/catalog'

let catalogDb: ReturnType<typeof drizzle> | null = null

function getCatalogDb() {
  const url = process.env.CLOUD_CATALOG_DATABASE_URL
  if (!url) return null

  if (!catalogDb) {
    const sql = neon(url)
    catalogDb = drizzle(sql)
  }
  return catalogDb
}

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
 * This consolidates what was previously 7+ database queries per event into 1-2:
 * - 1 query for workspace settings (id, name, slug)
 * - 1 optional catalog query for custom domain (cloud mode only)
 *
 * @returns HookContext or null if settings not found
 */
export async function buildHookContext(): Promise<HookContext | null> {
  // Single query for all needed settings fields
  const settings = await db.query.settings.findFirst({
    columns: { id: true, name: true, slug: true },
  })

  if (!settings) {
    console.error('[context] No workspace settings found')
    return null
  }

  // Resolve portal URL (uses catalog in cloud mode, ROOT_URL in self-hosted)
  const portalBaseUrl = await resolvePortalUrl(settings.slug)

  console.log(`[context] Built hook context for slug=${settings.slug}, url=${portalBaseUrl}`)

  return {
    workspaceId: settings.id,
    workspaceName: settings.name,
    workspaceSlug: settings.slug,
    portalBaseUrl,
  }
}

/**
 * Resolve portal base URL for a workspace slug.
 *
 * In self-hosted mode: Uses ROOT_URL environment variable
 * In cloud mode: Queries catalog for workspace's primary domain
 *
 * Exported for use in invitation emails and other contexts that need workspace URLs.
 */
export async function resolvePortalUrl(slug: string): Promise<string> {
  const catalogDbInstance = getCatalogDb()

  // Self-hosted mode - use ROOT_URL
  if (!catalogDbInstance) {
    return getRootUrl()
  }

  // Cloud mode - get primary domain from catalog
  try {
    const result = await catalogDbInstance
      .select({ domain: workspaceDomain.domain })
      .from(workspace)
      .innerJoin(workspaceDomain, eq(workspaceDomain.workspaceId, workspace.id))
      .where(and(eq(workspace.slug, slug), eq(workspaceDomain.isPrimary, true)))
      .limit(1)

    const primaryDomain = result[0]?.domain
    if (primaryDomain) {
      return `https://${primaryDomain}`
    }

    // Fallback to subdomain based on slug
    const baseDomain = process.env.CLOUD_TENANT_BASE_DOMAIN || 'quackback.io'
    console.log(`[context] No primary domain for slug=${slug}, using fallback subdomain`)
    return `https://${slug}.${baseDomain}`
  } catch (error) {
    console.error('[context] Failed to resolve portal URL from catalog:', error)
    return getRootUrl()
  }
}
