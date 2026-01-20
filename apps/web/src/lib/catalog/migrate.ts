/**
 * Catalog Database Migration Runner
 *
 * Runs SQL migrations against the catalog database.
 * Usage: bun apps/web/src/lib/catalog/migrate.ts
 */

import fs from 'fs/promises'
import path from 'path'
import postgres from 'postgres'

async function runCatalogMigrations() {
  const url = process.env.CLOUD_CATALOG_DATABASE_URL
  if (!url) {
    console.error('❌ CLOUD_CATALOG_DATABASE_URL is required')
    process.exit(1)
  }

  const sql = postgres(url)
  const migrationsDir = path.join(import.meta.dirname, 'migrations')

  console.log('📦 Running catalog database migrations...')

  try {
    // Get all migration files sorted by name
    const files = await fs.readdir(migrationsDir)
    const sqlFiles = files.filter((f) => f.endsWith('.sql')).sort()

    if (sqlFiles.length === 0) {
      console.log('No migration files found')
      return
    }

    for (const file of sqlFiles) {
      const filePath = path.join(migrationsDir, file)
      const migrationSql = await fs.readFile(filePath, 'utf-8')

      console.log(`  Running ${file}...`)

      // Split by statement breakpoint or execute as single
      const statements = migrationSql
        .split('--> statement-breakpoint')
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && !s.startsWith('--'))

      if (statements.length === 0) {
        // No breakpoints, run as single statement
        await sql.unsafe(migrationSql)
      } else {
        for (const statement of statements) {
          await sql.unsafe(statement)
        }
      }

      console.log(`  ✓ ${file}`)
    }

    console.log('✅ Catalog migrations complete')
  } catch (error) {
    console.error('❌ Migration failed:', error)
    process.exit(1)
  } finally {
    await sql.end()
  }
}

runCatalogMigrations()
