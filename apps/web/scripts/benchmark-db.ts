#!/usr/bin/env bun
/**
 * Database Connection Benchmark
 *
 * Tests latency of different connection methods to Neon PostgreSQL:
 * 1. Neon serverless HTTP driver (@neondatabase/serverless)
 * 2. postgres.js with direct connection
 *
 * Usage:
 *   bun run scripts/benchmark-db.ts
 *
 * Requires CLOUD_CATALOG_DATABASE_URL in environment
 */

import { neon } from '@neondatabase/serverless'
import { drizzle as drizzleNeonHttp } from 'drizzle-orm/neon-http'
import postgres from 'postgres'
import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js'
import { sql } from 'drizzle-orm'

const DATABASE_URL = process.env.CLOUD_CATALOG_DATABASE_URL

if (!DATABASE_URL) {
  console.error('❌ CLOUD_CATALOG_DATABASE_URL environment variable is required')
  process.exit(1)
}

const ITERATIONS = 10
const WARMUP_ITERATIONS = 2

interface BenchmarkResult {
  name: string
  coldStartMs: number
  avgMs: number
  minMs: number
  maxMs: number
  p50Ms: number
  p95Ms: number
}

function percentile(arr: number[], p: number): number {
  const sorted = [...arr].sort((a, b) => a - b)
  const idx = Math.ceil((p / 100) * sorted.length) - 1
  return sorted[Math.max(0, idx)]
}

async function benchmarkNeonHttp(): Promise<BenchmarkResult> {
  const times: number[] = []
  let coldStartMs = 0

  console.log('\n📊 Benchmarking Neon HTTP driver...')

  for (let i = 0; i < WARMUP_ITERATIONS + ITERATIONS; i++) {
    // Create fresh connection each time (simulates serverless cold start)
    const sqlClient = neon(DATABASE_URL!)
    const db = drizzleNeonHttp(sqlClient)

    const start = performance.now()
    await db.execute(sql`SELECT 1 as test`)
    const elapsed = performance.now() - start

    if (i < WARMUP_ITERATIONS) {
      if (i === 0) coldStartMs = elapsed
      process.stdout.write(`  Warmup ${i + 1}/${WARMUP_ITERATIONS}: ${elapsed.toFixed(1)}ms\n`)
    } else {
      times.push(elapsed)
      process.stdout.write(
        `  Run ${i - WARMUP_ITERATIONS + 1}/${ITERATIONS}: ${elapsed.toFixed(1)}ms\n`
      )
    }
  }

  return {
    name: 'Neon HTTP (@neondatabase/serverless)',
    coldStartMs,
    avgMs: times.reduce((a, b) => a + b, 0) / times.length,
    minMs: Math.min(...times),
    maxMs: Math.max(...times),
    p50Ms: percentile(times, 50),
    p95Ms: percentile(times, 95),
  }
}

async function benchmarkPostgresJs(): Promise<BenchmarkResult> {
  const times: number[] = []
  let coldStartMs = 0

  console.log('\n📊 Benchmarking postgres.js driver (new connection each query)...')

  for (let i = 0; i < WARMUP_ITERATIONS + ITERATIONS; i++) {
    // Create fresh connection each time (simulates serverless cold start)
    const sqlClient = postgres(DATABASE_URL!, {
      max: 1,
      fetch_types: false,
      idle_timeout: 0,
      connect_timeout: 30,
    })
    const db = drizzlePostgres(sqlClient)

    const start = performance.now()
    await db.execute(sql`SELECT 1 as test`)
    const elapsed = performance.now() - start

    // Close connection
    await sqlClient.end()

    if (i < WARMUP_ITERATIONS) {
      if (i === 0) coldStartMs = elapsed
      process.stdout.write(`  Warmup ${i + 1}/${WARMUP_ITERATIONS}: ${elapsed.toFixed(1)}ms\n`)
    } else {
      times.push(elapsed)
      process.stdout.write(
        `  Run ${i - WARMUP_ITERATIONS + 1}/${ITERATIONS}: ${elapsed.toFixed(1)}ms\n`
      )
    }
  }

  return {
    name: 'postgres.js (new conn each query)',
    coldStartMs,
    avgMs: times.reduce((a, b) => a + b, 0) / times.length,
    minMs: Math.min(...times),
    maxMs: Math.max(...times),
    p50Ms: percentile(times, 50),
    p95Ms: percentile(times, 95),
  }
}

