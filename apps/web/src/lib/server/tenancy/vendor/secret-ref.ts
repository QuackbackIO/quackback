/**
 * Secret references, and how they resolve.
 *
 * The registry stores references, never secrets. `secretKeyRef` must resolve
 * correctly and atomically with `databaseUrl`; keeping both in one record is
 * what makes that true, and keeping the secret out of the control database is
 * what keeps a control-plane compromise from being a fleet-wide credential
 * dump.
 *
 * Schemes:
 *
 *   sealed+aead://v<g>/<t>/db/<b>  the serving Postgres password, sealed under
 *                                  the fleet root. We issue the password
 *                                  (`CREATE ROLE … PASSWORD`) so it is a value
 *                                  we chose, and the blob rides in the same
 *                                  registry row as the DSN.
 *   derived+hkdf://v<g>/<t>/<p>    derived from the fleet root — nothing stored.
 *   env://<VAR>                    a fleet-level environment variable.
 *
 * `env://` exists because a small operator-managed fleet can genuinely deliver
 * per-tenant secrets as sealed platform variables, and because it lets the
 * registry be exercised end to end with no external secret store at all. It does
 * not scale to thousands of tenants and is not the production path.
 *
 * ## Namespace confinement is part of the scheme, not a caller's job
 *
 * A ref comes out of a database. It is input. `env://` is confined to
 * `QUACKBACK_TENANT_SECRET_*` for that reason — otherwise a mistaken or
 * tampered row saying `env://STRIPE_SECRET_KEY` resolves happily.
 *
 * ## Which field may name which scheme
 *
 * A scheme being implementable is not the same as it being appropriate. A
 * database credential must not be expressible as an app-secret bundle, and a
 * scheme that cannot hold a provider-issued value must not be expressible in the
 * field that needs one. {@link isSecretRefAllowedFor} is that policy, enforced
 * at write time, at read time and by a database CHECK — all three, because a ref
 * that only fails when a request needs it is a ref that looked valid until the
 * worst possible moment.
 */

/**
 * A reference to a secret, never the secret itself.
 *
 * This module is a leaf: `contract.ts` imports {@link parseSecretRef} so that
 * the SAME rule that governs resolution also governs what may be written and
 * what may be read. A ref validated only at resolve time is a ref that can sit
 * in the control database looking valid.
 */
export type SecretRef = string

export const SECRET_REF_SCHEMES = ['derived+hkdf', 'sealed+aead', 'env'] as const

export type SecretRefScheme = (typeof SECRET_REF_SCHEMES)[number]

export type ParsedSecretRef =
  | { scheme: 'derived+hkdf'; generation: number; tenantId: string; purpose: string }
  | {
      scheme: 'sealed+aead'
      generation: number
      tenantId: string
      purpose: string
      blob: string
    }
  | { scheme: 'env'; variable: string }

/**
 * The ref-bearing fields of a tenant record, and what each may name.
 *
 * Read this as the answer to "what could this row make the fleet go and fetch?"
 * rather than as a type constraint.
 */
export type SecretRefField = 'database' | 'appSecrets' | 'storage'

const FIELD_POLICY: Record<SecretRefField, readonly SecretRefScheme[]> = {
  // We issue the serving password (`CREATE ROLE`), so `sealed+aead` is the
  // production scheme. `env://` is the small-operator path.
  database: ['sealed+aead', 'env'],
  // SECRET_KEY and the app-internal bearer tokens. `derived+hkdf` is the default:
  // these are values we choose, so nothing has to carry them.
  appSecrets: ['derived+hkdf', 'env'],
  // Provider-issued object-storage keys. Cloudflare mints them, so they cannot be
  // derived and must be carried; `derived+hkdf` is absent because a scheme that
  // silently invents a plausible-looking key pair for a real bucket is worse than
  // one that refuses.
  storage: ['sealed+aead', 'env'],
}

/** The schemes `field` may name. */
export function allowedSchemesFor(field: SecretRefField): readonly SecretRefScheme[] {
  return FIELD_POLICY[field]
}

