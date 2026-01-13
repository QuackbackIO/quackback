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
import { drizzle } from 'drizzle-orm/neon-http'
import { neon } from '@neondatabase/serverless'
import { pgTable, text, timestamp, boolean, index } from 'drizzle-orm/pg-core'
import { eq } from 'drizzle-orm'
import { getTenantDb } from './db-cache'
import type { TenantContext } from './types'

// ============================================
// Catalog Schema (inline - matches get-started.ts)
// ============================================

const workspace = pgTable('workspace', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  neonProjectId: text('neon_project_id'),
  neonRegion: text('neon_region').default('aws-us-east-1'),
  migrationStatus: text('migration_status').default('pending'), // 'pending' | 'in_progress' | 'completed'
})

const workspaceDomain = pgTable(
  'workspace_domain',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    domain: text('domain').notNull().unique(),
    domainType: text('domain_type').notNull(), // 'subdomain' | 'custom'
    isPrimary: boolean('is_primary').default(false).notNull(),
    verified: boolean('verified').default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    // Cloudflare custom domain fields
    verificationToken: text('verification_token'), // HTTP verification token
    cloudflareHostnameId: text('cloudflare_hostname_id'), // Cloudflare custom hostname ID
    sslStatus: text('ssl_status'), // initializing|pending_validation|pending_issuance|pending_deployment|active|expired
    ownershipStatus: text('ownership_status'), // pending|active|moved|blocked|deleted
  },
  (table) => [
    index('workspace_domain_workspace_id_idx').on(table.workspaceId),
    index('workspace_domain_cf_hostname_id_idx').on(table.cloudflareHostnameId),
  ]
)

const catalogSchema = { workspace, workspaceDomain }

// ============================================
// Catalog Database Connection
// ============================================

function getConfig() {
  return {
    catalogDbUrl: process.env.CLOUD_CATALOG_DATABASE_URL,
    baseDomain: process.env.CLOUD_TENANT_BASE_DOMAIN,
    neonApiKey: process.env.CLOUD_NEON_API_KEY,
  }
}

// Singleton catalog database connection
let catalogDb: ReturnType<typeof drizzle<typeof catalogSchema>> | null = null

function getCatalogDb(connectionUrl: string) {
  if (!catalogDb) {
    const sql = neon(connectionUrl)
    catalogDb = drizzle(sql, { schema: catalogSchema })
  }
  return catalogDb
}

/** Reset catalog db connection (for testing) */
export function resetCatalogDb(): void {
  catalogDb = null
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
  const config = getConfig()

  if (!config.catalogDbUrl || !config.neonApiKey) {
    throw new Error('getTenantDbBySlug requires CLOUD_CATALOG_DATABASE_URL and CLOUD_NEON_API_KEY')
  }

  const db = getCatalogDb(config.catalogDbUrl)

  // Query workspace by slug
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

  // Fetch connection string from Neon API
  const connectionString = await fetchConnectionString(
    workspaceRecord.neonProjectId,
    config.neonApiKey
  )

  // Get or create Drizzle instance for tenant
  const tenantDb = getTenantDb(workspaceRecord.id, connectionString)

  return {
    db: tenantDb,
    workspaceId: workspaceRecord.id,
  }
}

/**
 * Resolve a domain to tenant context.
 *
 * @param request - Incoming HTTP request
 * @returns TenantContext if domain maps to a valid workspace, null otherwise
 */
export async function resolveTenantFromDomain(request: Request): Promise<TenantContext | null> {
  const config = getConfig()

  if (!config.catalogDbUrl || !config.baseDomain || !config.neonApiKey) {
    console.error(
      '[resolver] Tenant resolution not configured: missing CLOUD_CATALOG_DATABASE_URL, CLOUD_TENANT_BASE_DOMAIN, or CLOUD_NEON_API_KEY'
    )
    return null
  }

  // Extract host from request
  const host = request.headers.get('host')?.split(':')[0]
  if (!host) {
    console.warn('[resolver] No host header in request')
    return null
  }

  // Extract slug from subdomain
  const slug = extractSlugFromHost(host, config.baseDomain)
  if (!slug) {
    // Not a subdomain of base domain - skip tenant resolution
    return null
  }

  console.log(`[resolver] Resolving tenant for slug: ${slug}`)

  try {
    const db = getCatalogDb(config.catalogDbUrl)

    // Query workspace by slug
    const workspaceRecord = await db.query.workspace.findFirst({
      where: eq(workspace.slug, slug),
    })

    if (!workspaceRecord) {
      console.warn(`[resolver] No workspace found for slug: ${slug}`)
      return null
    }

    console.log(`[resolver] Found workspace: ${workspaceRecord.id} (${workspaceRecord.name})`)

    // Check migration status
    if (workspaceRecord.migrationStatus !== 'completed') {
      console.warn(
        `[resolver] Workspace ${slug} is not ready (status: ${workspaceRecord.migrationStatus})`
      )
      return null
    }

    if (!workspaceRecord.neonProjectId) {
      console.error(`[resolver] Workspace ${slug} has no Neon project ID`)
      return null
    }

    // Fetch connection string from Neon API
    const connectionString = await fetchConnectionString(
      workspaceRecord.neonProjectId,
      config.neonApiKey
    )

    // Get or create Drizzle instance for tenant
    const tenantDb = getTenantDb(workspaceRecord.id, connectionString)

    console.log(`[resolver] Successfully resolved tenant: ${workspaceRecord.id}`)

    return {
      workspaceId: workspaceRecord.id,
      slug: workspaceRecord.slug,
      db: tenantDb,
    }
  } catch (error) {
    console.error('[resolver] Failed to resolve tenant:', error)
    return null
  }
}
