/**
 * Adversarial two-tenant isolation probe suite — shared contracts.
 *
 * The risk this suite exists to detect (SAAS-HOSTING-STACK.md §3): under pooled
 * multi-tenancy, a request routed to the wrong tenant's database still passes
 * every RBAC and permission check, because that database's own `settings`,
 * `principal` and `roles` rows are self-consistent. Nothing throws. The answer
 * looks correct.
 *
 * Conventional assertions are therefore useless. Two properties make this suite
 * different:
 *
 *  1. Every probe carries a POSITIVE CONTROL. Presenting alpha's credential to
 *     alpha must succeed before "alpha's credential was refused by bravo" means
 *     anything. Without it, a suite scores a dead server as perfectly isolated.
 *  2. Every response the harness receives is scanned against the other tenant's
 *     marker vocabulary (canaries + tenant-unique ids). A probe cannot pass by
 *     failing to look at the one field that leaked.
 */

/** Which of the two synthetic tenants a thing belongs to. */
export type TenantSlot = 'alpha' | 'bravo'

/**
 * A probe verdict. Only `PASS` is success.
 *
 * - `PASS`    — the cross-tenant attempt failed closed AND the positive control
 *               proved the attempt was capable of succeeding.
 * - `LEAK`    — cross-tenant data, capability or identity was observed. Any
 *               single LEAK fails the whole run.
 * - `ERROR`   — the probe could not execute: target unreachable, fixture
 *               missing, positive control failed, unexpected exception. Never a
 *               pass, never a silent skip.
 * - `BLOCKED` — a declared capability the probe needs was not supplied (e.g. no
 *               direct database URLs). Reported loudly; fails the run unless the
 *               operator opts in with `--allow-blocked`.
 */
export type Verdict = 'PASS' | 'LEAK' | 'ERROR' | 'BLOCKED'

/** Inputs a probe needs before it can execute at all. */
export type Capability =
  /** Both hostnames answer and are provably distinct deployments. */
  | 'http'
  /** An authenticated workspace-admin session on both tenants. */
  | 'admin'
  /** Direct Postgres access to both tenant databases. */
  | 'db'
  /** Per-tenant S3/R2 secret access keys, for minting storage read tokens. */
  | 'storage-secret'
  /** Per-tenant REST API keys. */
  | 'api-key'
  /** Per-tenant widget identify signing secrets. */
  | 'widget-secret'

/**
 * A single checked assertion inside a probe.
 *
 * The four kinds exist so that one shared rule — `decide()` in `probes/helpers.ts`
 * — can map controls to a verdict for every probe. Classifying a control is
 * therefore the whole of a probe's verdict logic; there is no per-probe filter
 * that can quietly drop a signal from the decision.
 *
 * - `positive`   the mechanism works within its own tenant. Failure → ERROR,
 *                because a refusal from the other tenant proves nothing until
 *                the attempt is known to be capable of succeeding.
 * - `negative`   the adversarial cross-tenant attempt. Failure → LEAK.
 * - `invariant`  a configuration fact whose violation IS a cross-tenant
 *                capability (a shared storage secret, one principal id serving
 *                both tenants). Failure → LEAK. These are causes, not context.
 * - `visibility` the probe's ability to observe at all (a scan that truncated,
 *                a surface that cannot discriminate). Failure → ERROR, never a
 *                pass: "I could not see" and "there was nothing to see" must
 *                never produce the same verdict.
 */
export interface ControlOutcome {
  kind: 'positive' | 'negative' | 'invariant' | 'visibility'
  label: string
  ok: boolean
  detail: string
}

/** What a probe returns. The runner turns exceptions into `ERROR` itself. */
export interface ProbeOutcome {
  verdict: Verdict
  /** Plain prose: what the probe actually did. */
  attempted: string
  /** Plain prose: what came back. */
  observed: string
  /** Why the verdict is what it is. */
  reason: string
  controls: ControlOutcome[]
  evidence?: Record<string, unknown>
}

