/**
 * Tenant Resolver
 *
 * Resolves request domain to tenant context by querying the catalog database.
 * Extracts slug from subdomain and looks up workspace connection info.
 * Fetches connection strings from Neon API using project ID.
 *
 * Note: Uses process.env which works in both Cloudflare Workers (with nodejs_compat)
 * and Node.js/Bun environments.
 */
import { eq, and } from 'drizzle-orm'
import { getTenantDb } from './db-cache'
import type { TenantInfo } from './types'
import {
  workspace,
  workspaceDomain,
  getCatalogDb,
  resetCatalogDb,
  type CatalogDb,
} from '@/lib/catalog'

// Re-export for backwards compatibility
export { resetCatalogDb }

function getConfig(): {
  baseDomain: string | undefined
  neonApiKey: string | undefined
} {
  return {
    baseDomain: process.env.CLOUD_TENANT_BASE_DOMAIN,
    neonApiKey: process.env.CLOUD_NEON_API_KEY,
  }
}

// ============================================
// Neon API Connection String Fetcher
// ============================================

// Cache connection strings in memory (projectId -> connectionString)
const connectionStringCache = new Map<string, { value: string; expiresAt: number }>()
const CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour (connection strings rarely change)

/**
 * Fetch connection string from Neon API for a given project ID.
 * Results are cached for 1 hour to reduce API calls.
 * Includes retry logic for transient failures.
 */
async function fetchConnectionString(projectId: string, apiKey: string): Promise<string> {
  // Check cache first
  const cached = connectionStringCache.get(projectId)
  if (cached && cached.expiresAt > Date.now()) {
    console.log(`[resolver] Cache hit for project ${projectId}`)
    return cached.value
  }

  console.log(`[resolver] Cache miss for project ${projectId}, fetching from Neon API`)

  // Retry logic for transient failures
  let lastError: Error | null = null
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(
        `https://console.neon.tech/api/v2/projects/${projectId}/connection_uri?role_name=neondb_owner&database_name=neondb`,
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            Accept: 'application/json',
          },
        }
      )

      if (!response.ok) {
        const error = await response.text()
        throw new Error(`Neon API error (${response.status}): ${error}`)
      }

      const data = (await response.json()) as { uri: string }
      const connectionString = data.uri

      console.log(`[resolver] Successfully fetched connection string for project ${projectId}`)

      // Cache the result
      connectionStringCache.set(projectId, {
        value: connectionString,
        expiresAt: Date.now() + CACHE_TTL_MS,
      })

      return connectionString
    } catch (error) {
      lastError = error as Error
      console.warn(`[resolver] Neon API attempt ${attempt + 1} failed:`, error)
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)))
      }
    }
  }

  throw lastError || new Error('Failed to fetch connection string from Neon API')
}

// ============================================
// Subdomain Extraction
// ============================================

/**
 * Extract slug from subdomain if host matches base domain pattern.
 * e.g., "acme.quackback.io" with base "quackback.io" returns "acme"
 */
function extractSlugFromHost(host: string, baseDomain: string): string | null {
  const normalizedHost = host.toLowerCase()
  const normalizedBase = baseDomain.toLowerCase()

  const suffix = `.${normalizedBase}`
  if (!normalizedHost.endsWith(suffix)) {
    return null
  }

  const slug = normalizedHost.slice(0, -suffix.length)

  // Validate slug (should be non-empty and not contain dots)
  if (!slug || slug.includes('.')) {
    return null
  }

  return slug
}

/**
 * Look up a custom domain in the catalog database.
 * Returns the workspace record if a verified custom domain matches.
 */
async function lookupCustomDomain(
  db: CatalogDb,
  host: string
): Promise<typeof workspace.$inferSelect | null> {
  // Query workspace_domain table for verified custom domains
  const domainRecord = await db.query.workspaceDomain.findFirst({
    where: and(
      eq(workspaceDomain.domain, host),
      eq(workspaceDomain.domainType, 'custom'),
      eq(workspaceDomain.verified, true)
    ),
  })

  if (!domainRecord) {
    return null
  }

  // Fetch the associated workspace
  const workspaceRecord = await db.query.workspace.findFirst({
    where: eq(workspace.id, domainRecord.workspaceId),
  })

  return workspaceRecord ?? null
}

