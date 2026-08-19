/**
 * The workspace registry contract.
 *
 * This module is the written form of the seam between the control plane and the
 * pooled app fleet. The CP writes registry records; the app resolves the Host
 * header to one on every request, before auth runs and before it spends a
 * database connection. `docs/WORKSPACE-REGISTRY-CONTRACT.md` is the same contract
 * stated for the app team; this file is what the CP enforces.
 *
 * Three properties are load-bearing, and every design choice below serves one
 * of them.
 *
 * 1. COMPLETE. A record carries everything needed to serve a request. There is
 *    no field the app is expected to infer, default, or parse out of another
 *    field. If a value is per-workspace it is a field; if it is fleet-wide it is
 *    deliberately absent (see the doc's "deliberately absent" section).
 *
 * 2. FAIL CLOSED. Per SAAS-HOSTING-STACK.md §3 there is no second gate: if
 *    workspace resolution returns the wrong pool, every RBAC check still passes,
 *    because that database's own rows are self-consistent. It does not error;
 *    it looks correct. So anything less than a wholly valid, active, fingerprinted
 *    record must be unusable rather than partially usable. That is expressed
 *    here as a type: {@link WorkspaceResolution} only carries connection material
 *    in its `ok` variant, so there is no way to reach a DSN from a suspended,
 *    unknown or malformed record.
 *
 * 3. VERIFIABLE. The record names the fingerprint the workspace database must
 *    carry. {@link evaluateFingerprint} is the exact predicate the app runs on
 *    pool checkout; it lives here rather than in prose so both sides test the
 *    same function.
 */
import { z } from 'zod'
import { MAIL_SLUG_MAX_LENGTH, MAIL_SLUG_PATTERN } from './mail-slug-pattern'
import {
  SECRET_REF_SCHEMES,
  isSecretRefAllowedFor,
  isValidSecretRef,
  parseSecretRef,
  type ParsedSecretRef,
  type SecretRef,
  type SecretRefField,
} from './secret-ref'
import { workspaceAppSecretVariable } from './workspace-secret-resolution'

export { SECRET_REF_SCHEMES, type SecretRef }

/**
 * Bumped when the record shape changes in a way a reader must notice. A reader
 * refuses a record whose version it does not implement, rather than reading a
 * familiar-looking subset of an unfamiliar record.
 *
 * "In a way a reader must notice" is the whole of the test, and it is narrower
 * than "the shape changed". The gate below is exact equality, not a floor, so a
 * bump is not a compatibility signal — it is a fleet-wide refusal that lasts
 * until every replica carries the new reader. Purely ADDITIVE fields therefore
 * do not bump it: an older reader that ignores a new column serves exactly what
 * it served before, and trading that for a 503 on every hostname buys nothing.
 * A bump is for a change that makes the OLD reading wrong — a field whose
 * meaning moved, a value that stopped being what it says, an invariant that no
 * longer holds.
 */
export const WORKSPACE_REGISTRY_CONTRACT_VERSION = 1

/** Serving state. Gated before a database connection is spent. */
export type WorkspaceState = 'active' | 'suspended' | 'deleting'

export type WorkspaceHostnameKind = 'system' | 'platform' | 'platform_redirect' | 'custom'

/** One bucket per workspace (SAAS-HOSTING-STACK.md §9). */
export type WorkspaceStorage = {
  provider: 'r2'
  bucket: string
  endpoint: string
  region: string
  forcePathStyle: boolean
  /**
   * The origin public asset URLs are built from. Pinned at provisioning and
   * never changed while content exists: contentJson stores absolute image URLs,
   * so moving the origin rewrites historical post, changelog and article
   * content.
   *
   * Explicit rather than derived. The app's `buildPublicUrl` falls back to
   * `${config.baseUrl}/api/storage/<key>` when S3_PUBLIC_URL is unset, and
   * under pooling `baseUrl` is per-request — which would make a workspace's asset
   * origin follow whichever hostname the visitor happened to use.
   */
  publicUrl: string
  /**
   * Optional, and its absence is the pooled default rather than an omission.
   *
   * A workspace on the fleet bucket has no credential of its own: the bucket is
   * shared and every object name is composed under that workspace's own prefix, so
   * the isolation is in the key rather than in the key pair. The app reads this
   * field when it is present and falls back to the fleet `S3_*` credential when
   * it is not, which is why "absent" has to be representable here rather than
   * expressed as an env ref pointing at a variable nobody sets.
   *
   * Present still means fully validated: a ref that exists must name its own
   * workspace and match a supported scheme, because a malformed ref is a different
   * thing from no ref at all.
   */
  credentialRef?: SecretRef
}