/** A completed probe, as it appears in the machine-readable report. */
export interface ProbeResult extends ProbeOutcome {
  id: string
  name: string
  family: string
  proves: string
  requires: Capability[]
  /**
   * Set when today's separate-process, separate-database topology cannot
   * exercise the real failure mode. The probe still runs and still fails closed
   * on a genuine leak, but a PASS today is weaker evidence than a PASS under
   * pooling. Surfaced verbatim in the report so nobody mistakes one for the
   * other.
   */
  poolingCaveat?: string
  durationMs: number
  tripwireHits: TripwireHit[]
}

/** A probe definition. */
export interface Probe {
  id: string
  name: string
  family: string
  /** What a PASS actually proves. Printed in the report and the README. */
  proves: string
  requires: Capability[]
  poolingCaveat?: string
  run(ctx: ProbeContext): Promise<ProbeOutcome>
}

/**
 * Strings that uniquely identify one tenant's data. Seeing any of them in a
 * response from the other tenant is, by construction, a cross-tenant
 * observation — the fixture data collides on every human-readable field
 * (same admin email, same board titles, same post titles) precisely so that a
 * wrong-tenant answer looks right to everything except these markers.
 */
export interface TenantMarkers {
  slot: TenantSlot
  /** Constant across runs: embedded in fixture body text. */
  canary: string
  /** Runtime-discovered ids unique to this tenant (workspace, user, principal, board, post). */
  ids: Record<string, string>
  /**
   * Markers that are themselves credentials — the widget signing secret, for
   * instance. Scanned by the tripwire exactly like `ids`, because a secret
   * appearing in a response is a serious leak, but NEVER serialized into the
   * report and always redacted in evidence. A report file is an artifact people
   * paste into tickets and chat.
   */
  sensitive?: Record<string, string>
}

/** The report-safe view of a marker set: sensitive values removed entirely. */
export function publicMarkers(markers: TenantMarkers): TenantMarkers {
  return { slot: markers.slot, canary: markers.canary, ids: { ...markers.ids } }
}

/** A recorded request/response pair. */
export interface Exchange {
  tenant: TenantSlot
  method: string
  url: string
  status: number
  requestBody: string
  responseText: string
  responseHeaders: Record<string, string>
  durationMs: number
  /** Suppress tripwire scanning — set when the probe deliberately sends a foreign marker. */
  expectsForeignMarkers: boolean
}

/** A response from one tenant that contained another tenant's unique marker. */
export interface TripwireHit {
  /** The host that served the leaking response. */
  servedBy: TenantSlot
  /** The tenant the marker belongs to. */
  markerOwner: TenantSlot
  markerName: string
  /** The matched value, or `<redacted>` when the marker is itself a credential. */
  marker: string
  method: string
  url: string
  status: number
  /** A short window of the response around the marker, with any secret masked. */
  excerpt: string
  /** True when the marker was a credential and its value has been withheld. */
  redacted: boolean
}

/** Everything a probe is handed. */
export interface ProbeContext {
  config: ProbeConfig
  alpha: TenantHandle
  bravo: TenantHandle
  /** Records exchanges and raises tripwire hits. Shared across all probes. */
  tripwire: TripwireRecorder
  /** Capabilities that were actually satisfied at preflight. */
  capabilities: Set<Capability>
  log: ProbeLogger
  /**
   * A fresh client for a tenant, with an empty cookie jar.
   *
   * Redemption probes must start from no session at all: reusing the admin
   * client would leave a valid cookie in the jar, and "the request succeeded"
   * would then say nothing about the credential under test.
   */
  newClient(handle: TenantHandle): TenantHttp
}

/** Minimal structured logger surface (pino in production, a stub in tests). */
export interface ProbeLogger {
  debug(obj: Record<string, unknown>, msg: string): void
  info(obj: Record<string, unknown>, msg: string): void
  warn(obj: Record<string, unknown>, msg: string): void
  error(obj: Record<string, unknown>, msg: string): void
}

/** Per-tenant runtime handle, assembled during preflight. */
export interface TenantHandle {
  slot: TenantSlot
  baseUrl: string
  markers: TenantMarkers
  http: TenantHttp
  /** Populated once an admin session exists. */
  adminCookies?: string
  /** Direct database handle, when `db` capability is satisfied. */
  db?: TenantDb
  fixture?: TenantFixture
}

