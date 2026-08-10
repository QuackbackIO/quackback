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
 *     marker vocabulary (canaries + tenant-unique ids) — including the responses
 *     to the deliberate cross-tenant attempts, which were once exempt and are
 *     where a leak is most likely to be. A probe cannot pass by failing to look
 *     at the one field that leaked.
 *  3. A probe must judge a surface that actually carries the evidence. `GET /`
 *     answers a zero-byte 307 to its canonical URL, so document reads follow
 *     redirects — same-origin only, because a response from another host cannot
 *     be evidence about this one.
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
 * therefore the whole of a probe's verdict logic.
 *
 * That only holds if EVERY exit goes through `decide()`, including the early
 * ones. It did not: seven probes returned through a bare `error()` that
 * hard-coded ERROR while carrying the recorded controls along for display, so a
 * failed `invariant` — a LEAK by the table above — could be printed and not
 * counted. Probes now stop early with `halt()`, which records the stopping
 * condition as a failed `visibility` control and defers to `decide()`.
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
  /**
   * Which way across the tenant boundary this control looked.
   *
   * Required on every `negative` control, and asserted per probe by
   * `__tests__/end-to-end.test.ts`. The reason it is declared rather than
   * inferred: P02 attempted only alpha's-OTP-on-bravo, and because an
   * email-keyed stash is last-writer-wins, the surviving credential was
   * bravo's — so the only cross-redemption that could have succeeded was the
   * one never attempted, and a planted leak produced a fully green run.
   * Detection must not depend on which tenant's value happens to survive.
   *
   * `both` is for a control that evaluates both directions in one check.
   */
  direction?: 'a-to-b' | 'b-to-a' | 'both'
  /**
   * Which cross-tenant attempt this control is one direction of.
   *
   * Required on every `negative` control whose direction is `a-to-b` or
   * `b-to-a`, and asserted per attempt by `__tests__/end-to-end.test.ts`: the
   * controls sharing an attemptId must cover BOTH directions between them. The
   * probe-aggregate check that came before this could not stop a fresh
   * one-directional control landing in an already-symmetric probe — the union
   * of directions still covered both, and the asymmetric attempt sailed through.
   *
   * `both`-direction controls need no attemptId: they evaluate the pair in one
   * check by construction.
   */
  attemptId?: string
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
   * What this probe's PASS does not distinguish.
   *
   * It began as "the pooled topology does not exist yet, so this failure mode is
   * unreachable" — and outlived the topology it described. Compute is pooled
   * now: one process, one signing key, one shared worker tier, with the database
   * the only per-tenant thing left. Caveats written for the old world understated
   * the suite, telling a reader that P01's pass was over-determined by separate
   * processes that no longer exist.
   *
   * So a caveat states the residual instead, which is durable: what a pass here
   * leaves open. For the credential probes that is "a wrong-pool lookup misses
   * and refuses exactly as a correct one does", which stays true for as long as
   * databases are per-tenant. Surfaced verbatim in the report.
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
  /**
   * Headers the harness sent. Part of the echo-suppression haystack: a replayed
   * cookie or Bearer credential travels here and nowhere else, so a marker
   * reflected back out of one is the harness seeing its own handiwork.
   */
  requestHeaders: Record<string, string>
  responseText: string
  responseHeaders: Record<string, string>
  durationMs: number
  /**
   * The probe deliberately sent a foreign tenant's marker on this exchange.
   *
   * This does NOT suppress tripwire scanning. It once did, and because every
   * deliberate cross-tenant attempt sets it, the tripwire's coverage was reduced
   * to incidental traffic — the exact replays it exists to backstop were the
   * ones it ignored. Echo suppression is done properly instead, by never
   * counting a marker the harness itself put on the wire (url, body, headers,
   * or a base64url payload inside any of them). The flag now only labels the
   * resulting hits as `deliberate`.
   */
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
  /**
   * True when the probe deliberately made this cross-tenant attempt, false when
   * the hit landed on incidental traffic. Both count identically toward the
   * verdict; this only tells a reader which kind of exchange found it.
   */
  deliberate: boolean
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
  /**
   * Follow same-origin redirects to the surface that actually carries content.
   *
   * Default FALSE, because for the credential probes the 3xx *is* the signal
   * (a storage read token answers 302, a magic-link verify answers 302) and
   * following it would both discard the evidence and forward a credential.
   *
   * Set TRUE on document reads. `GET /` on a tenant answers `307 → /?sort=trending`
   * with a zero-byte body, and `GET /admin` answers `307 → /?auth=signin…`, so a
   * probe that judged the unfollowed response judged nothing at all: the planted
   * identity token, the workspace name and every fixture id live on the page the
   * redirect points at. Cross-origin redirects are never followed — see
   * `ProbeResponse.crossOriginRedirect`.
   */
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
  /** The URL this body actually came from — the last hop when redirects were followed. */
  url: string
  /**
   * Foreign-tenant markers the tripwire found in this exchange, across every hop.
   *
   * Surfaced because it was previously discarded: `record()` already returned
   * the hits and `http.ts` threw them away, so a probe could only ever see what
   * its own author thought to check for. A probe may raise its own control from
   * these; the runner counts them regardless.
   */
  tripwireHits: TripwireHit[]
  /** Same-origin redirect targets that were followed, in order. Empty when none were. */
  redirectChain: string[]
  /**
   * Set to the target URL when a redirect pointed off this tenant's own origin
   * and was therefore NOT followed.
   *
   * Following one would be worse than not following it at all: a probe that
   * chased alpha's redirect onto bravo's host and then reported "no foreign
   * markers in alpha's document" would be reading bravo's page and calling it
   * alpha's. When the target is the other tenant under test, the host handed
   * the client across the boundary and that is itself the finding.
   */
  crossOriginRedirect?: string
  /** Set when the redirect chain hit the hop limit without reaching a final response. */
  redirectLimitExceeded?: boolean
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
  /**
   * Control-plane tenant ids. Needed only under pooled tenancy, where the
   * storage read capability is bound to the tenant as well as to the object key
   * — a single-tenant deployment signs the historical message and needs neither.
   */
  alphaTenantId?: string
  bravoTenantId?: string
  alphaStorageSecret?: string
  bravoStorageSecret?: string
  alphaApiKey?: string
  bravoApiKey?: string
  alphaWidgetSecret?: string
  bravoWidgetSecret?: string
  /**
   * The per-tenant identity token planted into a settings-derived field that a
   * public surface renders (the workspace name, or the portal welcome-card
   * headline). P06 judges tenant identity on these tokens and nothing else it
   * has to infer; when unset, the suite-owned defaults in `fixtures.ts`
   * (`IDENTITY_TOKEN`) are assumed — pass these flags when the operator planted
   * a custom token instead.
   */
  alphaIdentityToken?: string
  bravoIdentityToken?: string
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
  /**
   * Verdicts the operator asked the EXIT CODE to tolerate (via `--allow-blocked`).
   * `verdict` itself never softens: it always describes what actually happened,
   * so a CI check keyed on it cannot read green while probes did not run.
   */
  exitTolerates: Verdict[]
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
