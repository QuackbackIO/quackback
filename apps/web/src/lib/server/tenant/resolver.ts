import { eq, and } from 'drizzle-orm'
import { getTenantDb } from './db-cache'
import type { TenantInfo, SubscriptionContext } from './types'
import type { CloudTier } from '@/lib/shared/features'
import {
  workspace,
  workspaceDomain,
  subscription,
  getCatalogDb,
  resetCatalogDb,
  type CatalogDb,
} from '@/lib/server/domains/catalog'

export { resetCatalogDb }

function extractSlugFromHost(host: string, baseDomain: string): string | null {
  const normalizedHost = host.toLowerCase()
  const suffix = `.${baseDomain.toLowerCase()}`

  if (!normalizedHost.endsWith(suffix)) return null

  const slug = normalizedHost.slice(0, -suffix.length)
  return slug && !slug.includes('.') ? slug : null
}

async function lookupCustomDomain(
  catalogDb: CatalogDb,
  host: string
): Promise<typeof workspace.$inferSelect | null> {
  const [result] = await catalogDb
    .select({
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      ownerId: workspace.ownerId,
      ownerEmail: workspace.ownerEmail,
      createdAt: workspace.createdAt,
      neonProjectId: workspace.neonProjectId,
      neonConnectionString: workspace.neonConnectionString,
      neonRegion: workspace.neonRegion,
      migrationStatus: workspace.migrationStatus,
    })
    .from(workspaceDomain)
    .innerJoin(workspace, eq(workspace.id, workspaceDomain.workspaceId))
    .where(
      and(
        eq(workspaceDomain.domain, host),
        eq(workspaceDomain.domainType, 'custom'),
        eq(workspaceDomain.verified, true)
      )
    )
    .limit(1)

  return result ?? null
}

export async function getTenantDbBySlug(
  slug: string
): Promise<{ db: Awaited<ReturnType<typeof getTenantDb>>; workspaceId: string }> {
  const catalogDb = getCatalogDb()
  const record = await catalogDb.query.workspace.findFirst({ where: eq(workspace.slug, slug) })

  if (!record) throw new Error(`Workspace not found: ${slug}`)
  if (record.migrationStatus !== 'completed') {
    throw new Error(`Workspace ${slug} is not ready (status: ${record.migrationStatus})`)
  }

  if (!record.neonConnectionString) {
    throw new Error(`Workspace ${record.slug} has no connection string configured`)
  }

  const db = await getTenantDb(record.id, record.neonConnectionString)
  return { db, workspaceId: record.id }
}

export async function resolveTenantFromDomain(request: Request): Promise<TenantInfo | null> {
  const baseDomain = process.env.CLOUD_TENANT_BASE_DOMAIN
  if (!baseDomain) {
    console.error('[resolver] Missing CLOUD_TENANT_BASE_DOMAIN')
    return null
  }

  const host = request.headers.get('host')?.split(':')[0]
  if (!host) {
    console.warn('[resolver] No host header in request')
    return null
  }

  try {
    const catalogDb = getCatalogDb()
    const slug = extractSlugFromHost(host, baseDomain)

    const record = slug
      ? await catalogDb.query.workspace.findFirst({ where: eq(workspace.slug, slug) })
      : await lookupCustomDomain(catalogDb, host)

    if (!record) {
      console.warn(`[resolver] No workspace found for host: ${host}`)
      return null
    }

    if (record.migrationStatus !== 'completed') {
      console.warn(`[resolver] Workspace ${record.slug} not ready: ${record.migrationStatus}`)
      return null
    }

    if (!record.neonConnectionString) {
      console.error(`[resolver] Workspace ${record.slug} has no connection string configured`)
      return null
    }

    const tenantDb = await getTenantDb(record.id, record.neonConnectionString)

    const [tenantSettings, sub] = await Promise.all([
      tenantDb.query.settings.findFirst(),
      catalogDb.query.subscription.findFirst({ where: eq(subscription.workspaceId, record.id) }),
    ])

    return {
      workspaceId: record.id,
      slug: record.slug,
      db: tenantDb,
      settings: tenantSettings ?? null,
      subscription: sub
        ? {
            tier: sub.tier as CloudTier,
            status: sub.status as SubscriptionContext['status'],
            seatsTotal: sub.seatsIncluded + sub.seatsAdditional,
            currentPeriodEnd: sub.currentPeriodEnd,
          }
        : null,
    }
  } catch (error) {
    console.error('[resolver] Failed to resolve tenant:', error)
    return null
  }
}