/** The subset of an HTTP client the probes use. */
export interface TenantHttp {
  slot: TenantSlot
  baseUrl: string
  request(path: string, init?: ProbeRequestInit): Promise<ProbeResponse>
  /** Serialized cookie header for this client's jar, for cross-tenant replay. */
  cookieHeader(): string
  /** Replace the jar wholesale (used to plant a foreign tenant's cookies). */
  setCookieHeader(header: string): void
  clearCookies(): void
}

export interface ProbeRequestInit {
  method?: string
  headers?: Record<string, string>
  body?: string | FormData
  /** Default true. Set false to inspect a 3xx rather than follow it. */
  followRedirects?: boolean
  /** Do not send the jar's cookies on this request. */
  omitCookies?: boolean
  /**
   * Set when the request itself carries a foreign tenant's marker (for example
   * searching bravo for alpha's canary). Suppresses the echo false-positive.
   */
  expectsForeignMarkers?: boolean
  timeoutMs?: number
}

export interface ProbeResponse {
  status: number
  ok: boolean
  headers: Record<string, string>
  text: string
  json<T = unknown>(): T | null
  url: string
}

/** Direct database access for probes that must observe row-level state. */
export interface TenantDb {
  slot: TenantSlot
  /** Tagged-template query returning plain rows. */
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>
  close(): Promise<void>
}

/** The idempotent, deliberately colliding fixture provisioned in each tenant. */
export interface TenantFixture {
  workspaceName: string
  adminEmail: string
  adminUserId: string
  adminPrincipalId: string
  boardId: string
  boardSlug: string
  boardTitle: string
  postId: string
  postTitle: string
  /** Body text containing this tenant's canary. */
  postBody: string
}

/** Fully-resolved suite configuration. */
export interface ProbeConfig {
  alphaUrl: string
  bravoUrl: string
  adminEmail: string
  adminPassword: string
  alphaDatabaseUrl?: string
  bravoDatabaseUrl?: string
  alphaStorageSecret?: string
  bravoStorageSecret?: string
  alphaApiKey?: string
  bravoApiKey?: string
  alphaWidgetSecret?: string
  bravoWidgetSecret?: string
  /** Exit 0 even when probes are BLOCKED. Never makes a LEAK or ERROR pass. */
  allowBlocked: boolean
  /** Write the JSON report here instead of stdout. */
  jsonOut?: string
  /** Run only these probe ids. */
  only?: string[]
  requestTimeoutMs: number
  /** Remove the probe fixtures and exit. */
  teardown: boolean
}

/** Aggregate run report. */
export interface ProbeReport {
  suite: 'quackback-tenant-isolation'
  schemaVersion: 1
  startedAt: string
  finishedAt: string
  durationMs: number
  targets: { alpha: string; bravo: string }
  capabilities: Capability[]
  missingCapabilities: Capability[]
  markers: { alpha: TenantMarkers; bravo: TenantMarkers }
  verdict: 'PASS' | 'FAIL'
  /**
   * True when `--only` excluded probes. A filtered run is not an isolation
   * verdict, and the machine-readable report has to say so on its own — a
   * consumer reading `verdict: "PASS"` must not have to also parse the human
   * summary to learn that six probes never ran.
   */
  partial: boolean
  /** Probe ids excluded by `--only`. Empty on a full run. */
  filteredOut: string[]
  counts: Record<Verdict, number>
  /** Every tripwire hit seen anywhere in the run, including outside probes. */
  tripwireHits: TripwireHit[]
  probes: ProbeResult[]
}

/** Collects exchanges and derives tripwire hits from the marker vocabulary. */
export interface TripwireRecorder {
  /**
   * Install the marker vocabulary. Preflight has to make requests before it
   * knows what the markers are, so the recorder starts empty and is updated
   * once the fixture has been discovered.
   */
  setMarkers(alpha: TenantMarkers, bravo: TenantMarkers): void
  record(exchange: Exchange): TripwireHit[]
  hits(): TripwireHit[]
  /** Hits recorded since the given index — used to attribute hits to a probe. */
  hitsSince(index: number): TripwireHit[]
  hitCount(): number
}