// ============================================
// Public API
// ============================================

/**
 * Get a tenant database connection by workspace slug.
 * Used for cross-tenant operations like OAuth callbacks on the central domain.
 *
 * @param slug - Workspace URL slug (e.g., "acme")
 * @returns Database instance for the tenant
 * @throws Error if workspace not found or not ready
 */
export async function getTenantDbBySlug(
  slug: string
): Promise<{ db: ReturnType<typeof getTenantDb>; workspaceId: string }> {
  const { neonApiKey } = getConfig()

  if (!neonApiKey) {
    throw new Error('getTenantDbBySlug requires CLOUD_NEON_API_KEY')
  }

  const db = getCatalogDb()

  const workspaceRecord = await db.query.workspace.findFirst({
    where: eq(workspace.slug, slug),
  })

  if (!workspaceRecord) {
    throw new Error(`Workspace not found: ${slug}`)
  }

  if (workspaceRecord.migrationStatus !== 'completed') {
    throw new Error(`Workspace ${slug} is not ready (status: ${workspaceRecord.migrationStatus})`)
  }

  if (!workspaceRecord.neonProjectId) {
    throw new Error(`Workspace ${slug} has no Neon project ID`)
  }

  const connectionString = await fetchConnectionString(workspaceRecord.neonProjectId, neonApiKey)
  const tenantDb = getTenantDb(workspaceRecord.id, connectionString)

  return {
    db: tenantDb,
    workspaceId: workspaceRecord.id,
  }
}

/**
 * Resolve a domain to tenant info.
 *
 * @param request - Incoming HTTP request
 * @returns TenantInfo if domain maps to a valid workspace, null otherwise
 */
export async function resolveTenantFromDomain(request: Request): Promise<TenantInfo | null> {
  const { baseDomain, neonApiKey } = getConfig()

  if (!baseDomain || !neonApiKey) {
    console.error(
      '[resolver] Tenant resolution not configured: missing CLOUD_TENANT_BASE_DOMAIN or CLOUD_NEON_API_KEY'
    )
    return null
  }

  const host = request.headers.get('host')?.split(':')[0]
  if (!host) {
    console.warn('[resolver] No host header in request')
    return null
  }

  const slug = extractSlugFromHost(host, baseDomain)

  try {
    const db = getCatalogDb()

    let workspaceRecord: typeof workspace.$inferSelect | null = null

    if (slug) {
      console.log(`[resolver] Resolving tenant for slug: ${slug}`)
      workspaceRecord =
        (await db.query.workspace.findFirst({
          where: eq(workspace.slug, slug),
        })) ?? null
    } else {
      console.log(`[resolver] Checking for custom domain: ${host}`)
      workspaceRecord = await lookupCustomDomain(db, host)
    }

    if (!workspaceRecord) {
      console.warn(`[resolver] No workspace found for host: ${host}`)
      return null
    }

    console.log(`[resolver] Found workspace: ${workspaceRecord.id} (${workspaceRecord.name})`)

    if (workspaceRecord.migrationStatus !== 'completed') {
      console.warn(
        `[resolver] Workspace ${workspaceRecord.slug} is not ready (status: ${workspaceRecord.migrationStatus})`
      )
      return null
    }

    if (!workspaceRecord.neonProjectId) {
      console.error(`[resolver] Workspace ${workspaceRecord.slug} has no Neon project ID`)
      return null
    }

    const connectionString = await fetchConnectionString(workspaceRecord.neonProjectId, neonApiKey)
    const tenantDb = getTenantDb(workspaceRecord.id, connectionString)

    // Fetch settings from tenant DB (saves extra query in server.ts)
    const settings = await tenantDb.query.settings.findFirst()

    console.log(`[resolver] Successfully resolved tenant: ${workspaceRecord.id}`)

    return {
      workspaceId: workspaceRecord.id,
      slug: workspaceRecord.slug,
      db: tenantDb,
      settings: settings ?? null,
    }
  } catch (error) {
    console.error('[resolver] Failed to resolve tenant:', error)
    return null
  }
}
