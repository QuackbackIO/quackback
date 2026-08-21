/**
 * A tenant record's secret references → the actual secrets.
 *
 * **Vendored byte-for-byte into the app** alongside `contract.ts`,
 * `secret-ref.ts` and `fleet-secrets.ts`. The control plane runs this to prove a
 * ref works before it registers a tenant; a fleet replica runs it on every pool
 * build. If the two ever diverged, provisioning would certify a ref the fleet
 * cannot follow — which is precisely the failure this readback exists to catch,
 * so the checker and the checked must be the same code.
 *
 * ## The two halves fail in different directions, deliberately
 *
 * `SECRET_KEY` is not a feature. It decrypts sessions, integration OAuth tokens,
 * webhook signing secrets and custom-action headers, and — the part that makes
 * this asymmetric — a fleet that guesses it wrong will happily *write new
 * ciphertext under the wrong key*. So an unresolvable `appSecretsRef` refuses
 * the whole tenant. There is no degraded mode that is safer than refusing, and
 * falling back to the fleet-wide `SECRET_KEY` is the exact behaviour this piece
 * exists to remove: it is a silent default wearing the costume of resilience.
 *
 * Object storage *is* a feature. A workspace with no resolvable storage
 * credential can still serve its portal, its roadmap, its inbox and its API; it
 * just cannot upload or read files. Refusing the whole tenant for that would
 * turn one broken integration into an outage. So a storage failure is captured
 * and reported, never thrown, and the storage surfaces answer `503` while
 * everything else keeps working.
 *
 * Both directions are loud. Neither substitutes a value.
 */
import { createHash } from 'node:crypto'
import {
  deriveTenantSecret,
  FleetSecretError,
  openTenantSecret,
  type FleetSecretPurpose,
} from './fleet-secrets'
import { parseSecretRef, redactRef, type SecretRef } from './secret-ref'

export interface TenantStorageCredentials {
  accessKeyId: string
  secretAccessKey: string
}

export interface ResolvedTenantSecrets {
  /** The tenant's `SECRET_KEY`. Never the fleet-wide one. */
  secretKey: string
  /**
   * How the key was obtained, for the stamp written beside the canary and for
   * the serve-time comparison against it.
   */
  provenance: { refScheme: string; generation: number; material: string }
  /** Null when storage could not be resolved; see {@link storageProblem}. */
  storage: TenantStorageCredentials | null
  /** Why storage is null, in operator-readable terms. Null when storage resolved. */
  storageProblem: string | null
}

export class TenantSecretResolutionError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'TenantSecretResolutionError'
    this.code = code
  }
}

export interface TenantSecretResolutionInput {
  tenantId: string
  appSecretsRef: SecretRef
  /**
   * Optional, because a tenant on the fleet bucket has no credential of its own
   * and its isolation is in the object key rather than in a key pair. Absent
   * resolves to `storage: null` with **no** problem: the caller falls back to
   * the fleet credential. That distinction is the whole point of making it
   * optional rather than letting an unset `env://` ref stand in for "none" —
   * the unset ref produced a `storageProblem`, and a problem is what makes the
   * app answer 503.
   */
  storageCredentialRef?: SecretRef
  /** The fleet root, or null in a process that holds none. */
  rootKey: string | null
  env?: Record<string, string | undefined>
}

/**
 * Resolve both halves for one tenant.
 *
 * Takes the record's own `tenantId` and checks every ref names it. A ref is a
 * value in a row, so a row that named *another* tenant's secret would otherwise
 * derive or open that tenant's material — the storage-side equivalent of §3's
 * wrong-pool failure, and just as quiet. The check is cheap and it is the reason
 * the tenant id appears in the ref path at all rather than only in the key
 * derivation.
 */
export function resolveTenantSecretsFromRefs(
  input: TenantSecretResolutionInput
): ResolvedTenantSecrets {
  const app = resolveAppSecretKey(input)
  const storage = resolveStorageCredentials(input)
  return {
    secretKey: app.secretKey,
    provenance: app.provenance,
    storage: storage.value,
    storageProblem: storage.problem,
  }
}

