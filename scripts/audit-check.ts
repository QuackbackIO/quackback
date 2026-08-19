#!/usr/bin/env bun
/**
 * CI dependency-audit gate with a reviewed, time-boxed exception list.
 *
 * Runs `bun audit` over production dependencies and fails when any high or
 * critical advisory is present, UNLESS it is listed in `.audit-allowlist.json`
 * with an `expires` date that is still in the future. Expired exceptions whose
 * advisory is still present also fail the gate, so an exception cannot silence a
 * live vulnerability forever. Exceptions that no longer match any advisory are
 * reported as stale (safe to delete) but do not fail the build.
 *
 * Usage: bun scripts/audit-check.ts
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const BLOCKING_SEVERITIES = new Set(['high', 'critical'])

interface RawAdvisory {
  id: number
  url: string
  title: string
  severity: string
}
interface AllowlistEntry {
  ghsa: string
  reason: string
  expires: string
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const allowlistPath = path.join(repoRoot, '.audit-allowlist.json')

/** GHSA identifier is the last path segment of the advisory url. */
function ghsaOf(advisory: RawAdvisory): string {
  return advisory.url.split('/').pop() ?? String(advisory.id)
}

function loadAllowlist(): AllowlistEntry[] {
  let parsed: { advisories?: AllowlistEntry[] }
  try {
    parsed = JSON.parse(readFileSync(allowlistPath, 'utf8'))
  } catch (error) {
    console.error(
      `Could not read ${path.relative(repoRoot, allowlistPath)}: ${(error as Error).message}`
    )
    process.exit(2)
  }
  const entries = parsed.advisories ?? []
  for (const entry of entries) {
    if (!entry.ghsa || !entry.reason || !entry.expires) {
      console.error(
        `Invalid allowlist entry (needs ghsa, reason, expires): ${JSON.stringify(entry)}`
      )
      process.exit(2)
    }
    if (Number.isNaN(Date.parse(entry.expires))) {
      console.error(`Invalid expires date for ${entry.ghsa}: ${entry.expires} (use YYYY-MM-DD)`)
      process.exit(2)
    }
  }
  return entries
}

async function runAudit(): Promise<Record<string, RawAdvisory[]>> {
  const proc = Bun.spawn(['bun', 'audit', '--production', '--json'], {
    cwd: repoRoot,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const stdout = await new Response(proc.stdout).text()
  await proc.exited
  // `bun audit` exits non-zero when advisories exist; that is expected here, we
  // grade the parsed output ourselves. Only a missing/unparseable body is fatal.
  if (!stdout.trim()) return {}
  try {
    return JSON.parse(stdout)
  } catch (error) {
    console.error(`Could not parse bun audit output: ${(error as Error).message}`)
    console.error(stdout.slice(0, 2000))
    process.exit(2)
  }
}

const allowlist = loadAllowlist()
const allowByGhsa = new Map(allowlist.map((entry) => [entry.ghsa, entry]))
const report = await runAudit()

// Compare against the start of today (UTC) so an exception is valid through its
// stated expiry day.
const today = new Date()
const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())

const blocking: string[] = []
const suppressed: string[] = []
const matchedGhsa = new Set<string>()

for (const [pkg, advisories] of Object.entries(report)) {
  for (const advisory of advisories) {
    if (!BLOCKING_SEVERITIES.has(advisory.severity)) continue
    const ghsa = ghsaOf(advisory)
    const entry = allowByGhsa.get(ghsa)
    const label = `${pkg} ${ghsa} (${advisory.severity}) - ${advisory.title}`
    if (!entry) {
      blocking.push(label)
      continue
    }
    matchedGhsa.add(ghsa)
    const expired = Date.parse(entry.expires) < todayUtc
    if (expired) {
      blocking.push(`${label} [allowlist entry expired ${entry.expires}, re-review required]`)
    } else {
      suppressed.push(`${label} [allowed until ${entry.expires}: ${entry.reason}]`)
    }
  }
}

const stale = allowlist.filter((entry) => !matchedGhsa.has(entry.ghsa))

if (suppressed.length) {
  console.log('Allowlisted advisories (not blocking):')
  for (const line of suppressed) console.log(`  - ${line}`)
}
if (stale.length) {
  console.log('Stale allowlist entries (advisory no longer present, safe to remove):')
  for (const entry of stale) console.log(`  - ${entry.ghsa} (${entry.reason})`)
}

if (blocking.length) {
  console.error(
    `\nFAIL: ${blocking.length} production high/critical advisory(ies) not covered by a valid allowlist entry:`
  )
  for (const line of blocking) console.error(`  - ${line}`)
  console.error(
    `\nRemediate by upgrading/overriding the dependency, or add a reviewed, dated exception to ${path.relative(
      repoRoot,
      allowlistPath
    )}.`
  )
  process.exit(1)
}

console.log(`\nPASS: no un-allowlisted production high/critical advisories.`)
