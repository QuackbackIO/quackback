#!/usr/bin/env bun
/**
 * Generate Init SQL for Tenant Provisioning
 *
 * Bundles all Drizzle migrations and seed data into a TypeScript file for runtime execution.
 * Required because Cloudflare Workers lack filesystem access.
 *
 * Usage: bun packages/db/scripts/generate-init-sql.ts
 * Output: packages/db/src/init-sql.generated.ts
 */

import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { DEFAULT_STATUSES } from '../src/schema/statuses'

const DRIZZLE_DIR = path.join(import.meta.dirname, '../drizzle')
const OUTPUT_FILE = path.join(import.meta.dirname, '../src/init-sql.generated.ts')

/**
 * Generate SQL INSERT statements for default statuses.
 * Uses gen_random_uuid() for IDs since they're generated at runtime.
 */
function generateSeedSQL(): string {
  const values = DEFAULT_STATUSES.map(
    (s) =>
      `(gen_random_uuid(), '${s.name}', '${s.slug}', '${s.color}', '${s.category}', ${s.position}, ${s.showOnRoadmap}, ${s.isDefault}, NOW())`
  ).join(',\n  ')

  return `INSERT INTO "post_statuses" ("id", "name", "slug", "color", "category", "position", "show_on_roadmap", "is_default", "created_at")
VALUES
  ${values};`
}

interface JournalEntry {
  when: number
  tag: string
}

interface Journal {
  entries: JournalEntry[]
}

function main(): void {
  const journalPath = path.join(DRIZZLE_DIR, 'meta/_journal.json')
  const journal: Journal = JSON.parse(fs.readFileSync(journalPath, 'utf-8'))

  console.log(`Found ${journal.entries.length} migrations in journal`)

  const migrations = journal.entries.map((entry) => {
    const sqlPath = path.join(DRIZZLE_DIR, `${entry.tag}.sql`)

    if (!fs.existsSync(sqlPath)) {
      console.error(`Migration file not found: ${sqlPath}`)
      process.exit(1)
    }

    const sql = fs.readFileSync(sqlPath, 'utf-8')
    const hash = crypto.createHash('sha256').update(sql).digest('hex')

    console.log(`  ${entry.tag} (${hash.slice(0, 8)}...)`)

    return { tag: entry.tag, when: entry.when, hash, sql }
  })

  // Generate TypeScript output
  const output = `/**
 * Auto-generated migration SQL for tenant provisioning
 *
 * DO NOT EDIT MANUALLY - regenerate with:
 *   bun packages/db/scripts/generate-init-sql.ts
 *
 * Generated: ${new Date().toISOString()}
 * Migrations: ${migrations.length}
 */

export interface Migration {
  /** Migration name/tag (e.g., "0000_initial") */
  tag: string
  /** Timestamp when migration was created */
  when: number
  /** SHA-256 hash of SQL content (for drizzle tracking) */
  hash: string
  /** Raw SQL content */
  sql: string
}

/**
 * All migrations in order, ready to be applied to a new tenant database.
 * Each migration's SQL may contain multiple statements separated by
 * '--> statement-breakpoint' markers.
 */
export const MIGRATIONS: Migration[] = ${JSON.stringify(migrations, null, 2)}

/**
 * Schema version identifier (tag of last migration)
 */
export const SCHEMA_VERSION = '${migrations[migrations.length - 1]?.tag ?? 'unknown'}'

/**
 * Parse a migration SQL into individual statements.
 * Splits on drizzle-kit's breakpoint marker and filters empty/comment-only blocks.
 */
export function parseStatements(sql: string): string[] {
  return sql
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter((s) => {
      if (s.length === 0) return false
      // Check if block contains any actual SQL (not just comments)
      const lines = s.split('\\n')
      return lines.some((line) => {
        const trimmed = line.trim()
        return trimmed.length > 0 && !trimmed.startsWith('--')
      })
    })
}

/**
 * SQL to create the drizzle migrations tracking table.
 * This must be run before recording migrations.
 */
export const CREATE_MIGRATIONS_TABLE_SQL = \`
CREATE SCHEMA IF NOT EXISTS drizzle;
CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
  id SERIAL PRIMARY KEY,
  hash TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
\`

/**
 * SQL to insert a migration record.
 * Use with parameterized query: (hash, created_at)
 */
export const INSERT_MIGRATION_SQL = \`
INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)
\`

/**
 * SQL to check which migrations have been applied.
 * Returns array of hashes.
 */
export const GET_APPLIED_MIGRATIONS_SQL = \`
SELECT hash FROM drizzle.__drizzle_migrations
\`

/**
 * Seed SQL for default post statuses.
 * Run after migrations to populate initial data.
 */
export const SEED_SQL = \`${generateSeedSQL()}\`
`

  fs.writeFileSync(OUTPUT_FILE, output)
  console.log(`\n✅ Generated ${OUTPUT_FILE}`)
  console.log(`   ${migrations.length} migrations bundled`)
  console.log(`   ${DEFAULT_STATUSES.length} default statuses`)
  console.log(`   Schema version: ${migrations[migrations.length - 1]?.tag}`)
}

main()