function resolveAppSecretKey(input: TenantSecretResolutionInput): {
  secretKey: string
  provenance: ResolvedTenantSecrets['provenance']
} {
  const ref = input.appSecretsRef
  const parsed = parseSecretRef(ref)
  switch (parsed.scheme) {
    case 'derived+hkdf': {
      assertRefNamesTenant(parsed.tenantId, input.tenantId, ref)
      assertPurpose(parsed.purpose, 'app-secrets', ref)
      const rootKey = requireRootKey(ref, input.rootKey)
      try {
        return {
          secretKey: deriveTenantSecret(rootKey, {
            generation: parsed.generation,
            tenantId: parsed.tenantId,
            purpose: 'app-secrets',
          }),
          provenance: {
            refScheme: 'derived+hkdf',
            generation: parsed.generation,
            material: rootKey,
          },
        }
      } catch (err) {
        throw asResolutionError(err, ref)
      }
    }
    case 'env': {
      // An env ref carries no tenant, so `assertRefNamesTenant` has nothing to
      // check — and without a check two hand-edited records can name ONE
      // variable and silently share a SECRET_KEY. The canary cannot see that:
      // both tenants derive the same key, so both canaries open. Nothing else
      // in the system would notice either.
      //
      // So the variable NAME carries the tenant, derived deterministically from
      // the tenant id, and a ref naming any other variable is refused. Two
      // tenants can then no longer name one variable, and the operator gets the
      // name to create rather than a rule to remember.
      const expected = tenantAppSecretVariable(input.tenantId)
      if (parsed.variable !== expected) {
        throw new TenantSecretResolutionError(
          'ref_tenant_mismatch',
          `${redactRef(ref)} names ${parsed.variable}, but tenant ${input.tenantId}'s app secret ` +
            `must be held in ${expected}. An env ref carries no tenant of its own, so the ` +
            `variable name is the only thing that can bind it to one.`
        )
      }
      const value = (input.env ?? process.env)[parsed.variable]
      if (!value) {
        throw new TenantSecretResolutionError(
          'app_secret_unresolvable',
          `${redactRef(ref)} names ${parsed.variable}, which is unset`
        )
      }
      return {
        secretKey: value,
        // No generation: an env ref names a variable, not a rotation counter.
        provenance: { refScheme: 'env', generation: 0, material: value },
      }
    }
    default:
      // Named rather than generic: "no resolver" and "wrong scheme" are
      // different operator problems, and the scheme is the fix instruction.
      throw new TenantSecretResolutionError(
        'app_secret_no_resolver',
        `this process has no resolver for '${parsed.scheme}://' app secrets ` +
          `(tenant ${input.tenantId}). Re-point the record at a scheme this fleet implements.`
      )
  }
}

