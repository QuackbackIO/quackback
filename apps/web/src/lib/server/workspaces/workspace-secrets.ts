/**
 * The workspace's own `SECRET_KEY` and object-storage keys, resolved per workspace.
 *
 * Until this existed, a pooled fleet shared one fleet-wide `SECRET_KEY` across
 * every workspace and had no way at all to reach a workspace's storage credentials —
 * so storage was not merely isolated-in-theory, it was **non-functional**, and
 * the encryption boundary between workspaces was one HKDF info string rather than
 * one key.
 *
 * ## Where this runs, and why there
 *
 * On the pool-checkout path, in `pool-cache.ts`'s `verify()`, beside the §3
 * fingerprint. That placement is the design:
 *
 * - **Atomic with the DSN.** `SAAS-HOSTING-STACK.md` §4.3 asks for the secret ref
 *   to resolve "correctly **and** atomically with `databaseUrl`". Both come off
 *   one record, read once, and are resolved in one function against one
 *   `WorkspaceDescriptor`. A mix-up is not expressible — not "unlikely", not
 *   "guarded against".
 * - **Once per pool, not once per request.** The same cadence as the
 *   fingerprint, for the same reason: it is a property of the workspace, not of the
 *   request.
 * - **Synchronously readable afterwards.** `buildPublicUrl`, `getPublicUrlOrNull`
 *   and every gate in `storage/s3.ts` are synchronous and called from hundreds
 *   of places. Resolving on the checkout path and hanging the result on the
 *   workspace scope is what lets them stay synchronous. An async credential lookup
 *   at the point of use would be a refactor of the entire asset-URL surface for
 *   no isolation benefit.
 *
 * ## Two failure directions, and the reason they differ
 *
 * A failure to resolve `SECRET_KEY` **refuses the workspace**. A failure to resolve
 * storage **degrades storage only**. That is not a hedge, it is the same
 * reasoning `SAAS-HOSTING-STACK.md` §8.1 applies to entitlements-vs-RBAC, run in
 * the other direction: choose the failure whose cost is smaller.
 *
 * There is no safe degraded mode for a missing `SECRET_KEY`, because the
 * degraded mode on offer — fall back to the fleet-wide key — is exactly the
 * silent default this piece exists to delete, and it *writes*. Storage has a
 * genuine degraded mode: the workspace serves its portal, roadmap, inbox and API
 * while uploads and asset reads answer `503`. Refusing a whole workspace because
 * one bucket credential is unreadable would turn a broken integration into an
 * outage.
 *
 * ## The seam
 *
 * {@link setWorkspaceSecretsResolver} exists so an operator can point this at an
 * external custodian without the app growing a vault client. The built-in
 * resolver needs no client at
 * all: `derived+hkdf://` is local HKDF and `sealed+aead://` is local AEAD over a
 * blob that arrived in the record. A process serving no cloud workspace therefore
 * needs no extra credentials of any kind, which is the property the seam was
 * asked to preserve.
 */
import { config } from '@/lib/server/config'
import { logger } from '@/lib/server/logger'
import type { WorkspaceDescriptor } from './registry'
import { redactRef } from './vendor/secret-ref'
import {
  resolveWorkspaceSecretsFromRefs,
  WorkspaceSecretResolutionError,
  type ResolvedWorkspaceSecrets,
} from './vendor/workspace-secret-resolution'

const log = logger.child({ component: 'workspace-secrets' })

export type { ResolvedWorkspaceSecrets }
export { WorkspaceSecretResolutionError }

/**
 * Resolve one workspace's secret bundle.
 *
 * Takes the whole descriptor rather than a ref: the resolver has to check that
 * every ref names the workspace whose record carries it, and a signature that only
 * receives a ref cannot do that.
 */
export type WorkspaceSecretsResolver = (
  workspace: WorkspaceDescriptor
) => Promise<ResolvedWorkspaceSecrets> | ResolvedWorkspaceSecrets

let injected: WorkspaceSecretsResolver | null = null

/**
 * Replace the built-in resolver. `null` restores it.
 *
 * The seam an external custodian plugs into. Setting it also drops the cache —
 * otherwise a process that swapped resolvers would keep serving values the old
 * one produced, which in a test suite reads as the new resolver working.
 */
export function setWorkspaceSecretsResolver(resolver: WorkspaceSecretsResolver | null): void {
  injected = resolver
  cache.clear()
}

interface CacheEntry {
  revision: number
  secrets: ResolvedWorkspaceSecrets
  expiresAt: number
}

/**
 * Keyed by workspace id, invalidated by `revision` as well as by TTL.
 *
 * The TTL is what makes a rotation land without an operator action; `revision`
 * is what makes a *deliberate* change land immediately, since the control
 * plane's trigger bumps it on any write to the record — including a hand-run
 * `UPDATE` during an incident, which is precisely when waiting out a TTL is
 * least acceptable.
 */
const cache = new Map<string, CacheEntry>()
const TTL_MS = 60_000

export function clearWorkspaceSecretsCache(workspaceKey?: string): void {
  if (workspaceKey) cache.delete(workspaceKey)
  else cache.clear()
}

export async function resolveWorkspaceSecrets(
  workspace: WorkspaceDescriptor
): Promise<ResolvedWorkspaceSecrets> {
  const hit = cache.get(workspace.workspaceKey)
  if (hit && hit.revision === workspace.revision && hit.expiresAt > Date.now()) return hit.secrets

  const secrets = await (injected ? injected(workspace) : builtinResolver(workspace))

  if (secrets.storageProblem) {
    // Loud, once per resolve rather than once per request, and it names the ref
    // scheme rather than the ref: a sealed ref carries ciphertext, and a log
    // aggregator is not where that belongs.
    log.error(
      {
        workspaceKey: workspace.workspaceKey,
        // A problem implies a ref: an absent credential resolves to `null` with
        // no problem, because a fleet-bucket workspace is meant to have none.
        ref: workspace.storage.credentialRef ? redactRef(workspace.storage.credentialRef) : 'none',
        problem: secrets.storageProblem,
      },
      'workspace storage credentials are unresolvable — storage will answer 503 for this workspace'
    )
  }

  cache.set(workspace.workspaceKey, {
    revision: workspace.revision,
    secrets,
    expiresAt: Date.now() + TTL_MS,
  })
  return secrets
}

function builtinResolver(workspace: WorkspaceDescriptor): ResolvedWorkspaceSecrets {
  return resolveWorkspaceSecretsFromRefs({
    workspaceKey: workspace.workspaceKey,
    appSecretsRef: workspace.secrets.appSecretsRef,
    storageCredentialRef: workspace.storage.credentialRef,
    rootKey: config.fleetRootKey ?? null,
  })
}
