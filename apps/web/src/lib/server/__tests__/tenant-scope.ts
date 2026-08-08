/**
 * Opening a tenant scope from a test.
 *
 * The real scope is opened by the tenant middleware from a registry record.
 * Tests only need the parts the module-scope caches read — the tenant id, and
 * for storage the pinned bucket/origin — so this builds a structurally complete
 * descriptor and hands the database handles as stubs. A test that touches the
 * database should open a real scope instead.
 */
import type { TenantDescriptor } from '@/lib/server/tenancy/registry'
import { runWithTenantScope } from '@/lib/server/tenancy/tenant-context'

type StorageOverrides = Partial<TenantDescriptor['storage']>

export function makeTenantDescriptor(
  tenantId: string,
  overrides: { storage?: StorageOverrides; baseUrl?: string } = {}
): TenantDescriptor {
  const host = `${tenantId}.example.com`
  const baseUrl = overrides.baseUrl ?? `https://${host}`
  return {
    contractVersion: 1,
    tenantId,
    revision: 1,
    routing: { primaryHostname: host, hostnames: [host], baseUrl },
    database: {
      pooledUrl: `postgresql://app@db-pooler.example.com/${tenantId}`,
      directUrl: `postgresql://app@db.example.com/${tenantId}`,
      name: tenantId,
      role: 'app',
      credentialRef: 'env://QUACKBACK_TENANT_SECRET_DB',
    },
    fingerprint: {
      expectedTenantId: tenantId,
      expectedWorkspaceId: '00000000-0000-4000-8000-000000000000',
      stampedAt: '2026-01-01T00:00:00.000Z',
    },
    secrets: { appSecretsRef: 'env://QUACKBACK_TENANT_SECRET_APP' },
    storage: {
      provider: 'r2',
      bucket: `${tenantId}-bucket`,
      endpoint: 'https://storage.example.com',
      region: 'auto',
      forcePathStyle: false,
      publicUrl: `https://assets-${tenantId}.example.com`,
      credentialRef: 'env://QUACKBACK_TENANT_SECRET_STORAGE',
      ...(overrides.storage ?? {}),
    },
    email: { from: `support@${host}` },
    features: { aiEnabled: true },
    physical: { neonProjectId: null, neonBranchId: null },
  }
}

/** Run `fn` with `tenantId` as the ambient tenant. */
export function withTenant<T>(
  tenantId: string,
  fn: () => T,
  overrides?: { storage?: StorageOverrides; baseUrl?: string }
): T {
  return runWithTenantScope(
    {
      tenant: makeTenantDescriptor(tenantId, overrides),
      db: {} as never,
      sql: {} as never,
      origin: 'test',
    },
    fn
  )
}