/**
 * What the app must find in the workspace database. The CP stamps `workspaceKey` into
 * the workspace's `settings` row at provisioning and records the `selfReportedWorkspaceId` it
 * observed there; the app asserts both on pool checkout.
 *
 * Two independent facts on purpose. `selfReportedWorkspaceId` is `settings.id`, a primary
 * key no application write can change — it cannot be clobbered, but the CP only
 * observed it. `workspaceKey` is a value the CP deliberately wrote — it can in
 * principle be erased by a settings write that rebuilds the metadata bag from
 * scratch, but its presence is a positive claim rather than an observation.
 * Requiring both means neither weakness stands alone.
 */
export type WorkspaceFingerprintExpectation = {
  /** Value the workspace database's settings row must carry. Equals `workspaceKey`. */
  expectedWorkspaceKey: string
  /** `settings.id` (a UUID) observed when the stamp was written. */
  expectedSelfReportedWorkspaceId: string
  stampedAt: string
}

/** A complete, active, servable workspace. */
export type WorkspaceRecord = {
  contractVersion: number
  workspaceKey: string
  /** Monotonic; bumped by the database on any change. Cache invalidation key. */
  revision: number

  routing: {
    /** Canonical hostname. `baseUrl` is pinned to it. */
    primaryHostname: string
    /** Every hostname that routes here, including the primary. */
    hostnames: string[]
    /**
     * Absolute origin for this workspace: cookie domain/secure derivation, email
     * links, trusted origins, absolute asset URLs. Always `scheme://primaryHostname`.
     *
     * Never derive this from the platform's own public domain: once a wildcard
     * custom domain is attached, that value is the literal string
     * `*.quackback.io` (SAAS-HOSTING-STACK.md §9).
     */
    baseUrl: string
  }

  database: {
    /** Transaction-mode pooled endpoint. The web tier. Password-less. */
    pooledUrl: string
    /**
     * Session-mode direct endpoint. The outbox relay, the queue poller and the
     * migrator (§7.3): LISTEN registration is silently lost through a
     * transaction pooler, and pg_advisory_lock / CREATE INDEX CONCURRENTLY
     * cannot run through one. Password-less.
     */
    directUrl: string
    name: string
    /**
     * The serving role. First-class rather than parsed from the DSN because the
     * pool cache needs it to notice a rotated static-role password and
     * reconnect (§6).
     */
    role: string
    credentialRef: SecretRef
  }

  fingerprint: WorkspaceFingerprintExpectation

  secrets: {
    /** SECRET_KEY, ADMIN_API_TOKEN, QUACKBACK_CP_INTERNAL_TOKEN, S3 keys. */
    appSecretsRef: SecretRef
  }

  storage: WorkspaceStorage

  email: {
    /** EMAIL_FROM. The provider API key itself is fleet-wide. */
    from: string
    /**
     * This workspace's label in the fleet's single shared inbound mail domain:
     * `<mailSlug>@<inbound domain>` reaches it, and a reply address is
     * `<mailSlug>+<marker><conversation suffix>.<signature>@<inbound domain>`.
     *
     * Per-workspace rather than fleet-wide, and therefore a field: the inbound
     * domain, its routing rule and the signing secret are all one-per-fleet, but
     * the address has to name a workspace before anything can start resolving
     * it. Conversation ids live in per-workspace databases, so a bare
     * conversation id in an address identifies nothing until the workspace is
     * already known.
     *
     * Minted once at registration and never recomputed. An address that has
     * reached a customer's mail client outlives every other routing fact about a
     * workspace, including its primary hostname, so this is the one identifier
     * here that a hostname change must not move.
     */
    mailSlug: string
  }

  features: {
    /** Whether AI is on for this plan. The AI keys are fleet-wide (§8). */
    aiEnabled: boolean
  }
}