/** True when `ref` parses AND the field it sits in is allowed to name its scheme. */
export function isSecretRefAllowedFor(field: SecretRefField, ref: unknown): ref is SecretRef {
  if (typeof ref !== 'string') return false
  let parsed: ParsedSecretRef
  try {
    parsed = parseSecretRef(ref)
  } catch {
    return false
  }
  if (!FIELD_POLICY[field].includes(parsed.scheme)) return false
  if (parsed.scheme === 'sealed+aead') {
    if (field === 'database' && parsed.purpose !== 'db') return false
    if (field === 'storage' && parsed.purpose !== 'storage') return false
  }
  return true
}

export class SecretRefError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SecretRefError'
  }
}

/** True when `ref` is a well-formed, in-policy secret reference. */
export function isValidSecretRef(ref: unknown): ref is SecretRef {
  if (typeof ref !== 'string') return false
  try {
    parseSecretRef(ref)
    return true
  } catch {
    return false
  }
}

/**
 * Environment variables an `env://` ref is allowed to name.
 *
 * Without this, a ref is an arbitrary read of the CP process environment: a
 * mistaken or tampered row saying `env://STRIPE_SECRET_KEY` would resolve
 * happily. Refs come out of a database, so they are input, and input does not
 * get to choose which variable it reads.
 */
const ENV_REF_PREFIX = 'QUACKBACK_TENANT_SECRET_'
const ENV_REF_NAME_RE = /^QUACKBACK_TENANT_SECRET_[A-Z0-9_]+$/

/** `derived+hkdf://v<generation>/<tenantId>/<purpose>`. */
const DERIVED_REF_RE =
  /^v([1-9][0-9]{0,3})\/([A-Za-z0-9][A-Za-z0-9_.-]{0,127})\/([a-z][a-z-]{0,31})$/

/**
 * `sealed+aead://v<generation>/<tenantId>/<purpose>/<base64url blob>`.
 *
 * The blob is base64url — `+` and `/` would collide with the scheme separator
 * and the path separator respectively, so the alphabet is not a preference.
 */
const SEALED_REF_RE =
  /^v([1-9][0-9]{0,3})\/([A-Za-z0-9][A-Za-z0-9_.-]{0,127})\/([a-z][a-z-]{0,31})\/([A-Za-z0-9_-]{16,4096})$/

export function parseSecretRef(ref: SecretRef): ParsedSecretRef {
  const idx = ref.indexOf('://')
  if (idx < 0) throw new SecretRefError(`secret ref has no scheme: ${redactRef(ref)}`)
  const scheme = ref.slice(0, idx)
  const rest = ref.slice(idx + 3)
  if (!(SECRET_REF_SCHEMES as readonly string[]).includes(scheme)) {
    throw new SecretRefError(`unsupported secret-ref scheme: ${scheme}`)
  }
  if (rest === '') throw new SecretRefError(`secret ref ${scheme}:// has an empty body`)

  switch (scheme) {
    case 'derived+hkdf': {
      const m = DERIVED_REF_RE.exec(rest)
      if (!m) throw new SecretRefError(`not a derived secret reference: ${rest}`)
      return { scheme, generation: Number(m[1]), tenantId: m[2]!, purpose: m[3]! }
    }
    case 'sealed+aead': {
      const m = SEALED_REF_RE.exec(rest)
      if (!m) throw new SecretRefError(`not a sealed secret reference: ${redactRef(ref)}`)
      return {
        scheme,
        generation: Number(m[1]),
        tenantId: m[2]!,
        purpose: m[3]!,
        blob: m[4]!,
      }
    }
    case 'env':
      if (!ENV_REF_NAME_RE.test(rest)) {
        throw new SecretRefError(
          `env refs may only name variables matching ${ENV_REF_PREFIX}*, got ${rest}`
        )
      }
      return { scheme, variable: rest }
    default:
      throw new SecretRefError(`unsupported secret-ref scheme: ${scheme}`)
  }
}

/**
 * Build a derived-secret ref.
 *
 * Nothing is written: the point of derivation is that there is nothing to write.
 * A "writer" that persisted a copy would put back exactly the delivery problem
 * the scheme removes.
 */
