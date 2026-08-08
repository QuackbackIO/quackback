/**
 * Secret references, and how they resolve.
 *
 * The registry stores references, never secrets. SAAS-HOSTING-STACK.md §4.3
 * asks for `secretKeyRef` to resolve "correctly and atomically with
 * databaseUrl"; keeping both in one record is what makes that true, and keeping
 * the secret out of the control database is what keeps a control-plane
 * compromise from being a fleet-wide credential dump.
 *
 * Three schemes:
 *
 *   openbao+static-role://<role>   the OpenBao-rotated Postgres serving
 *                                  credential (`database/static-creds/<role>`).
 *                                  This is why the record carries `dbRole`:
 *                                  OpenBao rotates the password out from under
 *                                  a live pool, so the pool cache must be able
 *                                  to re-resolve and reconnect (§6).
 *   openbao+kv://<path>            KV v2 path holding the app secret bundle.
 *   env://<VAR>                    a fleet-level environment variable.
 *
 * `env://` exists because a small operator-managed fleet can genuinely deliver
 * per-tenant secrets as sealed platform variables, and because it lets the
 * registry be exercised end to end without OpenBao. It does not scale to
 * thousands of tenants and is not the production path.
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
  'openbao+static-role',
  'openbao+kv',
  'neon+role',
  'env',
] as const

export type ParsedSecretRef =
  | { scheme: 'openbao+static-role'; role: string }
  | { scheme: 'openbao+kv'; path: string }
  | { scheme: 'neon+role'; projectId: string; branchId: string; role: string }
  | { scheme: 'env'; variable: string }

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

/** Postgres identifier shape — the role name goes into an OpenBao path. */
const ROLE_RE = /^[a-zA-Z_][a-zA-Z0-9_$]*$/
/** No traversal, no absolute paths, no query smuggling. */
const KV_PATH_RE = /^[A-Za-z0-9][A-Za-z0-9._\-/]*$/

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
    case 'openbao+static-role':
      if (!ROLE_RE.test(rest)) throw new SecretRefError(`not a Postgres role name: ${rest}`)
      return { scheme, role: rest }
    case 'openbao+kv':
      if (!KV_PATH_RE.test(rest) || rest.includes('..')) {
        throw new SecretRefError(`not a safe OpenBao KV path: ${rest}`)
      }
      return { scheme, path: rest }
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

/** Build a static-role ref for a Postgres role. */
export function staticRoleRef(role: string): SecretRef {
  if (!ROLE_RE.test(role)) throw new SecretRefError(`not a Postgres role name: ${role}`)
  return `openbao+static-role://${role}`
}

/** Build a KV ref for an OpenBao path. */
export function kvRef(path: string): SecretRef {
  if (!KV_PATH_RE.test(path) || path.includes('..')) {
    throw new SecretRefError(`not a safe OpenBao KV path: ${path}`)
  }
  return `openbao+kv://${path}`
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
 * without an OpenBao client, and so callers outside the CP pod (scripts) can
 * supply their own.
 */
export async function resolveDbCredential(
  ref: SecretRef,
  deps: {
    readStaticCreds: (role: string) => Promise<{ username: string; password: string }>
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
    case 'openbao+static-role': {
      const creds = await deps.readStaticCreds(parsed.role)
      if (!creds?.password) throw new SecretRefError(`no password at ${redactRef(ref)}`)
      return creds
    }
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
    case 'openbao+kv':
      throw new SecretRefError(
        'openbao+kv refs hold the app secret bundle, not database credentials',
      )
  }
}

/**
 * Inject a password into a password-less DSN.
 *
 * The registry stores `scheme://role@host/db`; a client needs
 * `scheme://role:password@host/db`. Percent-encoding matters — OpenBao's
 * rotated passwords are generated, and a `/`, `@` or `#` in one silently
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
