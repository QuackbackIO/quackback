/**
 * Reset script for development.
 * Recreates Docker containers with fresh volumes.
 *
 * WARNING: This will delete all data!
 *
 * Usage: bun run reset
 */
import { $ } from 'bun'

async function reset() {
  console.log('Resetting all services...\n')
  console.log('WARNING: This will delete all data!\n')

  // Stop and remove containers
  console.log('Stopping containers...')
  await $`docker compose stop postgres dragonfly`.quiet()
  await $`docker compose rm -f postgres dragonfly`.quiet()

  // Remove volumes (Docker prefixes with project directory name)
  console.log('Removing volumes...')
  await $`docker volume rm quackback_postgres_data`.quiet().nothrow()
  await $`docker volume rm quackback_dragonfly_data`.quiet().nothrow()

  // Recreate containers
  console.log('Starting fresh containers...')
  await $`docker compose up -d postgres dragonfly`

  // Wait for postgres to be ready using Docker healthcheck
  console.log('Waiting for PostgreSQL to be ready...')
  let postgresReady = false
  for (let i = 0; i < 60; i++) {
    const result = await $`docker inspect --format='{{.State.Health.Status}}' quackback-db`
      .quiet()
      .nothrow()
    const status = result.stdout.toString().trim()
    if (status === 'healthy') {
      postgresReady = true
      break
    }
    // Show progress every 5 seconds
    if (i > 0 && i % 10 === 0) {
      console.log(`  Still waiting... (${i / 2}s, status: ${status})`)
    }
    await Bun.sleep(500)
  }

  if (!postgresReady) {
    console.error('PostgreSQL did not become healthy in time')
    console.error('Check container logs: docker compose logs postgres')
    process.exit(1)
  }

  // Wait for dragonfly to be ready using Docker healthcheck
  console.log('Waiting for Dragonfly to be ready...')
  let dragonflyReady = false
  for (let i = 0; i < 30; i++) {
    const result = await $`docker inspect --format='{{.State.Health.Status}}' quackback-dragonfly`
      .quiet()
      .nothrow()
    const status = result.stdout.toString().trim()
    if (status === 'healthy') {
      dragonflyReady = true
      break
    }
    await Bun.sleep(500)
  }

  if (!dragonflyReady) {
    console.error('Dragonfly did not become healthy in time')
    process.exit(1)
  }

  console.log('\nReset complete!')
  console.log('')
  console.log('Next steps:')
  console.log('  1. Run migrations:  bun run db:migrate')
  console.log('  2. Seed data:       bun run db:seed')
  console.log('')
}

reset().catch((error) => {
  console.error('Reset failed:', error)
  process.exitCode = 1
})
