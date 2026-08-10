/**
 * The pooled Quackback fleet on Railway.
 *
 * `SAAS-HOSTING-STACK.md` §1 describes the shape and §9 names the platform
 * features to use rather than reinvent. It is four kinds of service, and the
 * difference between them is which connections they hold:
 *
 * | Service | Role | Connections | Sleeps |
 * | --- | --- | --- | --- |
 * | `quackback` | `web` | tenant **pooled** endpoints, evicted after 45 s idle | no — the pooled tier is always warm |
 * | `quackback-worker` | `worker` | tenant **direct** endpoints, one always-attached relay loop per tenant | no — and neither do the tenant computes it holds |
 * | `quackback-cron-*` | `worker`, one-shot | whatever the sweep touches, for the length of the run | n/a — it exits |
 * | `quackback-web-sleeper` | `web` | same as `quackback` | **yes** (`deploy.sleepApplication`) |
 *
 * The web/worker split is not an optimisation. `LISTEN` is silently lost
 * through a transaction-mode pooler (§7.3, measured: a NOTIFY is never
 * delivered, at any concurrency), so the relay cannot share the web tier's
 * pooled connections; and a process that polls a tenant database on a timer
 * holds its Neon compute awake forever, so the relay cannot share the web
 * tier's process either.
 *
 * No database appears here. Tenant databases are Neon, one project each, and
 * the control-plane registry is a Neon project too — see the note in the body
 * for why §9's "Railway Postgres for the control plane" did not survive contact
 * with region placement.
 *
 * ## This file does not yet describe the whole environment — do not `apply`
 *
 * The control-plane service and its `qb-cp-*` buckets live in this project and
 * are absent here, because they were created through the API rather than
 * declared. Absent means *deleted*: a plan run today proposes destroying the
 * control-plane service and two of its buckets alongside the Redis removal this
 * file does intend. So `apply` is unsafe until they are declared, and until then
 * a variable set through the CLI is live but not durable — the next apply, once
 * it is safe to run, removes anything this file does not name.
 */
import { bucket, defineRailway, preserve, project, service } from 'railway/iac'

/** Virginia, same metro as the Neon `us-east-1` projects. See the README: this
 * is declared intent only — `plan` never diffs placement and `apply` never
 * writes it, so it must be verified directly after every deploy. */
const REGION = 'us-east4-eqdc4a'

