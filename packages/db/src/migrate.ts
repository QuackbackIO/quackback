import { config } from 'dotenv'
config({ path: '../../.env', quiet: true })

import path from 'path'
import { fileURLToPath } from 'url'
import {
  DEFAULT_MIGRATE_LOCK_TIMEOUT_MS,
  isLockTimeoutError,
  MigrationPreflightError,
  runMigrations,
} from './migrate-runtime'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/** Pending migrations at or above which the "do not interrupt" notice is printed. */
const MANY_PENDING = 20

function formatDuration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`
}

/**
 * The CLI entrypoint. `docker-entrypoint.sh` runs this at boot, and the control
 * plane's provisioning path shells out to it.
 *
 * It is deliberately a thin wrapper over {@link runMigrations} rather than a
 * second implementation. The extension creation, the invalid-index heal, the
 * concurrent index build and the post-condition sweep all used to live here as
 * private code, which is exactly why a migrator role could not reuse them:
 * importing this file to reach them ran migrations as a side effect. One
 * executor, two entrypoints.
 *
 * It waits for a table lock no longer than the fleet migrator does
 * ({@link DEFAULT_MIGRATE_LOCK_TIMEOUT_MS}). A long query or an open transaction
 * holding a table a migration alters stops this start with a lock timeout
 * instead of holding it; the lineage is one transaction, so nothing changed, and
 * the next start tries again.
 *
 * Two deliberate differences from the fleet migrator role:
 *
 * - **Session-mode is not enforced here.** This CLI has always run against
 *   whatever `DATABASE_URL` names, including a self-hosted install behind a
 *   connection pooler. Refusing that at boot would turn a working deployment
 *   into a crash loop over a property it has been getting away with for years.
 *   The fleet migrator does enforce it, because there the direct endpoint is a
 *   field on the workspace record and there is no excuse for using the other one.
 * - **A post-condition violation is loud but not fatal.** This process's job is
 *   to make the database servable, and an absent HNSW index makes a workspace slow,
 *   not broken; exiting non-zero would refuse to boot over a performance
 *   regression. The reconciler treats the same violation as a failed reconcile,
 *   because there it has somewhere to record it and something else to try.
 */
async function main() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is required')
  }

  // Allow overriding migrations folder via env var (for Docker); default to
  // ./drizzle relative to this script.
  const migrationsFolder = process.env.MIGRATIONS_FOLDER || path.resolve(__dirname, '../drizzle')

  console.log('🔄 Running migrations...')
  console.log(`   Migrations folder: ${migrationsFolder}`)

  let migrateStartedAt = 0
  // The migration running inside the transaction, so a failure can name it.
  let currentMigration: string | null = null
  const result = await runMigrations(connectionString, {
    migrationsFolder,
    requireSessionMode: false,
    lockTimeoutMs: DEFAULT_MIGRATE_LOCK_TIMEOUT_MS,
    onStep: (step) => {
      if (step === 'lock') console.log('🔒 Waiting for migration lock...')
      if (step === 'requirements') console.log('🔓 Acquired migration lock')
      if (step === 'concurrent-indexes' && migrateStartedAt > 0) {
        console.log(
          `   Migrations committed in ${formatDuration(performance.now() - migrateStartedAt)}`
        )
      }
    },
    onPending: ({ tags }) => {
      if (tags.length === 0) {
        console.log('   Database schema is up to date')
        return
      }
      console.log(`   ${tags.length} pending migration(s): ${tags[0]} .. ${tags[tags.length - 1]}`)
      if (tags.length >= MANY_PENDING) {
        console.log(
          '⏳ This can take several minutes on a large database (usually the first start after ' +
            'an upgrade). Do not stop or restart the container until it finishes: the migrations run in one ' +
            'transaction, and an interrupted run rolls back and starts over.'
        )
      }
      migrateStartedAt = performance.now()
    },
    onIndexBuild: (event) => {
      if (event.phase === 'start') {
        console.log(
          `🔄 ${event.reason === 'invalid' ? 'Rebuilding invalid' : 'Building'} index ` +
            `${event.name} (can take a while on a large database)...`
        )
      } else {
        console.log(`   Built ${event.name} in ${formatDuration(event.durationMs ?? 0)}`)
      }
    },
    onMigration: (event) => {
      if (event.phase === 'start') {
        currentMigration = event.tag
        return
      }
      currentMigration = null
      console.log(
        `   [${event.index}/${event.total}] ${event.tag} (${formatDuration(event.durationMs ?? 0)})`
      )
    },
  }).catch((error: unknown) => {
    if (currentMigration) {
      console.error(
        `❌ Migration ${currentMigration} failed; every migration in this run was rolled back.`
      )
    }
    if (isLockTimeoutError(error)) {
      throw new MigrationLockTimeout(currentMigration)
    }
    throw error
  })

  if (result.healed.length > 0) {
    console.log(
      `🩹 Dropped ${result.healed.length} invalid index(es) before rebuilding: ` +
        result.healed.map((i) => i.name).join(', ')
    )
  }
  for (const idx of result.unhealable) {
    console.error(
      `⚠️  ${idx.schema}.${idx.name} is INVALID and owned by a constraint; DROP INDEX cannot ` +
        'remove it. Repair by hand (the usual cause is a failed ALTER TABLE ... ADD CONSTRAINT ... USING INDEX).'
    )
  }

  console.log('✅ Migrations completed successfully!')
  console.log('✅ Seeded system data (statuses, roles, permissions)')

  const post = result.postconditions
  if (post && !post.ok) {
    // Loud, and separate from the ledger. Every migration applied and the
    // database is still not right — which is precisely the state the ledger
    // cannot express.
    console.error('❌ POST-CONDITIONS VIOLATED (the migration ledger reads complete anyway):')
    for (const v of post.violations) console.error(`   [${v.kind}] ${v.detail}`)
  } else if (post) {
    // Listed rather than summarised, because a green verdict is only as good as
    // its scope and this line is where a reader forms a belief about what green
    // covered.
    console.log('✅ Post-conditions verified:')
    for (const check of post.covers) console.log(`   ${check}`)
  }
}

/** A migration waited longer than the lock timeout; worded for the operator. */
class MigrationLockTimeout extends Error {
  constructor(tag: string | null) {
    super(
      `${tag ? `Migration ${tag}` : 'A migration'} stopped on a lock timeout: it waited more than ` +
        `${DEFAULT_MIGRATE_LOCK_TIMEOUT_MS / 1000} s for a table that another session holds ` +
        '(a long query or an open transaction). Nothing was changed. Stop that session, or wait ' +
        'for it to finish, and start again.'
    )
    this.name = 'MigrationLockTimeout'
  }
}

main().catch((error) => {
  if (error instanceof MigrationPreflightError || error instanceof MigrationLockTimeout) {
    // Already worded for the operator; a stack trace would only bury it.
    console.error(`❌ ${error.message}`)
  } else {
    console.error('❌ Migration failed:', error)
  }
  process.exit(1)
})