export function derivedSecretRef(generation: number, tenantId: string, purpose: string): SecretRef {
  const ref = `derived+hkdf://v${generation}/${tenantId}/${purpose}`
  parseSecretRef(ref)
  return ref
}

/** Build a sealed-secret ref around an already-sealed blob. */
export function sealedSecretRef(
  generation: number,
  tenantId: string,
  purpose: string,
  blob: string
): SecretRef {
  const ref = `sealed+aead://v${generation}/${tenantId}/${purpose}/${blob}`
  parseSecretRef(ref)
  return ref
}

/** Build an env ref. The variable name must be in the reserved namespace. */
export function envRef(variable: string): SecretRef {
  if (!ENV_REF_NAME_RE.test(variable)) {
    throw new SecretRefError(`env refs may only name variables matching ${ENV_REF_PREFIX}*`)
  }
  return `env://${variable}`
}

/**
 * Resolve a database credential reference to a username/password pair.
 *
 * Deliberately narrow: it resolves DB credentials and nothing else, so a ref
 * pointing at the app-secret bundle cannot be dereferenced through this path.
 *
 * `openSealedDbPassword` is injected rather than imported so this stays
 * testable without the fleet-root reader, and so callers outside the control
 * plane (scripts) can supply their own.
 */
export async function resolveDbCredential(
  ref: SecretRef,
  deps: {
    /**
     * Open a sealed database password. Injected so this module stays free of
     * the fleet-root reader.
     */
    openSealedDbPassword?: (target: {
      generation: number
      tenantId: string
      purpose: string
      blob: string
    }) => Promise<string>
    env?: Record<string, string | undefined>
  }
): Promise<{ username: string; password: string }> {
  const parsed = parseSecretRef(ref)
  switch (parsed.scheme) {
    case 'sealed+aead': {
      if (parsed.purpose !== 'db') {
        throw new SecretRefError(
          `${redactRef(ref)} is sealed for '${parsed.purpose}', not a database password`
        )
      }
      if (!deps.openSealedDbPassword) {
        throw new SecretRefError(
          `${redactRef(ref)} needs a sealed-password opener; this process has none configured`
        )
      }
      const password = await deps.openSealedDbPassword({
        generation: parsed.generation,
        tenantId: parsed.tenantId,
        purpose: parsed.purpose,
        blob: parsed.blob,
      })
      if (!password) throw new SecretRefError(`no password at ${redactRef(ref)}`)
      return { username: '', password }
    }
    case 'env': {
      const source = deps.env ?? process.env
      const password = source[parsed.variable]
      if (!password) throw new SecretRefError(`${parsed.variable} is unset`)
      // The username is the record's dbRole; env refs carry only the password.
      return { username: '', password }
    }
    case 'derived+hkdf':
      throw new SecretRefError(
        `${parsed.scheme}:// refs hold application secrets, not database credentials`
      )
  }
}

/**
 * Inject a password into a password-less DSN.
 *
 * The registry stores `scheme://role@host/db`; a client needs
 * `scheme://role:password@host/db`. Percent-encoding matters — a provider's
 * generated password can contain a `/`, `@` or `#`, and any of them silently
 * reshapes the URL into a connection somewhere else.
 */
export function withPassword(dsn: string, password: string): string {
  const idx = dsn.indexOf('://')
  if (idx < 0) throw new SecretRefError('not a DSN')
  const scheme = dsn.slice(0, idx)
  const rest = dsn.slice(idx + 3)
  const at = rest.indexOf('@')
  if (at < 0) throw new SecretRefError('DSN has no userinfo')
  const userinfo = rest.slice(0, at)
  if (userinfo.includes(':')) throw new SecretRefError('DSN already carries a password')
  return `${scheme}://${userinfo}:${encodeURIComponent(password)}@${rest.slice(at + 1)}`
}

/** Refs are not secret, but they name secrets; keep them short in logs. */
export function redactRef(ref: string): string {
  const idx = ref.indexOf('://')
  if (idx < 0) return '<malformed-ref>'
  return `${ref.slice(0, idx)}://…`
}
