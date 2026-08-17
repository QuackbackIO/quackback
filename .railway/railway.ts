/**
 * The pooled Quackback fleet on Railway.
 *
 * `SAAS-HOSTING-STACK.md` §1 describes the shape and §9 names the platform
 * features to use rather than reinvent. It is four kinds of service, and the
 * difference between them is which connections they hold:
 *
 * | Service | Role | Connections | Sleeps |
 * | --- | --- | --- | --- |
 * | `quackback` | `web` | workspace **pooled** endpoints, evicted after 45 s idle | no — the pooled tier is always warm |
 * | `quackback-worker` | `worker` | workspace **direct** endpoints, one always-attached relay loop per workspace | no — and neither do the workspace computes it holds |
 * | `quackback-cron-*` | `worker`, one-shot | whatever the sweep touches, for the length of the run | n/a — it exits |
 * | `quackback-migrator` | `migrator`, one-shot | the **direct** endpoint of each workspace it claims | n/a — it exits |
 *
 * All five run the same image, pinned by digest. See APP_IMAGE.
 *
 * The web/worker split is not an optimisation. `LISTEN` is silently lost
 * through a transaction-mode pooler (§7.3, measured: a NOTIFY is never
 * delivered, at any concurrency), so the relay cannot share the web tier's
 * pooled connections; and a process that polls a workspace database on a timer
 * holds its Neon compute awake forever, so the relay cannot share the web
 * tier's process either.
 *
 * No database appears here. Workspace databases are Neon, one project each, and
 * the control-plane registry is a Neon project too — see the note in the body
 * for why §9's "Railway Postgres for the control plane" did not survive contact
 * with region placement.
 *
 * ## This file describes the whole environment, and `apply` is live
 *
 * It did not always. The control-plane service, the Redis database, the
 * `qb-cp-*` buckets and four secrets were created through the API and never
 * declared, and absent means *deleted*: a plan proposed destroying all of them,
 * including the two per-workspace `SECRET_KEY`s. The buckets turned out to hold
 * only provisioning probes and were removed in 2026-08; the rest are declared
 * now, `plan` reports no changes, and `apply` has been run.
 *
 * What that costs is a standing obligation. Anything the control plane creates
 * through the API — a workspace bucket, a per-workspace secret — has to be added
 * here, or the next `apply` removes it. Run `plan` before `apply`, every time,
 * and read the destroy list rather than the count.
 */
import { bucket, defineRailway, image, preserve, project, redis, service } from 'railway/iac'

/**
 * The one image, by digest.
 *
 * §10.8's deploy gate says step 2 ships the artifact step 1 validated against.
 * Under a source build that is an assumption, not a fact: each service uploads
 * the tree and builds independently, so five services produce five images from
 * one commit. Almost certainly identical, and "almost certainly" is the whole
 * problem — the gate's promise is that the migrator and the serving tier are
 * the same build, and nothing enforced it.
 *
 * A digest enforces it. `ghcr.io/quackbackio/quackback` is the package the
 * repository's Docker workflow already publishes, public, so Railway pulls it
 * anonymously and no registry credential has to exist in a file that cannot
 * express one.
 *
 * Pinned to the DIGEST, never the `saas` tag: a tag moves under a running
 * service, so two services deployed a day apart from `:saas` are back to being
 * two different builds with one name. Rolling forward is editing this line,
 * which is also what makes rolling back the same edit in reverse.
 *
 * Contains: the TanStack Start server, the widget bundle, `migrate.mjs`, the
 * drizzle SQL, and `fleet-migrator.mjs`. That last one is why one artifact is
 * enough for every role the rollout touches.
 */
