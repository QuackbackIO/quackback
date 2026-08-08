/**
 * Pooled multi-tenancy: one process, many tenants, one database each.
 *
 * Read `TENANCY.md` in this directory first — it states the resolution order,
 * every failure mode, how eviction is tuned and measured, and which background
 * subsystems are scoped versus deferred.
 *
 * The module in one paragraph: the Host header resolves to a control-plane
 * registry record before auth runs; the record's DSN and credential reference
 * build (or reuse) a tenant-keyed pool; the pool is not handed to a request
 * until the database has proven, on three independent facts, that it is the one
 * the record named. Everything downstream keeps importing `db` and never learns
 * any of this happened.
 */
export {
  getTenantScope,
  requireTenantScope,
  getScopedDatabase,
  getCurrentTenant,
  runWithTenantScope,
  TenantScopeMissingError,
  type TenantScope,
  type TenantScopeOrigin,
} from './tenant-context'

export {
  acquireScopeForHost,
  acquireScopeForTenantId,
  acquireTenantScope,
  invalidateTenantCache,
  lookupTenantById,
  lookupTenantByHost,
  type TenantAcquisition,
} from './resolver'

export {
  closeControlSql,
  getControlSql,
  listActiveTenants,
  normalizeHostHeader,
  type TenantDescriptor,
  type TenantLookup,
} from './registry'

export {
  acquireTenantPool,
  closeAllTenantPools,
  evict,
  getPoolCacheStats,
  sweepIdlePools,
  type PoolCacheStats,
} from './pool-cache'

export {
  evaluateTenantIdentity,
  observePhysicalIdentity,
  observeTenantIdentity,
  TenantFingerprintRefusal,
  type IdentityFailure,
  type IdentityVerdict,
} from './fingerprint'

export { evaluatePhysicalIdentity, type PhysicalFailure } from './physical-identity'

export {
  evaluateFingerprint,
  TENANT_FINGERPRINT_METADATA_KEY,
  TENANT_REGISTRY_CONTRACT_VERSION,
  type FingerprintFailure,
  type TenantRecord,
  type TenantResolution,
} from './vendor/contract'

export { runFleetPass, withScopedTenants, withTenantScopeById, type FleetPassResult } from './fleet'
