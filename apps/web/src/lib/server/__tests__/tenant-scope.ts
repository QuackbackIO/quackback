/**
 * Opening a tenant scope from a test.
 *
 * The real scope is opened by the tenant middleware from a registry record.
 * Tests only need the parts the module-scope caches read — the tenant id, and
 * for storage the pinned bucket/origin — so this builds a structurally complete
 * descriptor and hands the database handles as stubs. A test that touches the
 * database should open a real scope instead.
 */
import { createHash } from 'node:crypto'
import { fromUuid, type WorkspaceId } from '@quackback/ids'
import type { TenantDescriptor } from '@/lib/server/tenancy/registry'
import { createTenantScope, runWithTenantScope } from '@/lib/server/tenancy/tenant-context'
import type { ResolvedTenantSecrets } from '@/lib/server/tenancy/vendor/tenant-secret-resolution'

type StorageOverrides = Partial<TenantDescriptor['storage']>

/**
 * A distinct `settings.id` per tenant, derived rather than shared.
 *
 * Same rule as {@link makeTenantSecrets}: a fixture that hands every tenant one
 * value lets a test that accidentally relied on two tenants colliding pass. It
 * matters more here than it did for the secrets, because `settings.id` is now
 * the storage namespace — a constant would make every isolation assertion in
 * the storage tests vacuously true.
 */
export function workspaceUuidFor(tenantId: string): string {
  const hex = createHash('sha256').update(tenantId).digest('hex')
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `7${hex.slice(13, 16)}`,
    `8${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-')
}

/** The branded form of {@link workspaceUuidFor} — what the storage namespace is built from. */
export function workspaceIdFor(tenantId: string): WorkspaceId {
  return fromUuid('workspace', workspaceUuidFor(tenantId))
}

/**
 * The per-tenant secrets the real scope carries.
 *
 * Derived from the tenant id rather than shared, so a test that accidentally
 * relied on two tenants holding one key fails instead of passing — which is the
 * property the production resolver provides and the reason this fixture must
 * not hand out a constant.
 */
export function makeTenantSecrets(
  tenantId: string,
  overrides: Partial<ResolvedTenantSecrets> = {}
): ResolvedTenantSecrets {
  return {
    secretKey: `test-secret-key-for-${tenantId}-0123456789abcdef`,
    // Per-tenant like the key itself. A constant here would let a fixture pass
    // the stamp comparison that the production resolver would fail, which is
    // the same reason the key above is derived from the tenant id.
    provenance: { refScheme: 'env', generation: 0, material: `test-material-${tenantId}` },
    storage: {
      accessKeyId: `AK-${tenantId}`,
      secretAccessKey: `SK-${tenantId}-0123456789abcdef`,
    },
    storageProblem: null,
    ...overrides,
  }
}

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
      expectedWorkspaceId: workspaceUuidFor(tenantId),
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
  }
}

/** Run `fn` with `tenantId` as the ambient tenant. */
export function withTenant<T>(
  tenantId: string,
  fn: () => T,
  overrides?: {
    storage?: StorageOverrides
    baseUrl?: string
    secrets?: Partial<ResolvedTenantSecrets>
  }
): T {
  return runWithTenantScope(
    createTenantScope({
      tenant: makeTenantDescriptor(tenantId, overrides),
      db: {} as never,
      sql: {} as never,
      secrets: makeTenantSecrets(tenantId, overrides?.secrets ?? {}),
      origin: 'test',
    }),
    fn
  )
}