const APP_IMAGE =
  'ghcr.io/quackbackio/quackback@sha256:54f4c14152f4b9bae3629de4be1ad330f484888ff4fa6235c579b25c961fcc29'

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
  // pays a control-plane wake *before* the workspace wake. That is a real cost and
  // it is stated rather than hidden.
  const uploads = bucket('quackback-gauntlet', { region: 'iad' })

  // There are no per-workspace buckets. The five the control plane once
  // created through the API (qb-neon-t1/t2/t4, qb-cp-t1/t2crit) were deleted
  // on 2026-08-14: every registry row names the fleet bucket, none named
  // them, and their contents were provisioning probes (<=1.3 KB), not
  // workspace data. The standing obligation still holds for anything the
  // control plane creates through the API in future: it has to be added
  // here, or the next `apply` removes it.

  /** Everything every app service needs, whatever its role. */
  const fleetEnv = {
    NODE_ENV: 'production',
    PORT: '3000',

    // One process, many workspaces, database chosen per request from the Host
    // header. `DATABASE_URL` is deliberately absent: pooled mode refuses to
    // boot with one, because a stray fleet-wide DSN would let a missing workspace
    // scope connect somewhere real instead of throwing.
    QUACKBACK_TENANCY: 'pooled',
    // Custom-host edge: Worker fetches the Railway-provided origin (set out
    // of band; the hostname is assigned by the platform) and signs the
    // visitor Host. Trusted incoming Hosts are the fallback + that origin.
    QUACKBACK_SAAS_FALLBACK_ORIGIN: preserve(),
    QUACKBACK_SAAS_RAILWAY_ORIGIN: preserve(),
    QUACKBACK_SAAS_EDGE_SECRET: preserve(),
    // The Neon control project (see the note above). A secret, so it is set out
    // of band and preserved here rather than written into source.
    QUACKBACK_CONTROL_DATABASE_URL: preserve(),

    // Mail, inbound. The domain is the apex, already onboarded at the edge for
    // routing, so a workspace address is `<mail_slug>@` on it.
    // The domain SES actually receives on. The receipt rule set accepts
    // recipients at this domain only, and its MX is the SES inbound endpoint.
    // The apex is NOT it: the apex MX points at a different provider, so an
    // address minted there is delivered somewhere we do not read. Changing this
    // is half a cutover; the old domain belongs in EMAIL_INBOUND_EXTRA_DOMAINS
    // so addresses already handed out keep being accepted.
    EMAIL_INBOUND_DOMAIN: 'mail.quackback.co.uk',
    // Domains the fleet still RECEIVES on after retiring them from minting, set
    // out of band because the value changes with a mail cutover rather than with
    // a deploy — which is exactly why it has to be declared here.
    //
    // Anything absent from this file is DELETED on the next apply. Deleting this
    // one narrows the accept-set back to the minting domain, and every reply
    // address ever issued on a retired domain then arrives at a front door that
    // refuses it: mail that has to be replayed by hand, for a variable nobody
    // noticed going missing. `preserve()` keeps whatever the platform holds, so
    // a cutover set by hand survives an apply and an empty value stays empty.
    EMAIL_INBOUND_EXTRA_DOMAINS: preserve(),
    EMAIL_FROM: 'Quackback <noreply@quackback.co.uk>',
    // Two secrets, set out of band and preserved here, and deliberately
    // distinct: one authenticates the edge sender's POST, the other signs the
    // plus-address inside a reply address. Sharing them would mean a leak of
    // either widened to both.
    INBOUND_HMAC_SECRET: preserve(),
    EMAIL_INBOUND_SIGNING_SECRET: preserve(),

    // Mail, outbound. Both halves of the credential are required before this
    // rung is taken at all, and a service holding neither falls to the console
    // rung, which logs a preview and delivers nothing. That is the failure this
    // block exists to prevent: it reports success while sending no mail.
    //
    // Secrets, so they are set out of band like the two above. `preserve()`
    // cannot bootstrap a value the platform does not already hold, so all four
    // have to exist before the first apply, not after it: an apply against a
    // service that holds none of them succeeds and leaves the service unable to
    // send.
    EMAIL_SES_ACCESS_KEY_ID: preserve(),
    EMAIL_SES_SECRET_ACCESS_KEY: preserve(),
    // Not a secret, and not defaulted in code either: a verified sending
    // identity belongs to one region, so a guess here is a fleet whose every
    // send is rejected for an identity that exists in the other one. Declared
    // literally because it is a fact about where the identities were verified,
    // which is exactly what this file is for. It must match the region the
    // `quackback.co.uk` identities are verified in.
    EMAIL_SES_REGION: 'us-east-1',

    // Below both Neon's suspend timeout (300 s documented, 337 s measured) and
    // Railway's 600 s sleep window. This is the number the idle-cost model
    // rests on — see `tenancy/pool-cache.ts`.
    WORKSPACE_POOL_IDLE_SECONDS: '45',

    // The entrypoint would otherwise migrate on every boot. Under pooled
    // tenancy there is no single database to migrate anyway: per-workspace schema
    // work belongs to the migrator role.
    SKIP_MIGRATIONS: 'true',

    // The compatibility gate (§10.5), and the reason it is not optional here.
    // Unset, a workspace whose schema is older than this build does not degrade —
    // it 500s at query time, because drizzle emits explicit column lists and
    // `select …, "cloud", … from "settings"` throws where the column does not
    // exist. Set, the same workspace is refused on pool checkout with a 503 and a
    // `Retry-After`, alone, while every other workspace keeps serving.
    //
    // The value is the newest migration THIS build bundles, and that is the
    // honest floor rather than a conservative one: the drizzle TS schema
    // declares `settings.cloud`/`cloud_revision` (0249/0250), `job_queue`
    // (0253), `outbox_relay_leader` (0256) and the five kv/presence tables
    // (0257), so a workspace below any of them cannot be served by this image at
    // all. Bump it with the bundle.
    //
    // A value naming no bundled migration is a refusal to start, not a floor of
    // zero — `boot-config.ts` resolves it as the first statement of `server.ts`
    // and exits 1. Declared on every app service because the check runs on pool
    // checkout, which the worker and cron roles also perform.
    MIN_SCHEMA_VERSION: '0258_workspace_key_columns',

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

    // Service-to-service auth for the fleet's internal endpoints. Secret, set
    // out of band. Undeclared, it was on the delete list of every apply.
    QUACKBACK_FLEET_INTERNAL_TOKEN: preserve(),

    // Control-plane projection public key. Live on every app service; the
    // matching private key is on the control plane. Undeclared, the next
    // apply deletes it from all five and billing/projection verify fails open
    // or closed depending on the call site.
    QUACKBACK_CP_PROJECTION_PUBLIC_KEY: preserve(),

    // AI via OpenRouter. The key is set out of band; the endpoint and models
    // are facts about this fleet. Without key + base URL + at least one model,
    // every AI feature is off (#180). Declared here so the next apply does not
    // delete a live configuration that was set by hand.
    OPENAI_API_KEY: preserve(),
    OPENAI_BASE_URL: 'https://openrouter.ai/api/v1',
    AI_CHAT_MODEL: 'openai/gpt-4o-mini',
    AI_EMBEDDING_MODEL: 'openai/text-embedding-3-small',

    // Redis is no longer read by the app, but the variable and the database
    // both still exist, and anything absent from this file is a deletion.
    // Preserved rather than removed so that retiring Redis stays a deliberate
    // act instead of a side effect of the next apply.
    REDIS_URL: preserve(),

    // Per-workspace `SECRET_KEY`s, under the `env://QUACKBACK_TENANT_SECRET_*`
    // scheme. The comment above says the derived scheme means "a tenant costs
    // no fleet variable" — true for workspaces provisioned that way, and these
    // two predate it. They are enumerated for exactly the reason the workspace
    // buckets are: undeclared, `apply` deletes them, and a workspace whose
    // SECRET_KEY is gone refuses every request with `app_secret_unresolvable`.
    //
    // The variable NAME still says `TENANT` because it is a wire name: it is
    // quoted verbatim in each registry record's `app_secrets_ref` and pinned by
    // a CHECK constraint. Renaming it is a migration, not a rename.
    QUACKBACK_TENANT_SECRET_INST_GAUNTLET_NEON_T1_D7D62CFD_APP: preserve(),
    QUACKBACK_TENANT_SECRET_INST_GAUNTLET_NEON_T2_24488091_APP: preserve(),

    // A real fleet hostname, never `https://${{RAILWAY_PUBLIC_DOMAIN}}`: with a
    // wildcard custom domain attached that variable is the literal string
    // `*.quackback.co.uk`, and BASE_URL feeds cookie `secure`, trusted origins
    // and every absolute URL (§9). Under pooled tenancy each workspace's own
    // origin comes from its registry record; this is only the fallback for
    // fleet paths that belong to no workspace.
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

  /** What every app service shares. One image, four roles, one digest. */
  const appBuild = {
    // Not a build. Every app service deploys the same published image by
    // digest, so "the migrator ran against this build" and "the web tier is
    // running this build" are the same sentence about the same bytes rather
    // than two hopes about two Dockerfile runs. See APP_IMAGE.
    //
    // The repo Dockerfile still describes how that image is made — widget
    // bundle, TanStack Start server, migration bundle, fleet migrator — it is
    // just no longer run here, once per service. CI builds it once, and this
    // file names the result.
    source: image(APP_IMAGE),
    // Vestigial, and declared because it cannot be removed. Switching a service
    // to an image source leaves its build config stored; `apply` accepts the
    // clearing, reports it applied, and does not store it, so a file that omits
    // this reports the same two changes on every `plan` forever and
    // `--detailed-exit-code` never reaches 0. That is the drift gate the README
    // recommends for CI, disabled by an omission. The same platform behaviour
    // the README already records for defaults, in the other direction.
    //
    // Nothing runs it: an image deploy has no build step, which the deploys
    // demonstrate by completing in seconds with no builder. It is here so the
    // file agrees with what Railway stores.
    build: { builder: 'DOCKERFILE' as const, dockerfilePath: 'apps/web/Dockerfile' },
    replicas: { [REGION]: 1 },
    // Only the retry count is declared. The restart policy itself is already
    // the platform default, and a value equal to the default is accepted but
    // never stored — declaring it here would show as permanent plan drift.
    deploy: { restartPolicyMaxRetries: 3 },
  }

  // The always-warm pooled tier. Serves every workspace hostname on the wildcard
  // domain; holds no timers and no session connections, so between requests it
  // is silent and every workspace compute it touched can suspend.
  const web = service('quackback', {
    ...appBuild,
    // Live store is 4, not the shared appBuild 3. Declaring 3 here would
    // redeploy web on the next apply for a number that is not this change.
    deploy: { restartPolicyMaxRetries: 4 },
    healthcheckPath: '/api/health/ready',
    healthcheckTimeout: 300,
    env: {
      ...fleetEnv,
      QUACKBACK_ROLE: 'web',
      // Live on web + worker only. Do not hoist into fleetEnv: preserve()
      // cannot bootstrap a value onto cron/migrator, which do not hold it.
      QUACKBACK_CONTROL_PLANE_URL: preserve(),
      // Web-only: the public /api/storage proxy. Worker never serves it.
      S3_PROXY: preserve(),
    },
  })

  // The conductor (§1.3): one always-warm tier running the relay for every
  // workspace on **direct, session-mode** connections. No public domain — nothing
  // routes user traffic here.
  const worker = service('quackback-worker', {
    ...appBuild,
    deploy: { restartPolicyMaxRetries: 7 },
    healthcheckPath: '/api/health/ready',
    healthcheckTimeout: 300,
    env: {
      ...fleetEnv,
      QUACKBACK_ROLE: 'worker',
      QUACKBACK_CONTROL_PLANE_URL: preserve(),
    },
  })

  // The schema step of a rollout (§10.3), and the first half of §10.8's deploy
  // gate. It claims the workspaces sitting behind their target version, migrates
  // each on its **direct** endpoint, verifies the postconditions, and exits: 0
  // if every claimed workspace reconciled, 1 if any failed, which is what tells
  // a rollout to halt rather than deploy over a half-migrated fleet.
  //
  // **The schedule is not the trigger.** A pass only touches a workspace whose
  // recorded version is below its target, and a target only moves when an
  // operator moves it, so an idle pass costs one control-database query and
  // changes nothing. Migration stays a deliberate act; this is what converges
  // the stragglers afterwards — a workspace whose compute was unreachable during
  // the triggered run is otherwise never looked at again. Daily, because the
  // cost of a pass is a control-plane wake, and the same reasoning that keeps
  // the sweeps off a five-minute timer applies here.
  //
  // `startCommand` overrides the image entrypoint, which starts a server. This
  // role is a command: `fleet-migrator.mjs` is bundled into the same image (see
  // APP_IMAGE), so the build that owns these migrations is the build that
  // applies them, by construction rather than by scheduling.
  //
  // `enrol` before `run`, because a workspace with no intent row is invisible:
  // `run` claims from `cp_workspace_schema_state` and provisioning does not
  // write it, so a workspace created after the last enrolment would never be
  // looked at again. The migrator has a name for this and calls it a real gap
  // (`explainUnclaimed`'s `no_intent_row`). Enrolling is idempotent
  // (`ON CONFLICT DO NOTHING`), covers only registry-`active` workspaces, and
  // seeds `current_version` NULL rather than assuming the workspace is current —
  // so the new row is genuinely reconciled rather than asserted. It seeds the
  // target at THIS image's bundle tip, which under one pinned digest is exactly
  // the version the serving tier is on.
  //
  // Chained with `&&` so a failed enrolment stops the run instead of quietly
  // reconciling a fleet it could not enumerate. `sh -c` because the platform
  // does not expand a bare shell operator.
  const migrator = service('quackback-migrator', {
    ...appBuild,
    deploy: {
      restartPolicyType: 'NEVER',
      cronSchedule: '47 2 * * *',
      startCommand: 'sh -c "bun /app/fleet-migrator.mjs enrol && bun /app/fleet-migrator.mjs run"',
    },
    env: { ...fleetEnv, QUACKBACK_ROLE: 'migrator' },
  })

  // The scheduled sweeps, as `deploy.cronSchedule` services that run and exit.
  // They are not on the worker's timers because every sweep fans out across the
  // whole fleet: a 5-minute reconciler means every suspended compute is woken
  // every 5 minutes, against a 300 s suspend timeout. See `cron/fleet-jobs.ts`.
  const cronDaily = service('quackback-cron-daily', {
    ...appBuild,
    // `restartPolicyType: NEVER` is what Railway itself stores for a cron
    // service, and it is right: a failed sweep must wait for the next slot, not
    // restart-loop against a fleet of workspace databases. `restartPolicyMaxRetries`
    // is dropped here for the same reason — it means nothing under NEVER, and
    // declaring it produced permanent plan drift.
    deploy: { restartPolicyType: 'NEVER', cronSchedule: '17 3 * * *' },
    env: { ...fleetEnv, QUACKBACK_ROLE: 'worker', QUACKBACK_CRON_JOB: 'daily' },
  })

  // One housekeeping job: hourly sweeps, a 23 h daily cycle, then migrator
  // convergence. cron-daily and quackback-migrator stay declared so `plan`
  // does not propose destroying them; deleting those services is stop-and-ask
  // after a green housekeeping run history.
  const cronHourly = service('quackback-cron-hourly', {
    ...appBuild,
    deploy: { restartPolicyType: 'NEVER', cronSchedule: '0 * * * *' },
    env: { ...fleetEnv, QUACKBACK_ROLE: 'worker', QUACKBACK_CRON_JOB: 'housekeeping' },
  })

  // The control plane. Built from the OTHER repository and deployed by uploading
  // its source, so this file cannot describe how to build it — `empty()` says
  // "this service exists and its source is managed elsewhere" rather than
  // claiming a build that would be wrong.
  //
  // It is declared for one reason: without it, `railway config plan` proposed
  // "Delete service quackback-control-plane", and the file that exists to make
  // infrastructure reproducible was instead the thing that would remove it.
  // Its variables are all secrets or cross-repo values, so every one is
  // preserved.
  const controlPlane = service('quackback-control-plane', {
    // No `source`. Not an omission: this service's source is an upload from the
    // other repository, which this file cannot describe, and setting `empty()`
    // here made the plan propose CHANGING source.type — the file editing the
    // thing it exists to leave alone. Omitting it leaves the source unmanaged.
    //
    // Every variable is preserved rather than declared, because every one is a
    // secret, a cross-repo value, or set by the platform. Declaring the names is
    // still necessary: undeclared, each was on the delete list.
    env: {
      ADMIN_API_TOKEN: preserve(),
      // The admin MCP's own bearer credential, deliberately separate from
      // ADMIN_API_TOKEN so revoking agent access does not revoke the admin API.
      ADMIN_MCP_TOKEN: preserve(),
      ADMIN_EMAILS: preserve(),
      BASE_URL: preserve(),
      BETTER_AUTH_SECRET: preserve(),
      BILLING_PROJECTION_PRIVATE_KEY: preserve(),
      CLOUDFLARE_ACCOUNT_ID: preserve(),
      CLOUDFLARE_API_TOKEN: preserve(),
      // The queue carrying outbound delivery events, and the credential that
      // pulls from it. Read AND write, because acking a message mutates the
      // queue, so a read-only consumer would hold every event until its
      // visibility timeout and then see it again.
      CLOUDFLARE_EMAIL_EVENTS_QUEUE_ID: preserve(),
      CLOUDFLARE_EMAIL_TOKEN: preserve(),
      CLOUDFLARE_QUEUES_TOKEN: preserve(),
      CLOUDFLARE_SAAS_CNAME_TARGET: preserve(),
      CLOUDFLARE_SAAS_FALLBACK_ORIGIN: preserve(),
      CLOUDFLARE_SAAS_WORKER_SCRIPT: preserve(),
      CLOUDFLARE_ZONE_ID: preserve(),
      CLUSTER_ENV: preserve(),
      CP_ROLE: preserve(),
      EMAIL_FROM: preserve(),
      DATABASE_URL: preserve(),
      NEON_API_KEY: preserve(),
      NEON_ORG_ID: preserve(),
      NEON_PROJECT_PREFIX: preserve(),
      NEON_REGION_ID: preserve(),
      NODE_ENV: preserve(),
      PORT: preserve(),
      // Shared with the inbound Email Worker, which presents it to resolve a
      // mail slug to the hostname that serves it. Deliberately its own
      // credential: the per-instance token model binds a caller to one
      // workspace, and this caller legitimately speaks for all of them.
      MAIL_ROUTER_TOKEN: preserve(),
      PROVISIONER_SECRET: preserve(),
      QUACKBACK_BASE_DOMAIN: preserve(),
      QUACKBACK_FLEET_ROOT_KEY: preserve(),
      // The one bucket every workspace shares, and the credential that writes
      // to it. Isolation lives in the key prefix, not in a per-workspace
      // credential, so these are fleet-wide by design. Named apart from the
      // SDK's own default-chain names so an unrelated credential in the
      // environment cannot read as "storage is configured".
      QUACKBACK_FLEET_STORAGE_ACCESS_KEY_ID: preserve(),
      QUACKBACK_FLEET_STORAGE_BUCKET: preserve(),
      QUACKBACK_FLEET_STORAGE_ENDPOINT: preserve(),
      QUACKBACK_FLEET_STORAGE_FORCE_PATH_STYLE: preserve(),
      QUACKBACK_FLEET_STORAGE_REGION: preserve(),
      QUACKBACK_FLEET_STORAGE_SECRET_ACCESS_KEY: preserve(),
      QUACKBACK_MIGRATOR_COMMAND: preserve(),
      QUACKBACK_MIGRATOR_TIMEOUT_MS: preserve(),
      RAILWAY_DOCKERFILE_PATH: preserve(),
      REDIS_URL: preserve(),
      // Outbound mail. Named apart from the object-storage credentials above
      // and from the SDK's own default-chain names, because either collision
      // would let an unrelated credential in the environment read as "mail is
      // configured" and take the transport off its logged fallback.
      // Secrets, so they are set out of band; `preserve()` cannot bootstrap a
      // value the platform does not already hold.
      SES_REGION: preserve(),
      SES_ACCESS_KEY_ID: preserve(),
      SES_SECRET_ACCESS_KEY: preserve(),
      // Names the set SES publishes delivery events against.
      SES_CONFIGURATION_SET: preserve(),
      // Where those events arrive. The sweep pulls bounces and complaints from
      // here into the suppression list, so losing this name stops the fleet
      // learning that an address is undeliverable.
      SES_EVENTS_QUEUE_URL: preserve(),
      STRIPE_PUBLISHABLE_KEY: preserve(),
      STRIPE_SECRET_KEY: preserve(),
      STRIPE_WEBHOOK_SECRET: preserve(),
    },
  })

  // Retained, not used. The app removed its Redis dependency, but the database
  // still exists and deleting it is a decision rather than a consequence.
  const cache = redis('Redis')

  return project('quackback-pooled-gauntlet', {
    resources: [web, worker, migrator, cronDaily, cronHourly, controlPlane, cache, uploads],
  })
})
