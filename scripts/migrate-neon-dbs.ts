#!/usr/bin/env bun
/**
 * Migrate all Neon tenant databases
 *
 * Usage: bun scripts/migrate-neon-dbs.ts
 */

import { $ } from 'bun'

const NEON_API_KEY = process.env.CLOUD_NEON_API_KEY
if (!NEON_API_KEY) {
  console.error('CLOUD_NEON_API_KEY environment variable is required')
  process.exit(1)
}

const EXCLUDED_PROJECTS = ['catalog']
const CONCURRENCY = 5
const TIMEOUT_MS = 60000

interface NeonProject {
  id: string
  name: string
}

interface MigrationResult {
  name: string
  success: boolean
  error?: string
}

async function fetchProjects(): Promise<NeonProject[]> {
  const result =
    await $`curl -s -H "Authorization: Bearer ${NEON_API_KEY}" "https://console.neon.tech/api/v2/projects?limit=100"`.text()
  const data = JSON.parse(result) as { projects: NeonProject[] }
  return data.projects.filter((p) => !EXCLUDED_PROJECTS.includes(p.name))
}

async function getConnectionUri(projectId: string): Promise<string> {
  const result =
    await $`curl -s -H "Authorization: Bearer ${NEON_API_KEY}" "https://console.neon.tech/api/v2/projects/${projectId}/connection_uri?database_name=neondb&role_name=neondb_owner"`.text()
  return (JSON.parse(result) as { uri: string }).uri
}

async function runMigration(uri: string): Promise<{ success: boolean; error?: string }> {
  const proc = Bun.spawn(['bun', 'run', '--cwd', 'packages/db', 'db:migrate'], {
    env: { ...process.env, DATABASE_URL: uri },
    stdout: 'pipe',
    stderr: 'pipe',
  })

  const timeout = setTimeout(() => proc.kill(), TIMEOUT_MS)
  const exitCode = await proc.exited
  clearTimeout(timeout)

  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text()
    return { success: false, error: stderr.slice(0, 200) }
  }
  return { success: true }
}

async function migrateProject(project: NeonProject): Promise<MigrationResult> {
  try {
    const uri = await getConnectionUri(project.id)
    const result = await runMigration(uri)
    return { name: project.name, ...result }
  } catch (e) {
    return { name: project.name, success: false, error: String(e) }
  }
}

async function main(): Promise<void> {
  console.log('Fetching Neon projects...')
  const projects = await fetchProjects()
  console.log(`Found ${projects.length} projects (excluding: ${EXCLUDED_PROJECTS.join(', ')})`)
  console.log(`Running ${CONCURRENCY} migrations in parallel...\n`)

  const results: MigrationResult[] = []

  for (let i = 0; i < projects.length; i += CONCURRENCY) {
    const batch = projects.slice(i, i + CONCURRENCY)
    const batchResults = await Promise.all(
      batch.map(async (project) => {
        const result = await migrateProject(project)
        console.log(`${result.success ? 'OK' : 'FAIL'} ${result.name}`)
        return result
      })
    )
    results.push(...batchResults)
  }

  const succeeded = results.filter((r) => r.success).length
  const failed = results.filter((r) => !r.success)

  console.log(`\n--- Summary ---`)
  console.log(`Succeeded: ${succeeded}`)
  console.log(`Failed: ${failed.length}`)

  if (failed.length > 0) {
    console.log('\nFailed databases:')
    for (const r of failed) {
      console.log(`  - ${r.name}${r.error ? `: ${r.error}` : ''}`)
    }
    process.exit(1)
  }
}

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