export default defineRailway(() => {
  // NOTE ON THE CONTROL DATABASE — §9 says Railway Postgres is "still the right
  // answer" for it: always active, small, co-located on the private network. It
  // was built that way here and then moved to Neon `us-east-1`, because Railway
  // Postgres could not be placed in this fleet's region through any documented
  // path:
  //
  //   * `postgres(name, { region })` is not applied. The service and its volume
  //     were both created in `sfo` — the same class of gap the README already
  //     records for `replicas` on a normal service.
  //   * A volume's region is fixed at creation. Repointing the *service* to
  //     `us-east4-eqdc4a` leaves the volume in `sfo`, and the deployment then
  //     cannot schedule at all.
  //   * `volumeDelete` returns `true` and **soft-deletes with a two-day
  //     window**, during which `volumeCreate` refuses ("a service can only have
  //     one volume"). So the volume cannot be re-created in the right region
  //     either, for two days.
  //
  // 3,900 km between the control database and the tier that reads it on the
  // request path is worse than the tradeoff Neon brings, which is that the
  // control compute also scales to zero: on a fully idle fleet the first request
  // pays a control-plane wake *before* the tenant wake. That is a real cost and
  // it is stated rather than hidden.
  const uploads = bucket('quackback-gauntlet', { region: 'iad' })

  // Per-tenant buckets, created by the control plane through the API.
  //
  // §9's line is "IaC for the skeleton, API for tenants" — and Railway's IaC
  // cannot express that. Anything absent from this file is a *deletion*: with
  // these three omitted, `railway config plan` proposed
  // "Delete bucket qb-neon-t1 / qb-neon-t2 / qb-neon-t4", which is every
  // tenant's stored objects. So dynamic per-tenant resources must still be
  // enumerated here, and a fleet that provisions tenants by API needs this file
  // regenerated (or `apply` never run) rather than hand-maintained. Recorded as
  // a correction to §9 rather than worked around silently.
  const tenantBuckets = [
    bucket('qb-neon-t1', { region: 'iad' }),
    bucket('qb-neon-t2', { region: 'iad' }),
    bucket('qb-neon-t4', { region: 'iad' }),
  ]

  /** Everything every app service needs, whatever its role. */
  const fleetEnv = {
    NODE_ENV: 'production',
    PORT: '3000',
    RAILWAY_DOCKERFILE_PATH: 'apps/web/Dockerfile',

    // One process, many tenants, database chosen per request from the Host
    // header. `DATABASE_URL` is deliberately absent: pooled mode refuses to
    // boot with one, because a stray fleet-wide DSN would let a missing tenant
    // scope connect somewhere real instead of throwing.
    QUACKBACK_TENANCY: 'pooled',
    // The Neon control project (see the note above). A secret, so it is set out
    // of band and preserved here rather than written into source.
    QUACKBACK_CONTROL_DATABASE_URL: preserve(),

    // Below both Neon's suspend timeout (300 s documented, 337 s measured) and
    // Railway's 600 s sleep window. This is the number the idle-cost model
    // rests on — see `tenancy/pool-cache.ts`.
    TENANT_POOL_IDLE_SECONDS: '45',

    // The entrypoint would otherwise migrate on every boot. Under pooled
    // tenancy there is no single database to migrate anyway: per-tenant schema
    // work belongs to the migrator role.
    SKIP_MIGRATIONS: 'true',

    // The compatibility gate (§10.5), and the reason it is not optional here.
    // Unset, a tenant whose schema is older than this build does not degrade —
    // it 500s at query time, because drizzle emits explicit column lists and
    // `select …, "cloud", … from "settings"` throws where the column does not
    // exist. Set, the same tenant is refused on pool checkout with a 503 and a
    // `Retry-After`, alone, while every other tenant keeps serving.
    //
    // The value is the newest migration THIS build bundles, and that is the
    // honest floor rather than a conservative one: the drizzle TS schema
    // declares `settings.cloud`/`cloud_revision` (0249/0250), `job_queue`
    // (0253), `outbox_relay_leader` (0256) and the five kv/presence tables
    // (0257), so a tenant below any of them cannot be served by this image at
    // all. Bump it with the bundle.
    //
    // A value naming no bundled migration is a refusal to start, not a floor of
    // zero — `boot-config.ts` resolves it as the first statement of `server.ts`
    // and exits 1. Declared on every app service because the check runs on pool
    // checkout, which the worker and cron roles also perform.
    MIN_SCHEMA_VERSION: '0257_pg_kv_presence_realtime',

    // Fleet-level secrets, set out of band and never written to source.
    SECRET_KEY: preserve(),
    NEON_API_KEY: preserve(),

    // The one root every tenant's SECRET_KEY derives from and every tenant
    // storage credential is sealed under (`derived+hkdf://`, `sealed+aead://`).
    // Declared here so a tenant costs no fleet variable — the per-tenant
    // `env://QUACKBACK_TENANT_SECRET_*` scheme it replaces needed one each, and
    // one absent from this file is deleted by the next apply.
    //
    // It must be the SAME value on every service that resolves tenants, and the
    // same value the control plane holds: the control plane seals, a replica
    // opens, and two different roots produce ciphertext nobody can open rather
    // than an error.
    QUACKBACK_FLEET_ROOT_KEY: preserve(),

    // A real fleet hostname, never `https://${{RAILWAY_PUBLIC_DOMAIN}}`: with a
    // wildcard custom domain attached that variable is the literal string
    // `*.quackback.co.uk`, and BASE_URL feeds cookie `secure`, trusted origins
    // and every absolute URL (§9). Under pooled tenancy each tenant's own
    // origin comes from its registry record; this is only the fallback for
    // fleet paths that belong to no tenant.
    BASE_URL: preserve(),

    // Railway buckets are private-only, so S3_PUBLIC_URL stays unset and every
    // asset is served through the app's /api/storage proxy.
    S3_ENDPOINT: preserve(),
    S3_BUCKET: preserve(),
    S3_REGION: preserve(),
    S3_ACCESS_KEY_ID: preserve(),
    S3_SECRET_ACCESS_KEY: preserve(),
    S3_FORCE_PATH_STYLE: 'false',
  }

  /** The build every app service shares. One image, four roles. */
  const appBuild = {
    // The repo Dockerfile builds the widget bundle, the TanStack Start server
    // and a standalone migration bundle. Railpack cannot reproduce that.
    build: { builder: 'DOCKERFILE' as const, dockerfilePath: 'apps/web/Dockerfile' },
    replicas: { [REGION]: 1 },
    // Only the retry count is declared. The restart policy itself is already
    // the platform default, and a value equal to the default is accepted but
    // never stored — declaring it here would show as permanent plan drift.
    deploy: { restartPolicyMaxRetries: 3 },
  }

  // The always-warm pooled tier. Serves every tenant hostname on the wildcard
  // domain; holds no timers and no session connections, so between requests it
  // is silent and every tenant compute it touched can suspend.
  const web = service('quackback', {
    ...appBuild,
    healthcheckPath: '/api/health/ready',
    healthcheckTimeout: 300,
    env: { ...fleetEnv, QUACKBACK_ROLE: 'web' },
  })

  // The conductor (§1.3): one always-warm tier running the relay for every
  // tenant on **direct, session-mode** connections. No public domain — nothing
  // routes user traffic here.
  const worker = service('quackback-worker', {
    ...appBuild,
    healthcheckPath: '/api/health/ready',
    healthcheckTimeout: 300,
    env: { ...fleetEnv, QUACKBACK_ROLE: 'worker' },
  })

  // The scheduled sweeps, as `deploy.cronSchedule` services that run and exit.
  // They are not on the worker's timers because every sweep fans out across the
  // whole fleet: a 5-minute reconciler means every suspended compute is woken
  // every 5 minutes, against a 300 s suspend timeout. See `cron/fleet-jobs.ts`.
  const cronDaily = service('quackback-cron-daily', {
    ...appBuild,
    // `restartPolicyType: NEVER` is what Railway itself stores for a cron
    // service, and it is right: a failed sweep must wait for the next slot, not
    // restart-loop against a fleet of tenant databases. `restartPolicyMaxRetries`
    // is dropped here for the same reason — it means nothing under NEVER, and
    // declaring it produced permanent plan drift.
    deploy: { restartPolicyType: 'NEVER', cronSchedule: '17 3 * * *' },
    env: { ...fleetEnv, QUACKBACK_ROLE: 'worker', QUACKBACK_CRON_JOB: 'daily' },
  })

  const cronHourly = service('quackback-cron-hourly', {
    ...appBuild,
    deploy: { restartPolicyType: 'NEVER', cronSchedule: '23 * * * *' },
    env: { ...fleetEnv, QUACKBACK_ROLE: 'worker', QUACKBACK_CRON_JOB: 'hourly' },
  })

  // A `role=web` service with sleep enabled — the `single`-mode shape from §1.2,
  // and the only way to answer §13's open question 6 ("does a role=web service
  // actually sleep?") against a real deployment rather than by reasoning. Same
  // image, same role, same tenancy as `quackback`; the only difference is the
  // toggle, so what it measures is the role rather than a special build.
  const sleeper = service('quackback-web-sleeper', {
    ...appBuild,
    healthcheckPath: '/api/health/ready',
    healthcheckTimeout: 300,
    deploy: { ...appBuild.deploy, sleepApplication: true },
    env: { ...fleetEnv, QUACKBACK_ROLE: 'web' },
  })

  return project('quackback-pooled-gauntlet', {
    resources: [web, worker, cronDaily, cronHourly, sleeper, uploads, ...tenantBuckets],
  })
})
