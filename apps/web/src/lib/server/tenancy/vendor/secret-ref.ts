/**
 * Secret references, and how they resolve.
 *
 * The registry stores references, never secrets. SAAS-HOSTING-STACK.md §4.3
 * asks for `secretKeyRef` to resolve "correctly and atomically with
 * databaseUrl"; keeping both in one record is what makes that true, and keeping
 * the secret out of the control database is what keeps a control-plane
 * compromise from being a fleet-wide credential dump.
 *
 * Schemes:
 *
 *   neon+role://<proj>/<br>/<role> the password Neon already holds, revealed
 *                                  through the Management API. This is why the
 *                                  record carries `dbRole`: a rotation lands
 *                                  under a live pool, so the pool cache must be
 *                                  able to re-resolve and reconnect (§6).
 *   derived+hkdf://v<g>/<t>/<p>    derived from the fleet root — nothing stored.
 *   sealed+aead://v<g>/<t>/<p>/<b> sealed under the fleet root — the blob is the
 *                                  reference, so it is read atomically with the
 *                                  DSN rather than fetched afterwards.
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

export const SECRET_REF_SCHEMES = [
  'neon+role',
  'derived+hkdf',
  'sealed+aead',
  'env',
] as const

export type SecretRefScheme = (typeof SECRET_REF_SCHEMES)[number]

export type ParsedSecretRef =
  | { scheme: 'neon+role'; projectId: string; branchId: string; role: string }
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
  // A serving Postgres password. `derived+hkdf` and `sealed+aead` are absent
  // deliberately: a database password is issued by a provider, never chosen by
  // us, and a scheme the resolver refuses must not be committable in the column.
  database: ['neon+role', 'env'],
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
  return FIELD_POLICY[field].includes(parsed.scheme)
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
const DERIVED_REF_RE = /^v([1-9][0-9]{0,3})\/([A-Za-z0-9][A-Za-z0-9_.-]{0,127})\/([a-z][a-z-]{0,31})$/

/**
 * `sealed+aead://v<generation>/<tenantId>/<purpose>/<base64url blob>`.
 *
 * The blob is base64url — `+` and `/` would collide with the scheme separator
 * and the path separator respectively, so the alphabet is not a preference.
 */
const SEALED_REF_RE =
  /^v([1-9][0-9]{0,3})\/([A-Za-z0-9][A-Za-z0-9_.-]{0,127})\/([a-z][a-z-]{0,31})\/([A-Za-z0-9_-]{16,4096})$/

/**
 * `neon+role://<projectId>/<branchId>/<role>`.
 *
 * Strict, because this ref is dereferenced against the Neon Management API with
 * an organisation-wide key: every component is interpolated into a URL path, so
 * anything looser is a request-forgery primitive rather than a reference. Neon's
 * own id shapes are narrow, so nothing is given up by pinning them.
 */
const NEON_ROLE_REF_RE = /^([a-z0-9][a-z0-9-]{0,62})\/(br-[a-z0-9-]{1,62})\/([a-zA-Z_][a-zA-Z0-9_$]{0,62})$/

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
    case 'neon+role': {
      const m = NEON_ROLE_REF_RE.exec(rest)
      if (!m) throw new SecretRefError(`not a Neon role reference: ${rest}`)
      return { scheme, projectId: m[1]!, branchId: m[2]!, role: m[3]! }
    }
    case 'env':
      if (!ENV_REF_NAME_RE.test(rest)) {
        throw new SecretRefError(
          `env refs may only name variables matching ${ENV_REF_PREFIX}*, got ${rest}`,
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
export function derivedSecretRef(
  generation: number,
  tenantId: string,
  purpose: string,
): SecretRef {
  const ref = `derived+hkdf://v${generation}/${tenantId}/${purpose}`
  parseSecretRef(ref)
  return ref
}

/** Build a sealed-secret ref around an already-sealed blob. */
export function sealedSecretRef(
  generation: number,
  tenantId: string,
  purpose: string,
  blob: string,
): SecretRef {
  const ref = `sealed+aead://v${generation}/${tenantId}/${purpose}/${blob}`
  parseSecretRef(ref)
  return ref
}

/**
 * Build a Neon role reference.
 *
 * Neon holds the role password (`store_passwords`) and exposes it through
 * `reveal_password`, so the control plane can name the credential without ever
 * storing it — which is what a reference is supposed to mean. It also exposes
 * `reset_password`, so this scheme has a rotation story rather than a promise of
 * one.
 */
export function neonRoleRef(projectId: string, branchId: string, role: string): SecretRef {
  const ref = `${projectId}/${branchId}/${role}`
  if (!NEON_ROLE_REF_RE.test(ref)) {
    throw new SecretRefError(`not a Neon role reference: ${ref}`)
  }
  return `neon+role://${ref}`
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
 * `readStaticCreds` is injected rather than imported so this stays testable
 * without a Neon client, and so callers outside the control plane (scripts) can
 * supply their own.
 */
export async function resolveDbCredential(
  ref: SecretRef,
  deps: {
    /**
     * Reveal the password Neon holds for a role. Injected rather than imported
     * so this module stays free of the Neon client, and so a process that never
     * serves Neon tenants never needs an API key.
     */
    readNeonRolePassword?: (target: {
      projectId: string
      branchId: string
      role: string
    }) => Promise<string>
    env?: Record<string, string | undefined>
  },
): Promise<{ username: string; password: string }> {
  const parsed = parseSecretRef(ref)
  switch (parsed.scheme) {
    case 'neon+role': {
      if (!deps.readNeonRolePassword) {
        throw new SecretRefError(
          `${redactRef(ref)} needs a Neon reader; this process has none configured`,
        )
      }
      const password = await deps.readNeonRolePassword({
        projectId: parsed.projectId,
        branchId: parsed.branchId,
        role: parsed.role,
      })
      if (!password) throw new SecretRefError(`no password at ${redactRef(ref)}`)
      return { username: parsed.role, password }
    }
    case 'env': {
      const source = deps.env ?? process.env
      const password = source[parsed.variable]
      if (!password) throw new SecretRefError(`${parsed.variable} is unset`)
      // The username is the record's dbRole; env refs carry only the password.
      return { username: '', password }
    }
    case 'derived+hkdf':
    case 'sealed+aead':
      // Every one of these names an application secret. Refusing by name rather
      // than falling through keeps the two custody stories separate: a database
      // password is issued by a provider or a vault, never chosen by us.
      throw new SecretRefError(
        `${parsed.scheme}:// refs hold application secrets, not database credentials`,
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
