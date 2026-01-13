#!/usr/bin/env bun
/**
 * Migrate all Neon tenant databases
 *
 * Usage: NEON_API_KEY=xxx bun scripts/migrate-neon-dbs.ts
 *
 * Fetches all projects from Neon API and runs migrations on each.
 */

import { $ } from 'bun'

const NEON_API_KEY = process.env.NEON_API_KEY
if (!NEON_API_KEY) {
  console.error('❌ NEON_API_KEY environment variable is required')
  process.exit(1)
}

const NEON_API_BASE = 'https://console.neon.tech/api/v2'

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
  const response = await fetch(`${NEON_API_BASE}/projects`, {
    headers: { Authorization: `Bearer ${NEON_API_KEY}` },
  })
  if (!response.ok) {
    throw new Error(`Failed to fetch projects: ${response.statusText}`)
  }
  const data = (await response.json()) as NeonProjectsResponse
  return data.projects
}

async function getConnectionUri(projectId: string): Promise<string> {
  const response = await fetch(
    `${NEON_API_BASE}/projects/${projectId}/connection_uri?database_name=neondb&role_name=neondb_owner`,
    {
      headers: { Authorization: `Bearer ${NEON_API_KEY}` },
    }
  )
  if (!response.ok) {
    throw new Error(`Failed to get connection URI: ${response.statusText}`)
  }
  const data = (await response.json()) as NeonConnectionUriResponse
  return data.uri
}

async function runMigration(uri: string): Promise<boolean> {
  try {
    await $`DATABASE_URL=${uri} bun run --cwd packages/db db:migrate`.quiet()
    return true
  } catch {
    return false
  }
}

async function main() {
  console.log('🔍 Fetching Neon projects...')
  const projects = await fetchProjects()
  console.log(`Found ${projects.length} projects\n`)

  const results: { name: string; success: boolean }[] = []

  for (const project of projects) {
    process.stdout.write(`Migrating ${project.name} (${project.id})... `)

    try {
      const uri = await getConnectionUri(project.id)
      const success = await runMigration(uri)
      results.push({ name: project.name, success })
      console.log(success ? '✅' : '❌')
    } catch {
      results.push({ name: project.name, success: false })
      console.log('❌')
    }
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