/**
 * The only thing a resolver may return.
 *
 * `ok` is the sole variant carrying connection material, so a caller cannot
 * reach a DSN out of a suspended, deleting, unknown or malformed record even by
 * accident. That is the fail-closed property expressed as a type rather than as
 * a convention.
 */
export type WorkspaceResolution =
  | { kind: 'ok'; workspace: WorkspaceRecord }
  | { kind: 'unknown_host'; hostname: string }
  | { kind: 'redirect'; workspaceKey: string; hostname: string; location: string }
  | { kind: 'suspended'; workspaceKey: string; hostname: string; reason: string }
  | { kind: 'deleting'; workspaceKey: string; hostname: string }
  /**
   * A record exists but does not satisfy the contract: a version the reader
   * does not implement, a field that failed validation, an internally
   * inconsistent record. Never serve it. `problems` is for the operator log.
   */
  | { kind: 'invalid'; workspaceKey: string | null; hostname: string; problems: string[] }

// ─────────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────────

const HOSTNAME_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
/** `scheme://role@host[:port]/db[?params]` — a colon in the userinfo would be a password. */
const DSN_RE = /^postgres(ql)?:\/\/[^:@/]+@[^@/:]+(:\d+)?\/[^/?]+(\?.*)?$/

export const hostnameSchema = z.string().regex(HOSTNAME_RE, 'not a bare lowercase DNS hostname')

/**
 * The slug vocabulary itself lives in `mail-slug-pattern.ts` — a module with no
 * imports, so the edge Email Worker can apply the identical rule without
 * pulling this schema and zod into a workerd bundle. Re-exported here because
 * this file remains the contract server code reads.
 */
export { MAIL_SLUG_MAX_LENGTH, MAIL_SLUG_PATTERN }

export const mailSlugSchema = z
  .string()
  .regex(
    MAIL_SLUG_PATTERN,
    `not a legal mail slug: 1-${MAIL_SLUG_MAX_LENGTH} characters of a-z, 0-9 and '-'`,
  )
/**
 * Validated with the same parser the resolver uses, not merely a scheme check.
 *
 * A ref names a secret, and refs come out of a database, so the rules about
 * WHICH secret a ref may name (an env ref may only reach the reserved
 * QUACKBACK_TENANT_SECRET_* namespace; a KV path may not traverse) have to hold
 * at write time and read time, not just at resolve time. Enforcing them only in
 * the resolver leaves a record that looks valid, reads valid, and fails at the
 * moment a request needs it.
 */
export const secretRefSchema = z
  .string()
  .refine(isValidSecretRef, 'not a well-formed, in-policy secret reference')

/**
 * The same parser, plus the per-field scheme policy.
 *
 * A scheme being implementable is not the same as it being appropriate here.
 * a sealed ref with purpose `db` is the serving Postgres password; a scheme that
 * cannot carry a provider-issued key pair must not be committable in the
 * storage credential. Stating that once, in `secret-ref.ts`, keeps the
 * schema, the database CHECK and the resolver from drifting into three opinions.
 */
export function fieldRefSchema(field: SecretRefField) {
  return z
    .string()
    .refine(
      (ref) => isSecretRefAllowedFor(field, ref),
      `not a well-formed secret reference this record's ${field} field may name`,
    )
}

export const workspaceStorageSchema = z.object({
  provider: z.literal('r2'),
  bucket: z.string().min(1),
  endpoint: z.string().url(),
  region: z.string().min(1),
  forcePathStyle: z.boolean(),
  publicUrl: z.string().url(),
  // Optional, but not weakened: `.optional()` admits absence and nothing else,
  // so a ref that IS supplied still has to satisfy `fieldRefSchema` in full.
  credentialRef: fieldRefSchema('storage').optional(),
})

