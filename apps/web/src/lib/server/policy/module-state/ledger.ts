/**
 * The module-scope mutable state ledger (SAAS-HOSTING-STACK.md §4.4).
 *
 * Every site `scan.ts` reports must appear here with a category and a reason.
 * A site the scanner finds and this file does not name **fails CI**, and so
 * does an entry naming a site that no longer exists. That is the whole control:
 * adding a singleton to server code becomes a deliberate edit to a reviewed
 * file, and removing one is not allowed to leave a stale justification behind.
 *
 * ## Categories, and which ones the scanner checks rather than believes
 *
 * The cheap way to defeat a ledger is to write the reassuring word next to the
 * dangerous code. Three of the six categories are therefore verified against
 * the source, so the label cannot be wrong on its own:
 *
 * | category | meaning | verified? |
 * | --- | --- | --- |
 * | `tenant-keyed` | partitioned by the active tenant | **yes** — the initializer must be `new TenantKeyedCache` (`factory` sites excepted; see below) |
 * | `tenant-scoped-key` | keyed by something that already identifies one tenant | **yes** — `keyedBy` must name a token that appears in the declaring file |
 * | `refuses-pooled` | only correct single-tenant, and the code refuses to run pooled | **yes** — the declaring file must reference `isPooledTenancy` |
 * | `content-addressed` | the value is a function of the key, so a cross-tenant hit is byte-identical to a recompute | no |
 * | `fleet-wide` | holds only values that are the same for every tenant | no |
 * | `process-lifetime` | a genuine per-process singleton: a latch, a timer, a connection handle | no |
 *
 * `factory` sites are exempt from the `TenantKeyedCache` check because the
 * cache is inside the factory, not at the declaration — `makeStash()` and
 * `createStreamLimiter()` are the two, and both are read by dedicated tests.
 *
 * The three unverified categories are claims a human made, which is why each
 * carries a reason stating the failure that WOULD occur if it were shared. A
 * reason that only says "safe" tells a later reader nothing they can check.
 *
 * ## Adding an entry
 *
 * If the honest category is `process-lifetime`, `fleet-wide` or
 * `content-addressed`, say what a cross-tenant hit would return and why that is
 * the same thing the requesting tenant would have computed. If you cannot write
 * that sentence, the answer is a `TenantKeyedCache`.
 */

export type StateCategory =
  | 'tenant-keyed'
  | 'tenant-scoped-key'
  | 'refuses-pooled'
  | 'content-addressed'
  | 'fleet-wide'
  | 'process-lifetime'

export interface LedgerEntry {
  /** Repo-root-relative, posix. */
  file: string
  /** Declared name, or `globalThis.x` for a global assignment. */
  name: string
  category: StateCategory
  /**
   * For `tenant-scoped-key`: a token that must appear in the declaring file,
   * naming the code that composes the key. Points at the mechanism rather than
   * asserting it exists.
   */
  keyedBy?: string
  /** Another workstream owns the remaining work. Stated, not implied. */
  owner?: string
  /** What would go wrong if this were shared, or why it cannot be. */
  reason: string
}

