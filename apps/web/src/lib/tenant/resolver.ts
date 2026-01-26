import { eq, and } from 'drizzle-orm'
import { getTenantDb } from './db-cache'
import type { TenantInfo, SubscriptionContext } from './types'
import type { CloudTier } from '@/lib/features'
import {
  workspace,
  workspaceDomain,
  subscription,
  getCatalogDb,
  resetCatalogDb,
  decryptConnectionString,
  type CatalogDb,
} from '@/lib/catalog'

export { resetCatalogDb }

function extractSlugFromHost(host: string, baseDomain: string): string | null {
  const normalizedHost = host.toLowerCase()
  const normalizedBase = baseDomain.toLowerCase()

  const suffix = `.${normalizedBase}`
  if (!normalizedHost.endsWith(suffix)) {
    return null
  }

  const slug = normalizedHost.slice(0, -suffix.length)

  if (!slug || slug.includes('.')) {
    return null
  }

  return slug
}

async function lookupCustomDomain(
  db: CatalogDb,
  host: string
): Promise<typeof workspace.$inferSelect | null> {
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

  return (
    (await db.query.workspace.findFirst({
      where: eq(workspace.id, domainRecord.workspaceId),
    })) ?? null
  )
}

async function getConnectionString(
  workspaceRecord: typeof workspace.$inferSelect
): Promise<string> {
  if (!workspaceRecord.neonConnectionString) {
    throw new Error(`Workspace ${workspaceRecord.slug} has no connection string configured`)
  }

  return decryptConnectionString(workspaceRecord.neonConnectionString, workspaceRecord.id)
}

export async function getTenantDbBySlug(
  slug: string
): Promise<{ db: ReturnType<typeof getTenantDb>; workspaceId: string }> {
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

  const connectionString = await getConnectionString(workspaceRecord)
  const tenantDb = getTenantDb(workspaceRecord.id, connectionString)

  return { db: tenantDb, workspaceId: workspaceRecord.id }
}

export async function resolveTenantFromDomain(request: Request): Promise<TenantInfo | null> {
  const startTime = Date.now()
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
    const db = getCatalogDb()
    const slug = extractSlugFromHost(host, baseDomain)

    let workspaceRecord: typeof workspace.$inferSelect | null = null

    if (slug) {
      workspaceRecord =
        (await db.query.workspace.findFirst({
          where: eq(workspace.slug, slug),
        })) ?? null
    } else {
      workspaceRecord = await lookupCustomDomain(db, host)
    }

    if (!workspaceRecord) {
      console.warn(`[resolver] No workspace found for host: ${host}`)
      return null
    }

    if (workspaceRecord.migrationStatus !== 'completed') {
      console.warn(
        `[resolver] Workspace ${workspaceRecord.slug} not ready: ${workspaceRecord.migrationStatus}`
      )
      return null
    }

    const connectionString = await getConnectionString(workspaceRecord)
    const tenantDb = getTenantDb(workspaceRecord.id, connectionString)

    const [settings, subscriptionRecord] = await Promise.all([
      tenantDb.query.settings.findFirst(),
      db.query.subscription.findFirst({
        where: eq(subscription.workspaceId, workspaceRecord.id),
      }),
    ])

    const subscriptionContext: SubscriptionContext | null = subscriptionRecord
      ? {
          tier: subscriptionRecord.tier as CloudTier,
          status: subscriptionRecord.status as SubscriptionContext['status'],
          seatsTotal: subscriptionRecord.seatsIncluded + subscriptionRecord.seatsAdditional,
          currentPeriodEnd: subscriptionRecord.currentPeriodEnd,
        }
      : null

    console.log(`[resolver] Resolved ${workspaceRecord.slug} in ${Date.now() - startTime}ms`)

    return {
      workspaceId: workspaceRecord.id,
      slug: workspaceRecord.slug,
      db: tenantDb,
      settings: settings ?? null,
      subscription: subscriptionContext,
    }
  } catch (error) {
    console.error('[resolver] Failed to resolve tenant:', error)
    return null
  }
}
