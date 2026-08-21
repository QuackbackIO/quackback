/**
 * Opening a workspace scope from a test.
 *
 * The real scope is opened by the workspace middleware from a registry record.
 * Tests only need the parts the module-scope caches read — the workspace id, and
 * for storage the pinned bucket/origin — so this builds a structurally complete
 * descriptor and hands the database handles as stubs. A test that touches the
 * database should open a real scope instead.
 */
import { createHash } from 'node:crypto'
import { fromUuid, type WorkspaceId } from '@quackback/ids'
import type { WorkspaceDescriptor } from '@/lib/server/workspaces/registry'
import {
  createWorkspaceScope,
  runWithWorkspaceScope,
} from '@/lib/server/workspaces/workspace-context'
import type { ResolvedWorkspaceSecrets } from '@/lib/server/workspaces/vendor/workspace-secret-resolution'

type StorageOverrides = Partial<WorkspaceDescriptor['storage']>

/**
 * A distinct `settings.id` per workspace, derived rather than shared.
 *
 * Same rule as {@link makeWorkspaceSecrets}: a fixture that hands every workspace one
 * value lets a test that accidentally relied on two workspaces colliding pass. It
 * matters more here than it did for the secrets, because `settings.id` is now
 * the storage namespace — a constant would make every isolation assertion in
 * the storage tests vacuously true.
 */
export function workspaceUuidFor(workspaceKey: string): string {
  const hex = createHash('sha256').update(workspaceKey).digest('hex')
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `7${hex.slice(13, 16)}`,
    `8${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-')
}

/** The branded form of {@link workspaceUuidFor} — what the storage namespace is built from. */
export function workspaceIdFor(workspaceKey: string): WorkspaceId {
  return fromUuid('workspace', workspaceUuidFor(workspaceKey))
}

/**
 * The per-workspace secrets the real scope carries.
 *
 * Derived from the workspace id rather than shared, so a test that accidentally
 * relied on two workspaces holding one key fails instead of passing — which is the
 * property the production resolver provides and the reason this fixture must
 * not hand out a constant.
 */
export function makeWorkspaceSecrets(
  workspaceKey: string,
  overrides: Partial<ResolvedWorkspaceSecrets> = {}
): ResolvedWorkspaceSecrets {
  return {
    secretKey: `test-secret-key-for-${workspaceKey}-0123456789abcdef`,
    // Per-workspace like the key itself. A constant here would let a fixture pass
    // the stamp comparison that the production resolver would fail, which is
    // the same reason the key above is derived from the workspace id.
    provenance: { refScheme: 'env', generation: 0, material: `test-material-${workspaceKey}` },
    storage: {
      accessKeyId: `AK-${workspaceKey}`,
      secretAccessKey: `SK-${workspaceKey}-0123456789abcdef`,
    },
    storageProblem: null,
    ...overrides,
  }
}

export function makeWorkspaceDescriptor(
  workspaceKey: string,
  overrides: { storage?: StorageOverrides; baseUrl?: string } = {}
): WorkspaceDescriptor {
  const host = `${workspaceKey}.example.com`
  const baseUrl = overrides.baseUrl ?? `https://${host}`
  return {
    contractVersion: 1,
    workspaceKey,
    revision: 1,
    routing: { primaryHostname: host, hostnames: [host], baseUrl },
    database: {
      pooledUrl: `postgresql://app@db-pooler.example.com/${workspaceKey}`,
      directUrl: `postgresql://app@db.example.com/${workspaceKey}`,
      name: workspaceKey,
      role: 'app',
      credentialRef: 'env://QUACKBACK_TENANT_SECRET_DB',
    },
    fingerprint: {
      expectedWorkspaceKey: workspaceKey,
      expectedSelfReportedWorkspaceId: workspaceUuidFor(workspaceKey),
      stampedAt: '2026-01-01T00:00:00.000Z',
    },
    secrets: { appSecretsRef: 'env://QUACKBACK_TENANT_SECRET_APP' },
    storage: {
      provider: 'r2',
      bucket: `${workspaceKey}-bucket`,
      endpoint: 'https://storage.example.com',
      region: 'auto',
      forcePathStyle: false,
      publicUrl: `https://assets-${workspaceKey}.example.com`,
      credentialRef: 'env://QUACKBACK_TENANT_SECRET_STORAGE',
      ...(overrides.storage ?? {}),
    },
    email: { from: `support@${host}` },
    features: { aiEnabled: true },
    physical: { catalogName: null, catalogOid: null },
  }
}

/** Run `fn` with `workspaceKey` as the ambient workspace. */
export function withWorkspace<T>(
  workspaceKey: string,
  fn: () => T,
  overrides?: {
    storage?: StorageOverrides
    baseUrl?: string
    secrets?: Partial<ResolvedWorkspaceSecrets>
  }
): T {
  return runWithWorkspaceScope(
    createWorkspaceScope({
      workspace: makeWorkspaceDescriptor(workspaceKey, overrides),
      db: {} as never,
      sql: {} as never,
      secrets: makeWorkspaceSecrets(workspaceKey, overrides?.secrets ?? {}),
      origin: 'test',
    }),
    fn
  )
}
