/**
 * Tenant Resolver
 *
 * Resolves request domain to tenant context by calling the website API.
 * Results are cached for 5 minutes to reduce API calls.
 */
import { getTenantDb } from './db-cache'
import type { TenantContext } from './types'
import { env as cfEnv } from 'cloudflare:workers'

type CfEnv = { TENANT_API_URL?: string; TENANT_API_SECRET?: string }

function getTenantApiConfig() {
  const env = cfEnv as CfEnv | undefined
  return {
    url: env?.TENANT_API_URL || process.env.TENANT_API_URL,
    secret: env?.TENANT_API_SECRET || process.env.TENANT_API_SECRET,
  }
}

// Cache resolved tenants for 5 minutes
const tenantCache = new Map<string, { data: TenantApiResponse | null; expiresAt: number }>()
const CACHE_TTL_MS = 5 * 60 * 1000
const NEGATIVE_CACHE_TTL_MS = 60 * 1000 // Cache 404s for 1 minute

interface TenantApiResponse {
  workspaceId: string
  slug: string
  connectionString: string
}

/**
 * Resolve a domain to tenant context.
 *
 * @param request - Incoming HTTP request
 * @returns TenantContext if domain maps to a valid workspace, null otherwise
 */
export async function resolveTenantFromDomain(request: Request): Promise<TenantContext | null> {
  const { url: tenantApiUrl, secret: tenantApiSecret } = getTenantApiConfig()

  if (!tenantApiUrl || !tenantApiSecret) {
    console.error('Tenant API not configured: missing TENANT_API_URL or TENANT_API_SECRET')
    return null
  }

  // Extract host from request
  const host = request.headers.get('host')?.split(':')[0]
  if (!host) {
    return null
  }

  // Check cache first
  const cached = tenantCache.get(host)
  if (cached && cached.expiresAt > Date.now()) {
    // Negative cache hit - domain was previously not found
    if (cached.data === null) {
      return null
    }
    const db = getTenantDb(cached.data.workspaceId, cached.data.connectionString)
    return {
      workspaceId: cached.data.workspaceId,
      slug: cached.data.slug,
      db,
    }
  }

  try {
    // Call website API to resolve domain
    const response = await fetch(
      `${tenantApiUrl}/api/internal/resolve-domain?domain=${encodeURIComponent(host)}`,
      {
        headers: {
          Authorization: `Bearer ${tenantApiSecret}`,
        },
      }
    )

    if (!response.ok) {
      if (response.status === 404) {
        // Domain not found - cache negative result to avoid repeated lookups
        tenantCache.set(host, {
          data: null,
          expiresAt: Date.now() + NEGATIVE_CACHE_TTL_MS,
        })
        return null
      }

      if (response.status === 503) {
        // Workspace not ready (migrations in progress) - don't cache, may resolve soon
        console.warn(`Workspace for ${host} is not ready`)
        return null
      }

      // Other errors - clear stale cache but don't cache negative
      tenantCache.delete(host)
      console.error(`Tenant API error: ${response.status} ${response.statusText}`)
      return null
    }

    const data: TenantApiResponse = await response.json()

    // Cache the successful response
    tenantCache.set(host, {
      data,
      expiresAt: Date.now() + CACHE_TTL_MS,
    })

    // Get or create Drizzle instance
    const db = getTenantDb(data.workspaceId, data.connectionString)

    return {
      workspaceId: data.workspaceId,
      slug: data.slug,
      db,
    }
  } catch (error) {
    console.error('Failed to resolve tenant:', error)
    return null
  }
}

/**
 * Clear cached tenant for a specific domain.
 * Use when a domain mapping changes.
 */
export function clearTenantCache(domain: string): void {
  tenantCache.delete(domain)
}

/**
 * Clear all cached tenant mappings.
 */
export function clearAllTenantCache(): void {
  tenantCache.clear()
}
