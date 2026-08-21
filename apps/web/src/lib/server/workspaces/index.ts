/**
 * Pooled multi-workspaces: one process, many workspaces, one database each.
 *
 * Read `TENANCY.md` in this directory first — it states the resolution order,
 * every failure mode, how eviction is tuned and measured, and which background
 * subsystems are scoped versus deferred.
 *
 * The module in one paragraph: the Host header resolves to a control-plane
 * registry record before auth runs; the record's DSN and credential reference
 * build (or reuse) a workspace-keyed pool; the pool is not handed to a request
 * until the database has proven, on three independent facts, that it is the one
 * the record named. Everything downstream keeps importing `db` and never learns
 * any of this happened.
 */
export {
  getWorkspaceScope,
  requireWorkspaceScope,
  getScopedDatabase,
  getCurrentWorkspace,
  runWithWorkspaceScope,
  WorkspaceScopeMissingError,
  type WorkspaceScope,
  type WorkspaceScopeOrigin,
} from './workspace-context'

export {
  acquireScopeForHost,
  acquireScopeForWorkspaceId,
  acquireWorkspaceScope,
  invalidateWorkspaceCache,
  lookupWorkspaceById,
  lookupWorkspaceByHost,
  type WorkspaceAcquisition,
} from './resolver'

export {
  closeControlSql,
  getControlSql,
  listActiveWorkspaces,
  normalizeHostHeader,
  type WorkspaceDescriptor,
  type WorkspaceLookup,
} from './registry'

export {
  acquireWorkspacePool,
  closeAllWorkspacePools,
  evict,
  getPoolCacheStats,
  sweepIdlePools,
  type PoolCacheStats,
} from './pool-cache'

export {
  evaluateWorkspaceIdentity,
  observePhysicalIdentity,
  observeWorkspaceIdentity,
  WorkspaceFingerprintRefusal,
  type IdentityFailure,
  type IdentityVerdict,
} from './fingerprint'

export { evaluatePhysicalIdentity, type PhysicalFailure } from './physical-identity'

export {
  evaluateFingerprint,
  WORKSPACE_FINGERPRINT_METADATA_KEY,
  WORKSPACE_REGISTRY_CONTRACT_VERSION,
  type FingerprintFailure,
  type WorkspaceRecord,
  type WorkspaceResolution,
} from './vendor/contract'

export {
  runFleetPass,
  withScopedWorkspaces,
  withWorkspaceScopeById,
  type FleetPassResult,
} from './fleet'
