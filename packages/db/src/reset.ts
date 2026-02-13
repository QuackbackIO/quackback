/**
 * Reset script for development.
 * Recreates Docker containers with fresh volumes.
 *
 * WARNING: This will delete all data!
 *
 * Usage: bun run reset
 */
import { $ } from 'bun'

async function waitForContainer(containerName: string, timeoutSeconds = 60) {
  console.log(`Waiting for ${containerName} container to start...`)
  for (let i = 0; i < timeoutSeconds * 2; i++) {
    const result = await $`docker inspect --format='{{.State.Status}}' ${containerName}`
      .quiet()
      .nothrow()
    const status = result.stdout.toString().trim()

    if (status === 'running') {
      return true
    }

    if (i > 0 && i % 10 === 0) {
      console.log(
        `  Still waiting for container to start... (${i / 2}s, status: ${status || 'not found'})`
      )
    }
    await Bun.sleep(500)
  }
  return false
}

async function waitForHealthy(containerName: string, timeoutSeconds = 90) {
  console.log(`Waiting for ${containerName} to be healthy...`)
  for (let i = 0; i < timeoutSeconds * 2; i++) {
    const result = await $`docker inspect --format='{{.State.Health.Status}}' ${containerName}`
      .quiet()
      .nothrow()
    const status = result.stdout.toString().trim()

    if (status === 'healthy') {
      return true
    }

    // Show progress every 5 seconds
    if (i > 0 && i % 10 === 0) {
      console.log(`  Still waiting... (${i / 2}s, health status: ${status || 'unknown'})`)
    }
    await Bun.sleep(500)
  }
  return false
}

async function testPostgresConnection(maxAttempts = 30) {
  console.log('Testing direct PostgreSQL connection...')
  for (let i = 0; i < maxAttempts; i++) {
    const result = await $`docker exec quackback-db pg_isready -U postgres`.quiet().nothrow()

    if (result.exitCode === 0) {
      console.log('  PostgreSQL is accepting connections!')
      return true
    }

    if (i > 0 && i % 10 === 0) {
      console.log(`  Still testing connection... (${i / 2}s)`)
    }
    await Bun.sleep(500)
  }
  return false
}

async function reset() {
  console.log('Resetting all services...\n')
  console.log('WARNING: This will delete all data!\n')

  // Stop and remove containers and volumes
  console.log('Stopping and removing containers and volumes...')
  await $`docker compose down --remove-orphans --volumes`.quiet().nothrow()

  // Force remove containers if they still exist
  await $`docker rm -f quackback-db quackback-minio quackback-dragonfly`.quiet().nothrow()

  // Wait for ports to be released
  console.log('Waiting for ports to be released...')
  await Bun.sleep(2000)

  // Clear any other containers occupying our ports
  for (const port of [5432, 9000, 9001, 6379]) {
    const result = await $`docker ps --format '{{.ID}} {{.Names}}' --filter publish=${port}`
      .quiet()
      .nothrow()
    const lines = result.stdout.toString().trim()
    if (lines) {
      for (const line of lines.split('\n')) {
        const [id, name] = line.split(' ')
        if (name && !name.startsWith('quackback-')) {
          console.log(`  Stopping ${name} (port ${port})...`)
          await $`docker stop ${id}`.quiet().nothrow()
        }
      }
    }
  }

  // Recreate all containers
  console.log('Starting fresh containers...')
  await $`docker compose up -d postgres minio minio-init dragonfly`

  // Give containers a moment to initialize
  console.log('Waiting for containers to initialize...')
  await Bun.sleep(2000)

  // Wait for postgres container to be running
  if (!(await waitForContainer('quackback-db', 30))) {
    console.error('\n❌ PostgreSQL container failed to start')
    console.error('Check container status: docker ps -a')
    console.error('Check container logs: docker compose logs postgres')
    process.exit(1)
  }

  // Wait for postgres to be healthy (with longer timeout for fresh volumes)
  const postgresHealthy = await waitForHealthy('quackback-db', 90)

  if (!postgresHealthy) {
    console.log('\n⚠️  Health check timeout, trying direct connection test...')
    const canConnect = await testPostgresConnection(30)

    if (!canConnect) {
      console.error('\n❌ PostgreSQL did not become ready in time')
      console.error('\nDiagnostics:')
      console.error('  1. Check container logs: docker compose logs postgres')
      console.error('  2. Check container status: docker ps -a')
      console.error('  3. Try manual start: docker compose up postgres')
      console.error('  4. Check disk space: df -h')
      process.exit(1)
    }
    console.log('✓ PostgreSQL is ready (via direct connection test)')
  } else {
    console.log('✓ PostgreSQL is ready')
  }

  // Wait for MinIO
  if (!(await waitForHealthy('quackback-minio', 60))) {
    console.error('\n❌ MinIO did not become healthy in time')
    process.exit(1)
  }
  console.log('✓ MinIO is ready')

  // Wait for Dragonfly
  if (!(await waitForHealthy('quackback-dragonfly', 30))) {
    console.error('\n❌ Dragonfly did not become healthy in time')
    process.exit(1)
  }
  console.log('✓ Dragonfly is ready')

  console.log('\n✅ Reset complete!')
  console.log('')
  console.log('Next steps:')
  console.log('  1. Run migrations:  bun run db:migrate')
  console.log('  2. Seed data:       bun run db:seed')
  console.log('')
}

reset().catch((error) => {
  console.error('\n❌ Reset failed:', error)
  process.exitCode = 1
})