export const workspaceRecordSchema = z.object({
  contractVersion: z.number().int().min(1),
  workspaceKey: z.string().min(1),
  revision: z.number().int().min(1),
  routing: z.object({
    primaryHostname: hostnameSchema,
    hostnames: z.array(hostnameSchema).min(1),
    baseUrl: z.string().url(),
  }),
  database: z.object({
    pooledUrl: z.string().regex(DSN_RE, 'pooled DSN must be scheme://role@host/db with no password'),
    directUrl: z.string().regex(DSN_RE, 'direct DSN must be scheme://role@host/db with no password'),
    name: z.string().min(1),
    role: z.string().min(1),
    credentialRef: fieldRefSchema('database'),
  }),
  fingerprint: z.object({
    expectedWorkspaceKey: z.string().min(1),
    expectedSelfReportedWorkspaceId: z.string().regex(UUID_RE, 'workspace id must be the settings.id UUID'),
    stampedAt: z.string().min(1),
  }),
  secrets: z.object({ appSecretsRef: fieldRefSchema('appSecrets') }),
  storage: workspaceStorageSchema,
  email: z.object({ from: z.string().min(1), mailSlug: mailSlugSchema }),
  features: z.object({ aiEnabled: z.boolean() }),
})

/**
 * Cross-field invariants the per-field schema cannot state.
 *
 * These duplicate CHECK constraints in drizzle/0043 on purpose. The constraints
 * stop a bad record being written; this stops a bad record being *believed* —
 * after a hand-run UPDATE during an incident, a restore from an older schema,
 * or a future column added without a matching constraint. A reader that trusts
 * the writer is one migration away from serving the wrong workspace.
 */
/**
 * The complaint about `ref`, or null when it is consistent with `workspaceKey`.
 *
 * Returns a message rather than a boolean so the caller can name which field
 * was wrong — during an incident "a ref is wrong" is not an actionable line.
 */
function workspaceNamedBySecretRef(
  ref: SecretRef,
  workspaceKey: string,
  purpose: 'app-secrets' | 'storage' | 'db',
): string | null {
  let parsed: ParsedSecretRef
  try {
    parsed = parseSecretRef(ref)
  } catch {
    return null // shape is the per-field schema's job; do not report it twice
  }
  if (parsed.scheme === 'derived+hkdf' || parsed.scheme === 'sealed+aead') {
    if (parsed.workspaceKey !== workspaceKey) {
      return `names workspace ${parsed.workspaceKey}, not ${workspaceKey}`
    }
    if (parsed.purpose !== purpose) {
      return `has purpose '${parsed.purpose}' where '${purpose}' was required`
    }
    return null
  }
  if (parsed.scheme === 'env' && purpose === 'app-secrets') {
    const expected = workspaceAppSecretVariable(workspaceKey)
    if (parsed.variable !== expected) {
      return `names ${parsed.variable}, but ${workspaceKey}'s app secret must be held in ${expected}`
    }
  }
  return null
}

