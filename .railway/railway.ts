/**
 * Railway project skeleton for a single Quackback deployment.
 *
 * Scope: the fleet skeleton only — the app service, the Redis it still needs,
 * and the object-storage bucket. Anything that varies per workspace (database
 * URLs, secrets, storage credentials) stays out of source and is preserved from
 * the live environment.
 *
 * Postgres is deliberately absent: the database is external (Neon), reached
 * through its pooled endpoint at runtime and its direct endpoint for schema
 * work. See DIRECT_DATABASE_URL below.
 */
import { bucket, defineRailway, preserve, project, redis, service } from 'railway/iac'

export default defineRailway(() => {
  // BullMQ still requires Redis. config.ts mandates redisUrl and the readiness
  // probe pings it, so this service is not optional today.
  const cache = redis('Redis')

  const uploads = bucket('quackback-gauntlet', { region: 'iad' })

  const web = service('quackback', {
    // The repo Dockerfile builds the widget bundle, the TanStack Start server
    // and a standalone migration bundle. Railpack cannot reproduce that.
    build: { builder: 'DOCKERFILE', dockerfilePath: 'apps/web/Dockerfile' },

    // Virginia, same metro as the Neon us-east-1 project. An SSR render issues
    // many sequential queries, so the pairing is load-bearing.
    replicas: { 'us-east4-eqdc4a': 1 },

    healthcheckPath: '/api/health/ready',
    healthcheckTimeout: 300,

    // Schema work runs once per deploy on the direct endpoint: the migrator
    // takes a session-level advisory lock and issues CREATE INDEX CONCURRENTLY,
    // neither of which survives a transaction-mode pooler.
    //
    // One shell string, not an argv array — the platform rejects argv form, and
    // without the explicit `sh -c` the variable substitution is not expanded.
    preDeployCommand: ['sh -c \'DATABASE_URL="$DIRECT_DATABASE_URL" bun /app/migrate.mjs\''],

    // Only the retry count is declared. The restart policy itself is already
    // the platform default, and a value equal to the default is accepted but
    // never stored — declaring it here would show as permanent plan drift.
    deploy: { restartPolicyMaxRetries: 3 },

    env: {
      NODE_ENV: 'production',
      PORT: '3000',
      RAILWAY_DOCKERFILE_PATH: 'apps/web/Dockerfile',
      // The entrypoint would otherwise migrate on every boot against the
      // pooled endpoint; preDeployCommand owns that step instead.
      SKIP_MIGRATIONS: 'true',

      REDIS_URL: cache.env.REDIS_URL,

      // Railway buckets are private-only, so S3_PUBLIC_URL stays unset and
      // every asset is served through the app's /api/storage proxy.
      S3_ENDPOINT: preserve(),
      S3_BUCKET: preserve(),
      S3_REGION: preserve(),
      S3_ACCESS_KEY_ID: preserve(),
      S3_SECRET_ACCESS_KEY: preserve(),
      S3_FORCE_PATH_STYLE: 'false',

      BASE_URL: preserve(),
      DATABASE_URL: preserve(),
      DIRECT_DATABASE_URL: preserve(),
      SECRET_KEY: preserve(),
    },
  })

  return project('quackback-pooled-gauntlet', {
    resources: [web, cache, uploads],
  })
})
