/**
 * The tenant's own `SECRET_KEY` and object-storage keys, resolved per tenant.
 *
 * Until this existed, a pooled fleet shared one fleet-wide `SECRET_KEY` across
 * every tenant and had no way at all to reach a tenant's storage credentials —
 * so storage was not merely isolated-in-theory, it was **non-functional**, and
 * the encryption boundary between tenants was one HKDF info string rather than
 * one key.
 *
 * ## Where this runs, and why there
 *
 * On the pool-checkout path, in `pool-cache.ts`'s `verify()`, beside the §3
 * fingerprint. That placement is the design:
 *
 * - **Atomic with the DSN.** The secret ref must resolve correctly **and**
 *   atomically with `databaseUrl`. Both come off
 *   one record, read once, and are resolved in one function against one
 *   `TenantDescriptor`. A mix-up is not expressible — not "unlikely", not
 *   "guarded against".
 * - **Once per pool, not once per request.** The same cadence as the
 *   fingerprint, for the same reason: it is a property of the tenant, not of the
 *   request.
 * - **Synchronously readable afterwards.** `buildPublicUrl`, `getPublicUrlOrNull`
 *   and every gate in `storage/s3.ts` are synchronous and called from hundreds
 *   of places. Resolving on the checkout path and hanging the result on the
 *   tenant scope is what lets them stay synchronous. An async credential lookup
 *   at the point of use would be a refactor of the entire asset-URL surface for
 *   no isolation benefit.
 *
 * ## Two failure directions, and the reason they differ
 *
 * A failure to resolve `SECRET_KEY` **refuses the tenant**. A failure to resolve
 * storage **degrades storage only**. That is not a hedge, it is choosing
 * the failure whose cost is smaller.
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
 * {@link setTenantSecretsResolver} exists so an operator can point this at an
 * external custodian without the app growing a vault client. The built-in
 * resolver needs no client at
 * all: `derived+hkdf://` is local HKDF and `sealed+aead://` is local AEAD over a
 * blob that arrived in the record. A process serving no cloud tenant therefore
 * needs no extra credentials of any kind, which is the property the seam was
 * asked to preserve.
 */
import { config } from '@/lib/server/config'
import { logger } from '@/lib/server/logger'
import type { TenantDescriptor } from './registry'
import { redactRef } from './vendor/secret-ref'
import {
  resolveTenantSecretsFromRefs,
  TenantSecretResolutionError,
  type ResolvedTenantSecrets,
} from './vendor/tenant-secret-resolution'

const log = logger.child({ component: 'tenant-secrets' })

export type { ResolvedTenantSecrets }
export { TenantSecretResolutionError }

/**
 * Resolve one tenant's secret bundle.
 *
 * Takes the whole descriptor rather than a ref: the resolver has to check that
 * every ref names the tenant whose record carries it, and a signature that only
 * receives a ref cannot do that.
 */
export type TenantSecretsResolver = (
  tenant: TenantDescriptor
) => Promise<ResolvedTenantSecrets> | ResolvedTenantSecrets

let injected: TenantSecretsResolver | null = null

/**
 * Replace the built-in resolver. `null` restores it.
 *
 * The seam an external custodian plugs into. Setting it also drops the cache —
 * otherwise a process that swapped resolvers would keep serving values the old
 * one produced, which in a test suite reads as the new resolver working.
 */
export function setTenantSecretsResolver(resolver: TenantSecretsResolver | null): void {
  injected = resolver
  cache.clear()
}

interface CacheEntry {
  revision: number
  secrets: ResolvedTenantSecrets
  expiresAt: number
}

/**
 * Keyed by tenant id, invalidated by `revision` as well as by TTL.
 *
 * `revision` is what makes a *deliberate* change land immediately, since the
 * control plane's trigger bumps it on any write to the record — including a
 * hand-run `UPDATE` during an incident, which is precisely when waiting out a
 * TTL is least acceptable. That is also why the TTL can be long: every
 * rotation that goes through the record already invalidates instantly, so the
 * TTL only backstops a resolver whose *external* inputs changed with no record
 * write, and a short one just forces HKDF/AEAD re-derivation per tenant per
 * minute for nothing.
 */
const cache = new Map<string, CacheEntry>()
const TTL_MS = 10 * 60_000

export function clearTenantSecretsCache(tenantId?: string): void {
  if (tenantId) cache.delete(tenantId)
  else cache.clear()
}

export async function resolveTenantSecrets(
  tenant: TenantDescriptor
): Promise<ResolvedTenantSecrets> {
  const hit = cache.get(tenant.tenantId)
  if (hit && hit.revision === tenant.revision && hit.expiresAt > Date.now()) return hit.secrets

  const secrets = await (injected ? injected(tenant) : builtinResolver(tenant))

  if (secrets.storageProblem) {
    // Loud, once per resolve rather than once per request, and it names the ref
    // scheme rather than the ref: a sealed ref carries ciphertext, and a log
    // aggregator is not where that belongs.
    log.error(
      {
        tenantId: tenant.tenantId,
        // A problem implies a ref: an absent credential resolves to `null` with
        // no problem, because a fleet-bucket tenant is meant to have none.
        ref: tenant.storage.credentialRef ? redactRef(tenant.storage.credentialRef) : 'none',
        problem: secrets.storageProblem,
      },
      'tenant storage credentials are unresolvable — storage will answer 503 for this tenant'
    )
  }

  cache.set(tenant.tenantId, {
    revision: tenant.revision,
    secrets,
    expiresAt: Date.now() + TTL_MS,
  })
  return secrets
}

function builtinResolver(tenant: TenantDescriptor): ResolvedTenantSecrets {
  return resolveTenantSecretsFromRefs({
    tenantId: tenant.tenantId,
    appSecretsRef: tenant.secrets.appSecretsRef,
    storageCredentialRef: tenant.storage.credentialRef,
    rootKey: config.fleetRootKey ?? null,
  })
}
