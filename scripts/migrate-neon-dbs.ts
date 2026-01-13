#!/usr/bin/env bun
/**
 * Migrate all Neon tenant databases
 *
 * Usage: NEON_API_KEY=xxx bun scripts/migrate-neon-dbs.ts
 *
 * Fetches all projects from Neon API and runs migrations on each.
 * Excludes the catalog database by default.
 */

import { $ } from 'bun'

const NEON_API_KEY = process.env.NEON_API_KEY
if (!NEON_API_KEY) {
  console.error('❌ NEON_API_KEY environment variable is required')
  process.exit(1)
}

const EXCLUDED_PROJECTS = ['catalog']
const CONCURRENCY = 5
const TIMEOUT_MS = 60000

interface NeonProject {
  id: string
  name: string
}

interface NeonProjectsResponse {
  projects: NeonProject[]
}

interface NeonConnectionUriResponse {
  uri: string
}

async function fetchProjects(): Promise<NeonProject[]> {
  const result =
    await $`curl -s -H "Authorization: Bearer ${NEON_API_KEY}" "https://console.neon.tech/api/v2/projects?limit=100"`.text()
  const data = JSON.parse(result) as NeonProjectsResponse
  return data.projects.filter((p) => !EXCLUDED_PROJECTS.includes(p.name))
}

async function getConnectionUri(projectId: string): Promise<string> {
  const result =
    await $`curl -s -H "Authorization: Bearer ${NEON_API_KEY}" "https://console.neon.tech/api/v2/projects/${projectId}/connection_uri?database_name=neondb&role_name=neondb_owner"`.text()
  const data = JSON.parse(result) as NeonConnectionUriResponse
  return data.uri
}

async function runMigration(uri: string): Promise<boolean> {
  try {
    const proc = Bun.spawn(['bun', 'run', '--cwd', 'packages/db', 'db:migrate'], {
      env: { ...process.env, DATABASE_URL: uri },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const timeout = setTimeout(() => proc.kill(), TIMEOUT_MS)
    const exitCode = await proc.exited
    clearTimeout(timeout)
    return exitCode === 0
  } catch {
    return false
  }
}

async function migrateProject(project: NeonProject): Promise<{ name: string; success: boolean }> {
  try {
    const uri = await getConnectionUri(project.id)
    const success = await runMigration(uri)
    return { name: project.name, success }
  } catch {
    return { name: project.name, success: false }
  }
}

async function main() {
  console.log('🔍 Fetching Neon projects...')
  const projects = await fetchProjects()
  console.log(`Found ${projects.length} projects (excluding: ${EXCLUDED_PROJECTS.join(', ')})`)
  console.log(`Running ${CONCURRENCY} migrations in parallel...\n`)

  const results: { name: string; success: boolean }[] = []

  for (let i = 0; i < projects.length; i += CONCURRENCY) {
    const batch = projects.slice(i, i + CONCURRENCY)
    const batchResults = await Promise.all(
      batch.map(async (project) => {
        const result = await migrateProject(project)
        console.log(`${result.success ? '✅' : '❌'} ${result.name}`)
        return result
      })
    )
    results.push(...batchResults)
  }

  console.log('\n--- Summary ---')
  const succeeded = results.filter((r) => r.success).length
  const failed = results.filter((r) => !r.success).length
  console.log(`✅ Succeeded: ${succeeded}`)
  console.log(`❌ Failed: ${failed}`)

  if (failed > 0) {
    console.log('\nFailed databases:')
    results.filter((r) => !r.success).forEach((r) => console.log(`  - ${r.name}`))
  }
}

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