export function checkWorkspaceRecordInvariants(record: WorkspaceRecord): string[] {
  const problems: string[] = []

  if (record.contractVersion !== WORKSPACE_REGISTRY_CONTRACT_VERSION) {
    problems.push(
      `contract_version ${record.contractVersion} is not implemented by this reader ` +
      `(expects ${WORKSPACE_REGISTRY_CONTRACT_VERSION})`,
    )
  }

  if (!record.routing.hostnames.includes(record.routing.primaryHostname)) {
    problems.push('primary hostname is not among the workspace hostnames')
  }

  if (new Set(record.routing.hostnames).size !== record.routing.hostnames.length) {
    problems.push('duplicate hostnames')
  }

  // Every ref that CAN name a workspace must name this one.
  //
  // A `derived+hkdf://` or `sealed+aead://` ref carries its workspace in the path,
  // and an `env://` ref carries it in the variable name — so all three are
  // checkable here, and the resolver refuses each of them at read time. The
  // invariant this restores is that the WRITER refuses what the READER would
  // reject: without it the database accepted `env://QUACKBACK_TENANT_SECRET_FOO`,
  // the control plane returned `ok`, and only the fleet refused — fail-closed,
  // but the failure arrived at a customer's request instead of at the write.
  for (const [label, ref, purpose] of [
    ['app secrets', record.secrets.appSecretsRef, 'app-secrets'],
    ['storage credential', record.storage.credentialRef, 'storage'],
    ['database credential', record.database.credentialRef, 'db'],
  ] as const) {
    // Absent is not unnamed. A fleet-bucket workspace carries no storage ref at
    // all, and asking "does this ref name its workspace?" of a ref that does not
    // exist would report every pooled workspace as misconfigured.
    if (ref === undefined) continue
    const named = workspaceNamedBySecretRef(ref, record.workspaceKey, purpose)
    if (named !== null) problems.push(`${label} ref ${named}`)
  }

  // baseUrl pinned to the primary hostname. Catches the `https://*.quackback.io`
  // trap and any drift between the routing key and the origin used for cookies.
  let baseHost: string | null = null
  try {
    const u = new URL(record.routing.baseUrl)
    baseHost = u.hostname
    if (u.pathname !== '/' && u.pathname !== '') problems.push('base URL must have no path')
    if (u.search || u.hash) problems.push('base URL must have no query or fragment')
  } catch {
    problems.push('base URL does not parse')
  }
  if (baseHost !== null && baseHost !== record.routing.primaryHostname) {
    problems.push(`base URL host ${baseHost} does not match primary hostname ${record.routing.primaryHostname}`)
  }

  if (record.database.pooledUrl === record.database.directUrl) {
    problems.push('pooled and direct endpoints are identical — session-mode consumers would run through the pooler')
  }
  if (record.database.directUrl.includes('-pooler.')) {
    problems.push('direct endpoint points at a pooler host — LISTEN would be silently dropped')
  }

  for (const [label, dsn] of [['pooled', record.database.pooledUrl], ['direct', record.database.directUrl]] as const) {
    const parsed = parseDsnParts(dsn)
    if (!parsed) {
      problems.push(`${label} DSN does not parse`)
      continue
    }
    if (parsed.role !== record.database.role) {
      problems.push(`${label} DSN role ${parsed.role} does not match dbRole ${record.database.role}`)
    }
    if (parsed.database !== record.database.name) {
      problems.push(`${label} DSN database ${parsed.database} does not match dbName ${record.database.name}`)
    }
  }

  if (record.fingerprint.expectedWorkspaceKey !== record.workspaceKey) {
    problems.push('fingerprint expectation does not name this workspace')
  }

  return problems
}

/** `scheme://role@host[:port]/db[?params]`, password-less. */
export function parseDsnParts(
  dsn: string,
): { role: string; host: string; database: string } | null {
  if (!DSN_RE.test(dsn)) return null
  const afterScheme = dsn.slice(dsn.indexOf('://') + 3)
  const at = afterScheme.indexOf('@')
  const role = afterScheme.slice(0, at)
  const rest = afterScheme.slice(at + 1)
  const slash = rest.indexOf('/')
  const host = rest.slice(0, slash)
  const database = rest.slice(slash + 1).split('?')[0] ?? ''
  if (!role || !host || !database) return null
  return { role, host, database }
}

/**
 * Validate an untrusted record. Returns the parsed record or the reasons it was
 * refused — never a partially-valid record.
 */
