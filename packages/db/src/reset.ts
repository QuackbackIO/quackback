/**
 * Database reset script for development.
 * Recreates the Docker container with a fresh volume.
 *
 * WARNING: This will delete all data!
 *
 * Usage: bun run db:reset
 */
import { $ } from 'bun'

async function reset() {
  console.log('Resetting database...\n')
  console.log('WARNING: This will delete all data!\n')

  // Stop and remove the container
  console.log('Stopping container...')
  await $`docker compose stop postgres`.quiet()
  await $`docker compose rm -f postgres`.quiet()

  // Remove the volume
  console.log('Removing volume...')
  await $`docker volume rm quackback-v2_postgres_data`.quiet().nothrow()

  // Recreate the container
  console.log('Starting fresh container...')
  await $`docker compose up -d postgres`

  // Wait for postgres to be ready (able to accept connections)
  console.log('Waiting for PostgreSQL to be ready...')
  let ready = false
  for (let i = 0; i < 60; i++) {
    // Actually try to connect and run a query, not just pg_isready
    const result = await $`docker compose exec postgres psql -U postgres -d quackback -c "SELECT 1"`
      .quiet()
      .nothrow()
    if (result.exitCode === 0) {
      ready = true
      break
    }
    await Bun.sleep(500)
  }

  if (!ready) {
    console.error('PostgreSQL did not become ready in time')
    process.exit(1)
  }

  console.log('\nDatabase reset complete!')
  console.log('')
  console.log('Next steps:')
  console.log('  1. Push schema:  bun run db:push')
  console.log('  2. Seed data:    bun run db:seed')
  console.log('')
}

reset().catch((error) => {
  console.error('Reset failed:', error)
  process.exitCode = 1
})