export const MODULE_STATE_LEDGER: readonly LedgerEntry[] = [
  {
    file: 'apps/web/src/lib/server/auth/index.ts',
    name: 'authConfigVersions',
    category: 'tenant-keyed',
    reason:
      'auth_config_version is a small per-workspace counter, so two workspaces sitting on the same ' +
      'number is routine; compared across tenants the guard reads "unchanged" and hands back an ' +
      'instance built for someone else.',
  },
  {
    file: 'apps/web/src/lib/server/auth/index.ts',
    name: 'authInstances',
    category: 'tenant-keyed',
    reason:
      "A built better-auth instance closes over one workspace's database adapter and its registered " +
      'OAuth/OIDC providers, which are read from that workspace rows. Shared, every tenant ' +
      'authenticates against whichever one built it. Note what this does NOT cover: auth/index.ts ' +
      'reads `config.baseUrl` and `process.env.TRUSTED_ORIGINS`, both process-wide, so partitioning ' +
      'the instance does not make those per-tenant. See the config.ts entry.',
  },
  {
    file: 'apps/web/src/lib/server/auth/index.ts',
    name: 'magicLinkStash',
    category: 'tenant-keyed',
    reason:
      'makeStash() wraps a TenantKeyedCache. Entries are live sign-in credentials keyed by lowercased ' +
      'email, and an address is not unique across workspaces.',
  },
  {
    file: 'apps/web/src/lib/server/auth/index.ts',
    name: 'otpStash',
    category: 'tenant-keyed',
    reason:
      'Same shape and same reasoning as magicLinkStash; the OTP half is the one whose asymmetric ' +
      'coverage hid a planted leak from the probe suite.',
  },
  {
    file: 'apps/web/src/lib/server/auth/index.ts',
    name: 'rateLimitCounters',
    category: 'tenant-keyed',
    reason:
      "Backs better-auth's built-in limiter, whose own store is a module-scope Map keyed by ip+path " +
      'shared across every betterAuth() instance in a process.',
  },
  {
    file: 'apps/web/src/lib/server/auth/resolved-claims-stash.ts',
    name: 'entries',
    category: 'tenant-keyed',
    reason:
      'Keyed by providerId + IdP subject, and neither half is unique across workspaces. Not on the ' +
      '§4.1 list; found by this scanner.',
  },
  {
    file: 'apps/web/src/lib/server/domains/analytics/visitor-hash.ts',
    name: 'cachedSalts',
    category: 'tenant-keyed',
    reason:
      'The daily PII-hashing salt. Shared, the same visitor hashes to the same key in every ' +
      'workspace, which is the cross-site correlation the daily rotation exists to make impossible, ' +
      'reintroduced across tenants instead of across days.',
  },
  {
    file: 'apps/web/src/lib/server/domains/assistant/assistant.orchestrator.ts',
    name: 'memoizedAssistantPrincipalId',
    category: 'tenant-keyed',
    reason:
      "Written as the author foreign key on every message the assistant sends, so one workspace's id " +
      "memoized process-wide is another workspace's rows pointing at a principal that does not exist " +
      'in its database.',
  },
  {
    file: 'apps/web/src/lib/server/domains/settings/tier-limits.service.ts',
    name: 'cachedLimits',
    category: 'tenant-keyed',
    reason:
      "The billing ceiling. Shared, whichever workspace is read first sets everyone's limits, and " +
      'nothing errors: the wrong number is simply believed.',
  },
  {
    file: 'apps/web/src/lib/server/domains/workflows/workflow.service.ts',
    name: 'hasLiveWorkflowCache',
    category: 'tenant-keyed',
    reason:
      'A shared false makes a workspace with live workflows stop running them: the gate is read ' +
      'before the enqueue, so nothing dispatches, nothing errors, and no run row is written to notice ' +
      'was missing.',
  },
  {
    file: 'apps/web/src/lib/server/domains/workflows/workflow.service.ts',
    name: 'liveAttributeKeysCache',
    category: 'tenant-keyed',
    reason:
      "Attribute keys read out of one workspace's stored workflow graphs. Shared, one workspace's " +
      'vocabulary decides which conversation attributes another re-classifies, spending its AI budget ' +
      'on keys its own workflows never branch on.',
  },
  {
    file: 'apps/web/src/lib/server/encryption.ts',
    name: 'derivedKeys',
    category: 'tenant-keyed',
    owner: 'Piece 18 (saas/tenant-secrets)',
    reason:
      'HKDF keys were keyed by purpose alone. Partitioned by Piece 5; the SECRET_KEY they derive FROM ' +
      'is still one fleet value until per-tenant app-secret resolution lands.',
  },
  {
    file: 'apps/web/src/lib/server/events/relay.ts',
    name: 'strictAttempts',
    category: 'tenant-keyed',
    reason:
      'events.id is a per-database bigserial, so two workspaces both have an event 5. Shared, one ' +
      "workspace's ten failed resolutions spend another's retry budget and drop that event's " +
      'targets on its first attempt.',
  },
  {
    file: 'apps/web/src/lib/server/messages/assistant-principal.ts',
    name: 'cachedAssistantPrincipalId',
    category: 'tenant-keyed',
    reason:
      "A principal id is a row in one workspace's database, so a shared memo flags a foreign id as " +
      '"this is the assistant" everywhere else, mislabelling human agents\' turns.',
  },
  {
    file: 'apps/web/src/lib/server/messages/assistant-principal.ts',
    name: 'checkedAt',
    category: 'tenant-keyed',
    reason:
      "The re-check clock for the memo above; shared, one workspace's check suppresses every other " +
      "workspace's.",
  },
  {
    file: 'apps/web/src/lib/server/realtime/stream-connection-limit.ts',
    name: 'streamLimiter',
    category: 'tenant-keyed',
    reason:
      'Concurrency gauge. The GLOBAL cap stays shared on purpose (file descriptors are a property of ' +
      'the process), but the per-tenant and per-(tenant, IP) buckets are what stop one workspace ' +
      "consuming the whole budget or one office IP's use of workspace A refusing its streams in " +
      'workspace B.',
  },
  {
    file: 'apps/web/src/lib/server/storage/s3.ts',
    name: 's3Clients',
    category: 'tenant-keyed',
    owner: 'Piece 18 (saas/tenant-secrets)',
    reason:
      "The S3/R2 client. Shared, every tenant's uploads, presigned URLs and private reads resolve " +
      "against the first tenant's bucket, and succeed cleanly because R2 has no notion of tenant. " +
      "Partitioned by Piece 5; the CREDENTIALS each client is built with are Piece 18's.",
  },
  {
    file: 'apps/web/src/lib/server/sweep-lock.ts',
    name: 'inFlightSweeps',
    category: 'tenant-keyed',
    reason:
      'The in-process reentrancy latch for the long AI sweeps. It was a bare boolean: under a fleet ' +
      'pass the first workspace to start suppresses the sweep for EVERY other workspace for as long ' +
      'as it runs, and the suppression is invisible.',
  },
  {
    file: 'apps/web/src/routes/api/auth/$.ts',
    name: 'registrationAttempts',
    category: 'tenant-keyed',
    reason:
      'The OAuth client registration budget is a per-workspace resource. Shared, one address exhausts ' +
      "every workspace's allowance at once and a legitimate registration is refused because of " +
      'traffic aimed elsewhere.',
  },
  {
    file: 'apps/web/src/lib/server/realtime/pubsub.ts',
    name: 'listeners',
    category: 'tenant-scoped-key',
    keyedBy: 'tenantKey',
    reason:
      'Keyed by the WIRE channel name, which tenantKey() namespaces. Keyed by the logical name it ' +
      "would hand one workspace's inbox stream another workspace's messages on a bus with no " +
      'authorization layer of its own.',
  },
  {
    file: 'apps/web/src/lib/server/tenancy/neon-credentials.ts',
    name: 'cache',
    category: 'tenant-scoped-key',
    keyedBy: 'cacheKey',
    reason:
      "Memoized role passwords keyed by project + branch + role, which identify one tenant's " +
      'database physically.',
  },
  {
    file: 'apps/web/src/lib/server/tenancy/pool-cache.ts',
    name: 'pools',
    category: 'tenant-scoped-key',
    keyedBy: 'tenant.tenantId',
    reason:
      'The per-tenant connection pools. Keyed by tenantId, and every checkout re-asserts the settings ' +
      'fingerprint before the pool is handed out (§3).',
  },
  {
    file: 'apps/web/src/lib/server/tenancy/resolver.ts',
    name: 'byHostname',
    category: 'tenant-scoped-key',
    keyedBy: 'hostname',
    reason:
      'The Host to tenant lookup cache, keyed by hostname. This IS the resolution step, so its key is ' +
      'the tenant discriminator rather than something needing one.',
  },
  {
    file: 'apps/web/src/lib/server/tenancy/resolver.ts',
    name: 'byTenantId',
    category: 'tenant-scoped-key',
    keyedBy: 'tenantId',
    reason:
      'The same records keyed by tenant id, for background scopes that already know which tenant they ' +
      'want.',
  },
  {
    file: 'apps/web/src/routes/api/storage/$.ts',
    name: 'proxyCache',
    category: 'tenant-scoped-key',
    keyedBy: 'proxyCacheKey',
    reason:
      "Holds file BYTES keyed by storage key. The bucket is the tenant boundary, so two tenants' " +
      "keys share this heap the moment one process serves both, and a hit returns the other tenant's " +
      'file with a 200.',
  },
  {
    file: 'apps/web/src/lib/server/db.ts',
    name: 'globalThis.__db',
    category: 'refuses-pooled',
    reason:
      'The single-tenant memoized handle. getDatabase() throws TenantScopeMissingError under pooled ' +
      'tenancy before this is read, so it can only ever hold the one database a single-tenant install ' +
      'has.',
  },
  {
    file: 'apps/web/src/lib/server/events/relay.ts',
    name: 'draining',
    category: 'refuses-pooled',
    reason:
      'Leader-election and timer state for a relay that drains exactly ONE database. ' +
      'startOutboxRelay() refuses under pooled tenancy rather than electing itself leader of ' +
      'whichever database the process happens to hold; the per-tenant relay tier is §7.3 work.',
  },
  {
    file: 'apps/web/src/lib/server/events/relay.ts',
    name: 'leadership',
    category: 'refuses-pooled',
    reason:
      'Leader-election and timer state for a relay that drains exactly ONE database. ' +
      'startOutboxRelay() refuses under pooled tenancy rather than electing itself leader of ' +
      'whichever database the process happens to hold; the per-tenant relay tier is §7.3 work.',
  },
  {
    file: 'apps/web/src/lib/server/events/relay.ts',
    name: 'pollTimer',
    category: 'refuses-pooled',
    reason:
      'Leader-election and timer state for a relay that drains exactly ONE database. ' +
      'startOutboxRelay() refuses under pooled tenancy rather than electing itself leader of ' +
      'whichever database the process happens to hold; the per-tenant relay tier is §7.3 work.',
  },
  {
    file: 'apps/web/src/lib/server/events/relay.ts',
    name: 'retryTimer',
    category: 'refuses-pooled',
    reason:
      'Leader-election and timer state for a relay that drains exactly ONE database. ' +
      'startOutboxRelay() refuses under pooled tenancy rather than electing itself leader of ' +
      'whichever database the process happens to hold; the per-tenant relay tier is §7.3 work.',
  },
  {
    file: 'apps/web/src/lib/server/events/relay.ts',
    name: 'running',
    category: 'refuses-pooled',
    reason:
      'Leader-election and timer state for a relay that drains exactly ONE database. ' +
      'startOutboxRelay() refuses under pooled tenancy rather than electing itself leader of ' +
      'whichever database the process happens to hold; the per-tenant relay tier is §7.3 work.',
  },
  {
    file: 'apps/web/src/routes/api/health.ready.ts',
    name: 'migrationsKnownUpToDate',
    category: 'refuses-pooled',
    reason:
      'A "migrations are fine" memo that would cache the first tenant it happened to see forever. ' +
      'checkMigrations() returns before reading it under pooled tenancy: fleet readiness stops ' +
      'asserting anything about tenant schemas (§10.5), so the probe cannot go blind during the ' +
      'rolling migration it exists to catch.',
  },
  {
    file: 'apps/web/src/lib/server/domains/analytics/track.service.ts',
    name: 'uaCache',
    category: 'content-addressed',
    reason:
      'Parsed User-Agent keyed by the User-Agent string. A cross-tenant hit returns exactly what the ' +
      'other tenant would have computed.',
  },
  {
    file: 'apps/web/src/lib/server/domains/help-center/help-center-embedding.service.ts',
    name: 'queryEmbeddingCache',
    category: 'content-addressed',
    reason:
      'Keyed by (embedding model, query text). Embeddings are a deterministic function of that pair ' +
      'and the model is env-only (§8), so a cross-tenant hit is byte-identical to a recompute.',
  },
  {
    file: 'apps/web/src/lib/server/policy/permissions.ts',
    name: 'SET_BY_ROLE',
    category: 'content-addressed',
    reason:
      'Role to permission-set memo derived from the static RBAC catalogue. No database read, ' +
      'identical for every tenant.',
  },
  {
    file: 'apps/web/src/lib/shared/assistant/markdown-lite.ts',
    name: 'inlineReCache',
    category: 'content-addressed',
    reason:
      'Compiled regexes keyed by their own source string. A cross-tenant hit returns the same ' +
      'compiled pattern the requesting tenant would have built from the same characters.',
  },
  {
    file: 'apps/web/src/lib/shared/i18n.ts',
    name: 'messageCache',
    category: 'content-addressed',
    reason: 'Message catalogues keyed by locale, imported from static files in the bundle.',
  },
  {
    file: 'apps/web/src/lib/shared/office-hours.ts',
    name: 'zonedFormatterCache',
    category: 'content-addressed',
    reason:
      'Intl.DateTimeFormat instances keyed by IANA timezone. The formatter is a pure function of ' +
      'that timezone and the fixed format options, so it carries nothing about who asked for it.',
  },
  {
    file: 'apps/web/src/routes/api/widget/sdk[.]js.ts',
    name: 'encodedCache',
    category: 'content-addressed',
    reason:
      'Pre-compressed gzip/brotli variants keyed by the response body string itself, which already ' +
      "bakes in the tenant's base URL and widget config.",
  },
  {
    file: 'apps/web/src/lib/server/config.ts',
    name: '_config',
    category: 'process-lifetime',
    reason:
      'The parsed process configuration. NOT fleet-wide, which an earlier version of this entry ' +
      'claimed: the pooled schema refuses exactly one per-tenant variable (DATABASE_URL), while ' +
      'BASE_URL stays REQUIRED and is per-tenant by this branch own registry contract, deriving ' +
      'cookie domain and secure flags, trusted origins, email links and every absolute asset URL. ' +
      'Of the ~56 config.baseUrl readers exactly one consults the tenant record, so on the pooled ' +
      'fleet both tenants render the same __QUACKBACK_URL__. Host-derived BASE_URL is ' +
      'SAAS-HOSTING-STACK.md section 9 work and is deliberately NOT done here; this entry exists so ' +
      'the gap is written down rather than implied to be closed.',
  },
  {
    file: 'apps/web/src/lib/server/domains/ai/config.ts',
    name: 'openai',
    category: 'fleet-wide',
    reason:
      'Constructed from OPENAI_API_KEY and OPENAI_BASE_URL alone. §8 established the AI key is ' +
      'fleet-wide (the control plane writes one key into every tenant); no workspace value reaches ' +
      'the constructor and no request attaches per-caller headers.',
  },
  {
    file: 'apps/web/src/lib/server/functions/version.ts',
    name: 'lastFailureAt',
    category: 'fleet-wide',
    reason:
      'Backoff timestamp for the same fleet-wide release check. One fleet runs one image, so the ' +
      'last failure is a fact about this process talking to the releases feed, not about a tenant.',
  },
  {
    file: 'apps/web/src/lib/server/functions/version.ts',
    name: 'versionCache',
    category: 'fleet-wide',
    reason:
      "The running build's own release version, checked against the public releases feed. One fleet " +
      'runs one image.',
  },
  {
    file: 'packages/email/src/index.ts',
    name: 'resendClient',
    category: 'fleet-wide',
    reason:
      'Built from the Resend API key, which §8 confirms the control plane writes fleet-wide into ' +
      'every tenant.',
  },
  {
    file: 'packages/email/src/index.ts',
    name: 'smtpTransporter',
    category: 'fleet-wide',
    reason:
      'Built from EMAIL_SMTP_HOST/PORT/USER/PASS. A transport, not an identity, so the client ' +
      'itself is fleet-wide. Say the rest plainly: the per-tenant part of email is the From ' +
      'address, and it is BROKEN under pooling - getEmailFrom() reads process.env.EMAIL_FROM per ' +
      'send, the registry carries a per-tenant email.from, and NOTHING repo-wide reads it, so every ' +
      'tenant mail goes out from one address. Not this singleton fault and not fixed here (it is ' +
      'section 8 config resolution, not section 4 process state) - recorded so the next reader is ' +
      'not reassured by a transport that was never the problem.',
  },
  {
    file: 'apps/web/src/lib/server/domains/analytics/analytics-queue.ts',
    name: 'initPromise',
    category: 'process-lifetime',
    reason:
      'A boot latch holding the in-flight BullMQ queue/worker construction so concurrent callers ' +
      'share one. Named explicitly by §4.4 as a genuine process-lifetime case. The LATCH is ' +
      'process-lifetime; what it gates was not, and an earlier version of this entry said it held ' +
      '"connection objects, never tenant rows", which was the same reassurance bootstrap._initialized ' +
      'was corrected for. A BullMQ Worker starts its run loop inside the constructor, so it keeps ' +
      'the async context alive at construction for every job it ever handles - and seven of these ' +
      "arm lazily on first enqueue, from inside a request. The arming tenant's scope would have " +
      "been welded onto the processor and every tenant's jobs would have run against that one " +
      'database. Closed on two layers: config refuses to boot pooled unless QUACKBACK_ROLE=web, and ' +
      'queue/create-worker.ts constructs every Worker detached so one built anyway inherits nothing ' +
      'and fails loudly on db rather than silently succeeding somewhere wrong.',
  },
  {
    file: 'apps/web/src/lib/server/domains/analytics/partition-maintenance-queue.ts',
    name: 'initPromise',
    category: 'process-lifetime',
    reason:
      'A boot latch holding the in-flight BullMQ queue/worker construction so concurrent callers ' +
      'share one. Named explicitly by §4.4 as a genuine process-lifetime case. The LATCH is ' +
      'process-lifetime; what it gates was not, and an earlier version of this entry said it held ' +
      '"connection objects, never tenant rows", which was the same reassurance bootstrap._initialized ' +
      'was corrected for. A BullMQ Worker starts its run loop inside the constructor, so it keeps ' +
      'the async context alive at construction for every job it ever handles - and seven of these ' +
      "arm lazily on first enqueue, from inside a request. The arming tenant's scope would have " +
      "been welded onto the processor and every tenant's jobs would have run against that one " +
      'database. Closed on two layers: config refuses to boot pooled unless QUACKBACK_ROLE=web, and ' +
      'queue/create-worker.ts constructs every Worker detached so one built anyway inherits nothing ' +
      'and fails loudly on db rather than silently succeeding somewhere wrong.',
  },
  {
    file: 'apps/web/src/lib/server/domains/api/openapi.ts',
    name: 'registeredPaths',
    category: 'process-lifetime',
    reason:
      'OpenAPI path registrations accumulated at import time from static zod schemas. The document is ' +
      'identical for every tenant.',
  },
  {
    file: 'apps/web/src/lib/server/domains/conversation/conversation.email-imap-queue.ts',
    name: 'initPromise',
    category: 'process-lifetime',
    reason:
      'A boot latch holding the in-flight BullMQ queue/worker construction so concurrent callers ' +
      'share one. Named explicitly by §4.4 as a genuine process-lifetime case. The LATCH is ' +
      'process-lifetime; what it gates was not, and an earlier version of this entry said it held ' +
      '"connection objects, never tenant rows", which was the same reassurance bootstrap._initialized ' +
      'was corrected for. A BullMQ Worker starts its run loop inside the constructor, so it keeps ' +
      'the async context alive at construction for every job it ever handles - and seven of these ' +
      "arm lazily on first enqueue, from inside a request. The arming tenant's scope would have " +
      "been welded onto the processor and every tenant's jobs would have run against that one " +
      'database. Closed on two layers: config refuses to boot pooled unless QUACKBACK_ROLE=web, and ' +
      'queue/create-worker.ts constructs every Worker detached so one built anyway inherits nothing ' +
      'and fails loudly on db rather than silently succeeding somewhere wrong.',
  },
  {
    file: 'apps/web/src/lib/server/domains/conversation/routing/routing.registry.ts',
    name: 'STRATEGIES',
    category: 'process-lifetime',
    reason:
      'Routing strategy objects registered at import. Stateless implementations, identical for every ' +
      'tenant.',
  },
  {
    file: 'apps/web/src/lib/server/domains/conversation/snooze-sweep-queue.ts',
    name: 'initPromise',
    category: 'process-lifetime',
    reason:
      'A boot latch holding the in-flight BullMQ queue/worker construction so concurrent callers ' +
      'share one. Named explicitly by §4.4 as a genuine process-lifetime case. The LATCH is ' +
      'process-lifetime; what it gates was not, and an earlier version of this entry said it held ' +
      '"connection objects, never tenant rows", which was the same reassurance bootstrap._initialized ' +
      'was corrected for. A BullMQ Worker starts its run loop inside the constructor, so it keeps ' +
      'the async context alive at construction for every job it ever handles - and seven of these ' +
      "arm lazily on first enqueue, from inside a request. The arming tenant's scope would have " +
      "been welded onto the processor and every tenant's jobs would have run against that one " +
      'database. Closed on two layers: config refuses to boot pooled unless QUACKBACK_ROLE=web, and ' +
      'queue/create-worker.ts constructs every Worker detached so one built anyway inherits nothing ' +
      'and fails loudly on db rather than silently succeeding somewhere wrong.',
  },
  {
    file: 'apps/web/src/lib/server/domains/export/export-queue.ts',
    name: 'initPromise',
    category: 'process-lifetime',
    reason:
      'A boot latch holding the in-flight BullMQ queue/worker construction so concurrent callers ' +
      'share one. Named explicitly by §4.4 as a genuine process-lifetime case. The LATCH is ' +
      'process-lifetime; what it gates was not, and an earlier version of this entry said it held ' +
      '"connection objects, never tenant rows", which was the same reassurance bootstrap._initialized ' +
      'was corrected for. A BullMQ Worker starts its run loop inside the constructor, so it keeps ' +
      'the async context alive at construction for every job it ever handles - and seven of these ' +
      "arm lazily on first enqueue, from inside a request. The arming tenant's scope would have " +
      "been welded onto the processor and every tenant's jobs would have run against that one " +
      'database. Closed on two layers: config refuses to boot pooled unless QUACKBACK_ROLE=web, and ' +
      'queue/create-worker.ts constructs every Worker detached so one built anyway inherits nothing ' +
      'and fails loudly on db rather than silently succeeding somewhere wrong.',
  },
  {
    file: 'apps/web/src/lib/server/domains/help-center/help-center-translate-queue.ts',
    name: 'initPromise',
    category: 'process-lifetime',
    reason:
      'A boot latch holding the in-flight BullMQ queue/worker construction so concurrent callers ' +
      'share one. Named explicitly by §4.4 as a genuine process-lifetime case. The LATCH is ' +
      'process-lifetime; what it gates was not, and an earlier version of this entry said it held ' +
      '"connection objects, never tenant rows", which was the same reassurance bootstrap._initialized ' +
      'was corrected for. A BullMQ Worker starts its run loop inside the constructor, so it keeps ' +
      'the async context alive at construction for every job it ever handles - and seven of these ' +
      "arm lazily on first enqueue, from inside a request. The arming tenant's scope would have " +
      "been welded onto the processor and every tenant's jobs would have run against that one " +
      'database. Closed on two layers: config refuses to boot pooled unless QUACKBACK_ROLE=web, and ' +
      'queue/create-worker.ts constructs every Worker detached so one built anyway inherits nothing ' +
      'and fails loudly on db rather than silently succeeding somewhere wrong.',
  },
  {
    file: 'apps/web/src/lib/server/domains/import/import-queue.ts',
    name: 'initPromise',
    category: 'process-lifetime',
    reason:
      'A boot latch holding the in-flight BullMQ queue/worker construction so concurrent callers ' +
      'share one. Named explicitly by §4.4 as a genuine process-lifetime case. The LATCH is ' +
      'process-lifetime; what it gates was not, and an earlier version of this entry said it held ' +
      '"connection objects, never tenant rows", which was the same reassurance bootstrap._initialized ' +
      'was corrected for. A BullMQ Worker starts its run loop inside the constructor, so it keeps ' +
      'the async context alive at construction for every job it ever handles - and seven of these ' +
      "arm lazily on first enqueue, from inside a request. The arming tenant's scope would have " +
      "been welded onto the processor and every tenant's jobs would have run against that one " +
      'database. Closed on two layers: config refuses to boot pooled unless QUACKBACK_ROLE=web, and ' +
      'queue/create-worker.ts constructs every Worker detached so one built anyway inherits nothing ' +
      'and fails loudly on db rather than silently succeeding somewhere wrong.',
  },
  {
    file: 'apps/web/src/lib/server/domains/platform-credentials/platform-credential.service.ts',
    name: '_dbSource',
    category: 'process-lifetime',
    reason:
      "A stateless strategy object. Its get()/has() read the ACTIVE tenant's " +
      'integration_platform_credentials rows through the db Proxy on every call; it caches nothing.',
  },
  {
    file: 'apps/web/src/lib/server/domains/platform-credentials/platform-credential.service.ts',
    name: '_envSource',
    category: 'process-lifetime',
    reason:
      'The env-backed sibling of the above, equally stateless. Reads process.env at call time, which ' +
      '§8 establishes is fleet-wide for the 24 integrations it governs.',
  },
  {
    file: 'apps/web/src/lib/server/domains/principals/anon-sweep-queue.ts',
    name: 'initPromise',
    category: 'process-lifetime',
    reason:
      'A boot latch holding the in-flight BullMQ queue/worker construction so concurrent callers ' +
      'share one. Named explicitly by §4.4 as a genuine process-lifetime case. The LATCH is ' +
      'process-lifetime; what it gates was not, and an earlier version of this entry said it held ' +
      '"connection objects, never tenant rows", which was the same reassurance bootstrap._initialized ' +
      'was corrected for. A BullMQ Worker starts its run loop inside the constructor, so it keeps ' +
      'the async context alive at construction for every job it ever handles - and seven of these ' +
      "arm lazily on first enqueue, from inside a request. The arming tenant's scope would have " +
      "been welded onto the processor and every tenant's jobs would have run against that one " +
      'database. Closed on two layers: config refuses to boot pooled unless QUACKBACK_ROLE=web, and ' +
      'queue/create-worker.ts constructs every Worker detached so one built anyway inherits nothing ' +
      'and fails loudly on db rather than silently succeeding somewhere wrong.',
  },
  {
    file: 'apps/web/src/lib/server/domains/sla/sla-breach-sweep-queue.ts',
    name: 'initPromise',
    category: 'process-lifetime',
    reason:
      'A boot latch holding the in-flight BullMQ queue/worker construction so concurrent callers ' +
      'share one. Named explicitly by §4.4 as a genuine process-lifetime case. The LATCH is ' +
      'process-lifetime; what it gates was not, and an earlier version of this entry said it held ' +
      '"connection objects, never tenant rows", which was the same reassurance bootstrap._initialized ' +
      'was corrected for. A BullMQ Worker starts its run loop inside the constructor, so it keeps ' +
      'the async context alive at construction for every job it ever handles - and seven of these ' +
      "arm lazily on first enqueue, from inside a request. The arming tenant's scope would have " +
      "been welded onto the processor and every tenant's jobs would have run against that one " +
      'database. Closed on two layers: config refuses to boot pooled unless QUACKBACK_ROLE=web, and ' +
      'queue/create-worker.ts constructs every Worker detached so one built anyway inherits nothing ' +
      'and fails loudly on db rather than silently succeeding somewhere wrong.',
  },
  {
    file: 'apps/web/src/lib/server/domains/workflows/dispatcher.guards.ts',
    name: 'warnedAudienceWorkflowIds',
    category: 'process-lifetime',
    reason:
      'A log-once set of workflow ids with an unenforceable stored audience. Ids are TypeIDs over ' +
      'UUIDs, so there is no cross-tenant collision to have; the only shared effect would be ' +
      'suppressing a duplicate diagnostic. It grows only when a stored audience is malformed.',
  },
  {
    file: 'apps/web/src/lib/server/domains/workflows/workflow-dispatch-queue.ts',
    name: 'initPromise',
    category: 'process-lifetime',
    reason:
      'A boot latch holding the in-flight BullMQ queue/worker construction so concurrent callers ' +
      'share one. Named explicitly by §4.4 as a genuine process-lifetime case. The LATCH is ' +
      'process-lifetime; what it gates was not, and an earlier version of this entry said it held ' +
      '"connection objects, never tenant rows", which was the same reassurance bootstrap._initialized ' +
      'was corrected for. A BullMQ Worker starts its run loop inside the constructor, so it keeps ' +
      'the async context alive at construction for every job it ever handles - and seven of these ' +
      "arm lazily on first enqueue, from inside a request. The arming tenant's scope would have " +
      "been welded onto the processor and every tenant's jobs would have run against that one " +
      'database. Closed on two layers: config refuses to boot pooled unless QUACKBACK_ROLE=web, and ' +
      'queue/create-worker.ts constructs every Worker detached so one built anyway inherits nothing ' +
      'and fails loudly on db rather than silently succeeding somewhere wrong.',
  },
  {
    file: 'apps/web/src/lib/server/domains/workflows/workflow-retention-queue.ts',
    name: 'initPromise',
    category: 'process-lifetime',
    reason:
      'A boot latch holding the in-flight BullMQ queue/worker construction so concurrent callers ' +
      'share one. Named explicitly by §4.4 as a genuine process-lifetime case. The LATCH is ' +
      'process-lifetime; what it gates was not, and an earlier version of this entry said it held ' +
      '"connection objects, never tenant rows", which was the same reassurance bootstrap._initialized ' +
      'was corrected for. A BullMQ Worker starts its run loop inside the constructor, so it keeps ' +
      'the async context alive at construction for every job it ever handles - and seven of these ' +
      "arm lazily on first enqueue, from inside a request. The arming tenant's scope would have " +
      "been welded onto the processor and every tenant's jobs would have run against that one " +
      'database. Closed on two layers: config refuses to boot pooled unless QUACKBACK_ROLE=web, and ' +
      'queue/create-worker.ts constructs every Worker detached so one built anyway inherits nothing ' +
      'and fails loudly on db rather than silently succeeding somewhere wrong.',
  },
  {
    file: 'apps/web/src/lib/server/domains/workflows/workflow-sweep-queue.ts',
    name: 'initPromise',
    category: 'process-lifetime',
    reason:
      'A boot latch holding the in-flight BullMQ queue/worker construction so concurrent callers ' +
      'share one. Named explicitly by §4.4 as a genuine process-lifetime case. The LATCH is ' +
      'process-lifetime; what it gates was not, and an earlier version of this entry said it held ' +
      '"connection objects, never tenant rows", which was the same reassurance bootstrap._initialized ' +
      'was corrected for. A BullMQ Worker starts its run loop inside the constructor, so it keeps ' +
      'the async context alive at construction for every job it ever handles - and seven of these ' +
      "arm lazily on first enqueue, from inside a request. The arming tenant's scope would have " +
      "been welded onto the processor and every tenant's jobs would have run against that one " +
      'database. Closed on two layers: config refuses to boot pooled unless QUACKBACK_ROLE=web, and ' +
      'queue/create-worker.ts constructs every Worker detached so one built anyway inherits nothing ' +
      'and fails loudly on db rather than silently succeeding somewhere wrong.',
  },
  {
    file: 'apps/web/src/lib/server/domains/workflows/workflow-wait-queue.ts',
    name: 'initPromise',
    category: 'process-lifetime',
    reason:
      'A boot latch holding the in-flight BullMQ queue/worker construction so concurrent callers ' +
      'share one. Named explicitly by §4.4 as a genuine process-lifetime case. The LATCH is ' +
      'process-lifetime; what it gates was not, and an earlier version of this entry said it held ' +
      '"connection objects, never tenant rows", which was the same reassurance bootstrap._initialized ' +
      'was corrected for. A BullMQ Worker starts its run loop inside the constructor, so it keeps ' +
      'the async context alive at construction for every job it ever handles - and seven of these ' +
      "arm lazily on first enqueue, from inside a request. The arming tenant's scope would have " +
      "been welded onto the processor and every tenant's jobs would have run against that one " +
      'database. Closed on two layers: config refuses to boot pooled unless QUACKBACK_ROLE=web, and ' +
      'queue/create-worker.ts constructs every Worker detached so one built anyway inherits nothing ' +
      'and fails loudly on db rather than silently succeeding somewhere wrong.',
  },
  {
    file: 'apps/web/src/lib/server/events/catalogue/define.ts',
    name: 'registry',
    category: 'process-lifetime',
    reason:
      'Event definitions registered at import from static declarations. Identical for every tenant.',
  },
  {
    file: 'apps/web/src/lib/server/events/process.ts',
    name: 'initPromise',
    category: 'process-lifetime',
    reason:
      'A boot latch holding the in-flight BullMQ queue/worker construction so concurrent callers ' +
      'share one. Named explicitly by §4.4 as a genuine process-lifetime case. The LATCH is ' +
      'process-lifetime; what it gates was not, and an earlier version of this entry said it held ' +
      '"connection objects, never tenant rows", which was the same reassurance bootstrap._initialized ' +
      'was corrected for. A BullMQ Worker starts its run loop inside the constructor, so it keeps ' +
      'the async context alive at construction for every job it ever handles - and seven of these ' +
      "arm lazily on first enqueue, from inside a request. The arming tenant's scope would have " +
      "been welded onto the processor and every tenant's jobs would have run against that one " +
      'database. Closed on two layers: config refuses to boot pooled unless QUACKBACK_ROLE=web, and ' +
      'queue/create-worker.ts constructs every Worker detached so one built anyway inherits nothing ' +
      'and fails loudly on db rather than silently succeeding somewhere wrong.',
  },
  {
    file: 'apps/web/src/lib/server/events/registry.ts',
    name: 'builtinHooks',
    category: 'process-lifetime',
    reason:
      'Built-in hook handler implementations. NOT merely registered at import and NOT stateless: ' +
      'registerHook() is an exported mutator and getHook() writes a resolved handler back into the ' +
      'map, so it changes at runtime. The category still holds because the VALUES are ' +
      'tenant-agnostic module functions - every workspace resolves the same handler for the same ' +
      'hook type - but "stateless" was the wrong reason for a right answer.',
  },
  {
    file: 'apps/web/src/lib/server/events/resolvers/index.ts',
    name: 'registered',
    category: 'process-lifetime',
    reason:
      'Register-once latch for the sink resolver registry. The resolvers themselves are stateless ' +
      'implementations.',
  },
  {
    file: 'apps/web/src/lib/server/events/resolvers/registry.ts',
    name: 'resolvers',
    category: 'process-lifetime',
    reason:
      "The registered sink resolver implementations. Stateless; each reads the active tenant's " +
      'database when asked.',
  },
  {
    file: 'apps/web/src/lib/server/events/segment-scheduler.ts',
    name: 'initPromise',
    category: 'process-lifetime',
    reason:
      'A boot latch holding the in-flight BullMQ queue/worker construction so concurrent callers ' +
      'share one. Named explicitly by §4.4 as a genuine process-lifetime case. The LATCH is ' +
      'process-lifetime; what it gates was not, and an earlier version of this entry said it held ' +
      '"connection objects, never tenant rows", which was the same reassurance bootstrap._initialized ' +
      'was corrected for. A BullMQ Worker starts its run loop inside the constructor, so it keeps ' +
      'the async context alive at construction for every job it ever handles - and seven of these ' +
      "arm lazily on first enqueue, from inside a request. The arming tenant's scope would have " +
      "been welded onto the processor and every tenant's jobs would have run against that one " +
      'database. Closed on two layers: config refuses to boot pooled unless QUACKBACK_ROLE=web, and ' +
      'queue/create-worker.ts constructs every Worker detached so one built anyway inherits nothing ' +
      'and fails loudly on db rather than silently succeeding somewhere wrong.',
  },
  {
    file: 'apps/web/src/lib/server/functions/bootstrap.ts',
    name: '_initialized',
    category: 'process-lifetime',
    reason:
      'A once-per-process latch gating telemetry startup, and process-lifetime is exactly what it ' +
      'should mean. An earlier version of this entry said the worst shared effect was a missing log ' +
      'line; that was wrong. The latch is fine - the WORK it gated was not, because the timer it ' +
      'arms is scheduled inside a request and AsyncLocalStorage carried that request tenant scope ' +
      'into it, into startTelemetry and into its hourly interval for the life of the pod. ' +
      'withSweepLock fans out only when no scope is active, so the first tenant to render a page ' +
      'owned the fleet telemetry: an hourly claim in ITS database and an unlocked ' +
      'read-modify-write of ITS settings.metadata, the write section 3 names as able to drop the ' +
      'fingerprint stamp. Fixed by detaching with runWithoutLogContext; pinned by ' +
      '__tests__/background-work-armed-in-request.test.ts.',
  },
  {
    file: 'apps/web/src/lib/server/functions/recovery-codes-consume.ts',
    name: 'fakeHashPromise',
    category: 'process-lifetime',
    reason:
      'A scrypt hash of the literal string FAKE-FAKE-FAKE, computed once so the unknown-email branch ' +
      'spends the same cost as the matching one. No tenant value is an input.',
  },
  {
    file: 'apps/web/src/lib/server/queue/redis-config.ts',
    name: '_shared',
    category: 'process-lifetime',
    reason: 'The shared ioredis connection handle for BullMQ. A connection, not a cache.',
  },
  {
    file: 'apps/web/src/lib/server/queue/role.ts',
    name: 'warnedInvalid',
    category: 'process-lifetime',
    reason:
      'Warn-once latch for an invalid QUACKBACK_ROLE, which is a process-level environment variable.',
  },
  {
    file: 'apps/web/src/lib/server/queue/worker-registry.ts',
    name: 'bootState',
    category: 'process-lifetime',
    reason:
      'Per worker NAME boot status, read by the readiness probe. Workers are a property of the ' +
      'process, not of a tenant.',
  },
  {
    file: 'apps/web/src/lib/server/realtime/pubsub.ts',
    name: 'subscriber',
    category: 'process-lifetime',
    reason:
      'The shared Redis subscriber connection. One socket per process by design; every channel on it ' +
      'is tenant-namespaced.',
  },
  {
    file: 'apps/web/src/lib/server/redis.ts',
    name: 'client',
    category: 'process-lifetime',
    reason:
      'The shared application Redis connection handle. Every key written through it is namespaced by ' +
      'tenantKey().',
  },
  {
    file: 'apps/web/src/lib/server/startup.ts',
    name: '_logged',
    category: 'process-lifetime',
    reason: 'Log-once latch. Named explicitly by §4.4 as a genuine process-lifetime case.',
  },
  {
    file: 'apps/web/src/lib/server/startup.ts',
    name: '_shutdownWired',
    category: 'process-lifetime',
    reason:
      'Signal-handler-once latch, so a second startup call does not wire a second SIGTERM handler. ' +
      'Named explicitly by §4.4 as a genuine process-lifetime case; shutdown is a process event.',
  },
  {
    file: 'apps/web/src/lib/server/storage/s3.ts',
    name: '_presignerModule',
    category: 'process-lifetime',
    owner: 'Piece 18 (saas/tenant-secrets)',
    reason:
      'A memoized dynamic import() of the presigner module. Carries no configuration and no ' +
      'credential.',
  },
  {
    file: 'apps/web/src/lib/server/storage/s3.ts',
    name: '_s3Module',
    category: 'process-lifetime',
    owner: 'Piece 18 (saas/tenant-secrets)',
    reason:
      'A memoized dynamic import() of the AWS SDK module object. Carries no configuration and no ' +
      'credential.',
  },
  {
    file: 'apps/web/src/lib/server/storage/s3.ts',
    name: 'credentialResolver',
    category: 'process-lifetime',
    owner: 'Piece 18 (saas/tenant-secrets)',
    reason:
      'The installed resolver function, not a credential. Per-tenant resolution happens inside it on ' +
      'every call.',
  },
  {
    file: 'apps/web/src/lib/server/tenancy/pool-cache.ts',
    name: 'stats',
    category: 'process-lifetime',
    reason: 'Eviction and checkout counters for the pool cache. Diagnostics about the process.',
  },
  {
    file: 'apps/web/src/lib/server/tenancy/pool-cache.ts',
    name: 'sweeper',
    category: 'process-lifetime',
    reason:
      'The idle-eviction interval handle. One timer per process drives eviction across every ' +
      "tenant's pool, which is the intent: eviction is what lets an idle tenant compute suspend.",
  },
  {
    file: 'apps/web/src/lib/server/tenancy/registry.ts',
    name: 'controlSql',
    category: 'process-lifetime',
    reason:
      'The control-plane database connection handle. One control store per fleet by definition.',
  },
  {
    file: 'apps/web/src/lib/shared/i18n.ts',
    name: 'isRtlForced',
    category: 'process-lifetime',
    reason:
      'Memoizes whether ?rtl=1 was set on the page URL. Browser-side debug affordance; on the server ' +
      'it evaluates to false because there is no window.',
  },
  {
    file: 'apps/web/src/lib/server/db.ts',
    name: 'db',
    category: 'tenant-scoped-key',
    keyedBy: 'getScopedDatabase',
    reason:
      'The Proxy that 537 files import. It holds no connection of its own: the get trap calls ' +
      'getDatabase() on every property access, which returns the ACTIVE tenant scope handle and ' +
      'throws under pooled tenancy when there is none. The instance is shared precisely so the ' +
      'resolution behind it does not have to be.',
  },
  {
    file: 'packages/logger/src/context.ts',
    name: 'storage',
    category: 'process-lifetime',
    reason:
      'The AsyncLocalStorage that CARRIES tenant identity, so it is the one instance that must be ' +
      'shared: one store per process is what lets the web app, @quackback/db and @quackback/email ' +
      'read the same request scope. Partitioning it by tenant would be circular, since the store is ' +
      'how the tenant is known. What it holds is per-async-context, never process-global.',
  },
  {
    file: 'apps/web/src/lib/server/markdown-tiptap.ts',
    name: 'manager',
    category: 'process-lifetime',
    reason:
      'A MarkdownManager built once from the static SERVER_EXTENSIONS schema. No workspace value ' +
      'reaches it and parse/serialize retain nothing. Be precise about what IS shared, though: ' +
      'constructing a MarkdownManager calls setOptions on the module-global `marked` singleton, so ' +
      'commentManager below leaves ITS gfm/breaks options as the process-wide default. Both are ' +
      'compile-time constants applied at module load and identical for every tenant, which is why ' +
      'the category stands, but "static configuration, no shared effect" would be wrong.',
  },
  {
    file: 'apps/web/src/lib/server/markdown-tiptap.ts',
    name: 'commentManager',
    category: 'process-lifetime',
    reason:
      'The comment-schema sibling of manager, built from a second static extension list for the ' +
      'narrower node set comments allow. It is the later of the two to construct, so its ' +
      'markedOptions win on the shared `marked` singleton - deterministically, at module load, ' +
      'identically for every tenant. Static values, one global side effect, no tenant dimension.',
  },
  {
    file: 'apps/web/src/lib/server/content/email-html-to-content.ts',
    name: 'turndown',
    category: 'process-lifetime',
    reason:
      'A TurndownService configured with three literal style options (atx headings, fenced code, ' +
      'dash bullets). Rules are registered at construction from constants and conversion is a pure ' +
      'function of the HTML passed in, so a shared instance returns what a fresh one would.',
  },
  {
    file: 'apps/web/src/lib/server/auth/sso-test-callback.ts',
    name: 'SCRIPT_BREAKERS',
    category: 'process-lifetime',
    reason:
      'A global-flagged RegExp, so it carries a mutable lastIndex and is not the value type a bare ' +
      'new RegExp looks like. Safe here only because its single use is String.replace, which resets ' +
      'lastIndex on every call; an .exec() loop over the same instance would interleave across ' +
      'requests. Ledgered rather than exempted so the next use of it is a visible diff.',
  },
  {
    file: 'apps/web/src/lib/shared/workflows/interpolate.ts',
    name: 'TOKEN_PATTERN',
    category: 'process-lifetime',
    reason:
      'The same shape as SCRIPT_BREAKERS: a g-flagged RegExp with a mutable lastIndex, used once ' +
      'through String.replace, which resets it. Holds no tenant value - the pattern is built from a ' +
      'compile-time token grammar.',
  },
  {
    file: 'apps/web/src/lib/server/queue/create-worker.ts',
    name: 'refused',
    category: 'process-lifetime',
    reason:
      'Queue names already warned about, so the pooled refusal logs once per queue rather than ' +
      'once per enqueue. Keys are the fifteen compile-time queue-name constants, identical for ' +
      'every tenant; the only shared effect is a suppressed duplicate log line. Caught by this ' +
      'scanner on the commit that introduced it, which is the ratchet working on its own author.',
  },
]
