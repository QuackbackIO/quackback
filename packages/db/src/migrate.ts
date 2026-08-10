import { config } from 'dotenv'
config({ path: '../../.env', quiet: true })

import path from 'path'
import { fileURLToPath } from 'url'
import { runMigrations } from './migrate-runtime'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

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

  const result = await runMigrations(connectionString, {
    migrationsFolder,
    requireSessionMode: false,
    onStep: (step) => {
      if (step === 'lock') console.log('🔒 Waiting for migration lock...')
      if (step === 'extensions') console.log('🔓 Acquired migration lock')
    },
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

main().catch((error) => {
  console.error('❌ Migration failed:', error)
  process.exit(1)
})