async function benchmarkPostgresJsPooled(): Promise<BenchmarkResult> {
  const times: number[] = []
  let coldStartMs = 0

  console.log('\n📊 Benchmarking postgres.js driver (pooled/reused connection)...')

  // Create single pooled connection
  const sqlClient = postgres(DATABASE_URL!, {
    max: 5,
    fetch_types: false,
  })
  const db = drizzlePostgres(sqlClient)

  for (let i = 0; i < WARMUP_ITERATIONS + ITERATIONS; i++) {
    const start = performance.now()
    await db.execute(sql`SELECT 1 as test`)
    const elapsed = performance.now() - start

    if (i < WARMUP_ITERATIONS) {
      if (i === 0) coldStartMs = elapsed
      process.stdout.write(`  Warmup ${i + 1}/${WARMUP_ITERATIONS}: ${elapsed.toFixed(1)}ms\n`)
    } else {
      times.push(elapsed)
      process.stdout.write(
        `  Run ${i - WARMUP_ITERATIONS + 1}/${ITERATIONS}: ${elapsed.toFixed(1)}ms\n`
      )
    }
  }

  await sqlClient.end()

  return {
    name: 'postgres.js (pooled)',
    coldStartMs,
    avgMs: times.reduce((a, b) => a + b, 0) / times.length,
    minMs: Math.min(...times),
    maxMs: Math.max(...times),
    p50Ms: percentile(times, 50),
    p95Ms: percentile(times, 95),
  }
}

async function benchmarkRealisticQuery(): Promise<BenchmarkResult> {
  const times: number[] = []
  let coldStartMs = 0

  console.log('\n📊 Benchmarking realistic query (workspace lookup via Neon HTTP)...')

  for (let i = 0; i < WARMUP_ITERATIONS + ITERATIONS; i++) {
    // Create fresh connection each time (simulates serverless)
    const sqlClient = neon(DATABASE_URL!)
    const db = drizzleNeonHttp(sqlClient)

    const start = performance.now()
    // Simulate the workspace lookup query from resolver
    await db.execute(sql`SELECT * FROM workspace WHERE slug = 'nonexistent-test-slug' LIMIT 1`)
    const elapsed = performance.now() - start

    if (i < WARMUP_ITERATIONS) {
      if (i === 0) coldStartMs = elapsed
      process.stdout.write(`  Warmup ${i + 1}/${WARMUP_ITERATIONS}: ${elapsed.toFixed(1)}ms\n`)
    } else {
      times.push(elapsed)
      process.stdout.write(
        `  Run ${i - WARMUP_ITERATIONS + 1}/${ITERATIONS}: ${elapsed.toFixed(1)}ms\n`
      )
    }
  }

  return {
    name: 'Realistic query (Neon HTTP)',
    coldStartMs,
    avgMs: times.reduce((a, b) => a + b, 0) / times.length,
    minMs: Math.min(...times),
    maxMs: Math.max(...times),
    p50Ms: percentile(times, 50),
    p95Ms: percentile(times, 95),
  }
}

function printResults(results: BenchmarkResult[]) {
  console.log('\n' + '='.repeat(80))
  console.log('📈 BENCHMARK RESULTS')
  console.log('='.repeat(80))

  console.log(
    '\n┌─────────────────────────────────────┬──────────┬────────┬────────┬────────┬────────┬────────┐'
  )
  console.log(
    '│ Driver                              │ Cold (ms)│ Avg(ms)│ Min(ms)│ Max(ms)│ P50(ms)│ P95(ms)│'
  )
  console.log(
    '├─────────────────────────────────────┼──────────┼────────┼────────┼────────┼────────┼────────┤'
  )

  for (const r of results) {
    const name = r.name.padEnd(37)
    const cold = r.coldStartMs.toFixed(0).padStart(8)
    const avg = r.avgMs.toFixed(0).padStart(6)
    const min = r.minMs.toFixed(0).padStart(6)
    const max = r.maxMs.toFixed(0).padStart(6)
    const p50 = r.p50Ms.toFixed(0).padStart(6)
    const p95 = r.p95Ms.toFixed(0).padStart(6)
    console.log(`│ ${name} │ ${cold} │ ${avg} │ ${min} │ ${max} │ ${p50} │ ${p95} │`)
  }

  console.log(
    '└─────────────────────────────────────┴──────────┴────────┴────────┴────────┴────────┴────────┘'
  )

  console.log('\n📝 Notes:')
  console.log('   - Cold start: First connection (includes TLS handshake, auth)')
  console.log('   - Neon HTTP: Uses HTTP/2 fetch, stateless (no persistent TCP)')
  console.log('   - postgres.js new conn: New TCP+TLS connection each query')
  console.log('   - postgres.js pooled: Reuses TCP connections (best case)')
  console.log('   - Hyperdrive pools connections at the edge, reducing cold start')
}

async function main() {
  console.log('🔧 Database Connection Benchmark')
  console.log('================================')
  console.log(`Database: ${DATABASE_URL!.split('@')[1]?.split('/')[0] ?? 'unknown'}`)
  console.log(`Iterations: ${ITERATIONS} (+ ${WARMUP_ITERATIONS} warmup)`)

  const results: BenchmarkResult[] = []

  results.push(await benchmarkNeonHttp())
  results.push(await benchmarkPostgresJs())
  results.push(await benchmarkPostgresJsPooled())
  results.push(await benchmarkRealisticQuery())

  printResults(results)
}

main().catch(console.error)