export function validateWorkspaceRecord(
  input: unknown,
): { ok: true; record: WorkspaceRecord } | { ok: false; problems: string[] } {
  const parsed = workspaceRecordSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      problems: parsed.error.issues.map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`),
    }
  }
  const record = parsed.data as WorkspaceRecord
  const problems = checkWorkspaceRecordInvariants(record)
  if (problems.length > 0) return { ok: false, problems }
  return { ok: true, record }
}

// ─────────────────────────────────────────────────────────────────────────────
// The fingerprint assertion (SAAS-HOSTING-STACK.md §3)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Key in the workspace database's `settings.metadata` JSON bag that holds the stamp.
 *
 * The VALUE is deliberately still `cloudTenant` while the identifier around it
 * says workspace. This string is not vocabulary, it is stored data: every
 * workspace database already carries its stamp under this exact key, and a
 * rename here does not migrate them — it makes the stamp unfindable, which
 * `evaluateFingerprint` reports as `stamp_missing` and the fleet turns into a
 * refusal. Renaming it means a data migration over every workspace database
 * first, and accepting both keys in between.
 */
export const WORKSPACE_FINGERPRINT_METADATA_KEY = 'cloudTenant'

/** The stamp the CP writes into the workspace database. */
export type WorkspaceFingerprintStamp = {
  /** Stamp format version, independent of the record contract version. */
  v: 1
  workspaceKey: string
  stampedAt: string
}

/**
 * Accepts both spellings, and that is not politeness.
 *
 * Every stamp already written carries `tenantId`; this rename cannot reach into
 * a workspace database and rewrite it. A schema that demanded `workspaceKey`
 * would fail to parse every existing stamp, and an unparseable stamp is
 * indistinguishable from a missing one — so the §3 gate would refuse the entire
 * fleet on a vocabulary change. Reading both is the expand half; the contract
 * half is a pass that rewrites the stamps and then drops the alias.
 */
export const workspaceFingerprintStampSchema = z
  .object({
    v: z.literal(1),
    workspaceKey: z.string().min(1).optional(),
    tenantId: z.string().min(1).optional(),
    stampedAt: z.string().min(1),
  })
  .refine((o) => (o.workspaceKey ?? o.tenantId) !== undefined, {
    message: 'stamp carries neither workspaceKey nor tenantId',
  })
  .transform((o) => ({
    v: o.v,
    workspaceKey: (o.workspaceKey ?? o.tenantId) as string,
    stampedAt: o.stampedAt,
  }))

/** What the app actually observes when it reads the workspace database. */
export type ObservedFingerprint = {
  /** `settings.id`. Null when there is no settings row at all. */
  selfReportedWorkspaceId: string | null
  /** Parsed `settings.metadata.cloudTenant`, or null when absent/unparseable. */
  stamp: WorkspaceFingerprintStamp | null
  /** Number of rows in `settings`. Anything but 1 means this is not a workspace boundary. */
  settingsRowCount: number
}

export type FingerprintVerdict =
  | { ok: true }
  | { ok: false; code: FingerprintFailure; detail: string }

export type FingerprintFailure =
  | 'settings_row_missing'
  | 'settings_not_singleton'
  | 'stamp_missing'
  | 'stamp_workspace_key_mismatch'
  | 'self_reported_workspace_id_mismatch'

/**
 * The predicate the app runs on pool checkout, cached per pool rather than per
 * request. This is the assertion that converts the worst failure mode in the
 * system — silently serving another workspace's data — into a loud refusal.
 *
 * It lives in the contract module so the CP and the app test the same function
 * rather than two prose readings of it. Every failure is fatal: there is no
 * "close enough", and in particular a missing stamp is a refusal, not a
 * fallback to the workspace-id check alone. A database the control plane has
 * not claimed is not a database this fleet may serve.
 */
export function evaluateFingerprint(
  expected: WorkspaceFingerprintExpectation,
  observed: ObservedFingerprint,
): FingerprintVerdict {
  if (observed.settingsRowCount === 0) {
    return {
      ok: false,
      code: 'settings_row_missing',
      detail: 'workspace database has no settings row — not migrated, or not a Quackback database',
    }
  }
  if (observed.settingsRowCount !== 1) {
    return {
      ok: false,
      code: 'settings_not_singleton',
      detail:
        `workspace database has ${observed.settingsRowCount} settings rows; the database is the ` +
        'workspace boundary and must hold exactly one',
    }
  }
  if (observed.selfReportedWorkspaceId !== expected.expectedSelfReportedWorkspaceId) {
    return {
      ok: false,
      code: 'self_reported_workspace_id_mismatch',
      detail: `settings.id is ${observed.selfReportedWorkspaceId ?? 'null'}, expected ${expected.expectedSelfReportedWorkspaceId}`,
    }
  }
  if (observed.stamp === null) {
    return {
      ok: false,
      code: 'stamp_missing',
      detail: `settings.metadata.${WORKSPACE_FINGERPRINT_METADATA_KEY} is absent — database not claimed by the control plane`,
    }
  }
  if (observed.stamp.workspaceKey !== expected.expectedWorkspaceKey) {
    return {
      ok: false,
      code: 'stamp_workspace_key_mismatch',
      detail: `database is stamped for workspace ${observed.stamp.workspaceKey}, expected ${expected.expectedWorkspaceKey}`,
    }
  }
  return { ok: true }
}
