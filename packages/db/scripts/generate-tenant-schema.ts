#!/usr/bin/env bun
/**
 * Generate Tenant Schema SQL
 *
 * Generates a single SQL file containing the complete tenant database schema.
 * This file can be used by external services (like the website repo) to
 * provision new tenant databases.
 *
 * The output includes:
 * 1. Migration tracking table (drizzle.__drizzle_migrations)
 * 2. All schema DDL from migrations
 * 3. Migration records (so drizzle-kit knows schema is up to date)
 *
 * Usage: bun packages/db/scripts/generate-tenant-schema.ts
 *
 * Output: packages/db/dist/tenant-schema.sql
 */

import fs from 'fs'
import path from 'path'
import { MIGRATIONS, parseStatements, SCHEMA_VERSION } from '../src/init-sql.generated'

const OUTPUT_DIR = path.join(import.meta.dirname, '../dist')
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'tenant-schema.sql')

function main() {
  // Ensure dist directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true })
  }

  console.log(`Generating tenant schema SQL...`)
  console.log(`  Migrations: ${MIGRATIONS.length}`)
  console.log(`  Schema version: ${SCHEMA_VERSION}`)

  // Count total statements
  let totalStatements = 0
  for (const migration of MIGRATIONS) {
    totalStatements += parseStatements(migration.sql).length
  }

  // Build the SQL file
  const lines: string[] = []

  // Header
  lines.push(`-- ===========================================`)
  lines.push(`-- Quackback Tenant Database Schema`)
  lines.push(`-- Generated: ${new Date().toISOString()}`)
  lines.push(`-- Schema Version: ${SCHEMA_VERSION}`)
  lines.push(`-- Migrations: ${MIGRATIONS.length}`)
  lines.push(`-- Statements: ${totalStatements}`)
  lines.push(`-- ===========================================`)
  lines.push(``)

  // Migration tracking table
  lines.push(`-- Migration tracking table`)
  lines.push(`CREATE SCHEMA IF NOT EXISTS drizzle;`)
  lines.push(``)
  lines.push(`CREATE TABLE IF NOT EXISTS drizzle."__drizzle_migrations" (`)
  lines.push(`  id SERIAL PRIMARY KEY,`)
  lines.push(`  hash text NOT NULL,`)
  lines.push(`  created_at bigint`)
  lines.push(`);`)
  lines.push(``)

  // All schema statements from migrations
  lines.push(`-- ===========================================`)
  lines.push(`-- Schema DDL (${totalStatements} statements)`)
  lines.push(`-- ===========================================`)
  lines.push(``)

  for (const migration of MIGRATIONS) {
    lines.push(`-- Migration: ${migration.tag}`)
    const statements = parseStatements(migration.sql)
    for (const statement of statements) {
      lines.push(statement)
      // Ensure statement ends with semicolon
      if (!statement.trim().endsWith(';')) {
        lines.push(`;`)
      }
      lines.push(``)
    }
  }

  // Migration records
  lines.push(`-- ===========================================`)
  lines.push(`-- Migration records`)
  lines.push(`-- ===========================================`)
  lines.push(``)

  for (const migration of MIGRATIONS) {
    lines.push(
      `INSERT INTO drizzle."__drizzle_migrations" (hash, created_at) VALUES ('${migration.tag}', ${migration.when});`
    )
  }

  lines.push(``)
  lines.push(`-- Schema generation complete`)

  // Write output
  const output = lines.join('\n')
  fs.writeFileSync(OUTPUT_FILE, output)

  console.log(``)
  console.log(`Generated ${OUTPUT_FILE}`)
  console.log(`  File size: ${(output.length / 1024).toFixed(1)} KB`)
}

main()