function resolveStorageCredentials(input: TenantSecretResolutionInput): {
  value: TenantStorageCredentials | null
  problem: string | null
} {
  const ref = input.storageCredentialRef
  // No ref is not a failed resolution. Returning a problem here would be
  // indistinguishable from a ref that exists and cannot be dereferenced, and the
  // app turns a problem into a 503 — which is precisely the state a fleet-bucket
  // tenant is supposed to be out of.
  if (ref === undefined) return { value: null, problem: null }
  try {
    const parsed = parseSecretRef(ref)
    switch (parsed.scheme) {
      case 'sealed+aead': {
        assertRefNamesTenant(parsed.tenantId, input.tenantId, ref)
        assertPurpose(parsed.purpose, 'storage', ref)
        const rootKey = requireRootKey(ref, input.rootKey)
        const opened = openTenantSecret(
          rootKey,
          { generation: parsed.generation, tenantId: parsed.tenantId, purpose: 'storage' },
          parsed.blob
        )
        return { value: parseStorageCredentials(opened, ref), problem: null }
      }
      case 'env': {
        const raw = (input.env ?? process.env)[parsed.variable]
        if (!raw) {
          throw new TenantSecretResolutionError(
            'storage_unresolvable',
            `${redactRef(ref)} names ${parsed.variable}, which is unset`
          )
        }
        return { value: parseStorageCredentials(raw, ref), problem: null }
      }
      default:
        throw new TenantSecretResolutionError(
          'storage_no_resolver',
          `this process has no resolver for '${parsed.scheme}://' storage credentials`
        )
    }
  } catch (err) {
    return { value: null, problem: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * The sealed plaintext is `{"accessKeyId":"…","secretAccessKey":"…"}`.
 *
 * Both fields are required and neither may be empty. An S3 client built with an
 * empty secret does not fail at construction — it fails later, at the provider,
 * with a signature error that reads like a clock-skew problem.
 */
function parseStorageCredentials(raw: string, ref: SecretRef): TenantStorageCredentials {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new TenantSecretResolutionError(
      'storage_malformed',
      `${redactRef(ref)} did not contain a JSON credential object`
    )
  }
  const obj = parsed as { accessKeyId?: unknown; secretAccessKey?: unknown }
  if (typeof obj?.accessKeyId !== 'string' || obj.accessKeyId === '') {
    throw new TenantSecretResolutionError(
      'storage_malformed',
      `${redactRef(ref)} has no accessKeyId`
    )
  }
  if (typeof obj?.secretAccessKey !== 'string' || obj.secretAccessKey === '') {
    throw new TenantSecretResolutionError(
      'storage_malformed',
      `${redactRef(ref)} has no secretAccessKey`
    )
  }
  return { accessKeyId: obj.accessKeyId, secretAccessKey: obj.secretAccessKey }
}

/**
 * The one environment variable a tenant's `env://` app-secret ref may name.
 *
 * Deterministic from the tenant id so both sides compute it rather than agree
 * on it. The normalisation is lossy — `inst_a-b`, `inst_a.b` and `inst_a_b` all
 * fold to the same suffix — so a short digest of the original id is appended:
 * two tenants sharing one variable would mean one of them silently encrypting
 * under the other's key, which is the whole failure this is closing.
 *
 * Mirrors `tenantDbSecretVariable` in the control plane's provisioning deps,
 * which does the same job for the database credential.
 */
export function tenantAppSecretVariable(tenantId: string): string {
  const suffix = tenantId
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  if (!suffix) {
    throw new TenantSecretResolutionError(
      'bad_tenant',
      `cannot derive an app-secret variable name from '${tenantId}'`
    )
  }
  const digest = createHash('sha256').update(tenantId).digest('hex').slice(0, 8).toUpperCase()
  return `QUACKBACK_TENANT_SECRET_${suffix}_${digest}_APP`
}

/** Serialise credentials for sealing. The inverse of {@link parseStorageCredentials}. */
export function encodeStorageCredentials(creds: TenantStorageCredentials): string {
  return JSON.stringify({
    accessKeyId: creds.accessKeyId,
    secretAccessKey: creds.secretAccessKey,
  })
}

function assertRefNamesTenant(refTenantId: string, recordTenantId: string, ref: SecretRef): void {
  if (refTenantId !== recordTenantId) {
    throw new TenantSecretResolutionError(
      'ref_tenant_mismatch',
      `${redactRef(ref)} names tenant ${refTenantId} but sits on the record for ${recordTenantId}`
    )
  }
}

function assertPurpose(purpose: string, expected: FleetSecretPurpose, ref: SecretRef): void {
  if (purpose !== expected) {
    throw new TenantSecretResolutionError(
      'ref_purpose_mismatch',
      `${redactRef(ref)} has purpose '${purpose}' where '${expected}' was required`
    )
  }
}

function requireRootKey(ref: SecretRef, rootKey: string | null): string {
  if (!rootKey) {
    throw new TenantSecretResolutionError(
      'root_key_missing',
      `${redactRef(ref)} needs the fleet root key; QUACKBACK_FLEET_ROOT_KEY is unset in this process`
    )
  }
  return rootKey
}

function asResolutionError(err: unknown, ref: SecretRef): TenantSecretResolutionError {
  if (err instanceof FleetSecretError) {
    return new TenantSecretResolutionError(err.code, `${redactRef(ref)}: ${err.message}`)
  }
  if (err instanceof TenantSecretResolutionError) return err
  return new TenantSecretResolutionError(
    'unresolvable',
    `${redactRef(ref)}: ${err instanceof Error ? err.message : String(err)}`
  )
}
