#!/usr/bin/env bun
/**
 * Lowers the admin ratchet baselines (src/locales/__tests__/admin-*-baseline.json)
 * to what the code holds today: a count that went down is lowered, a file
 * that has none (or is gone) is dropped. It never raises a count or adds a
 * file, so a new problem still fails its test. A baseline that does not exist
 * yet is written from today's counts.
 *
 * A renamed or moved file is a new path to the baselines, so its count would
 * have to be zero; `--move <old> <new>` carries the old path's allowance to
 * the new one first (paths relative to apps/web/src), then lowers as usual.
 *
 * Usage: bun run i18n:baseline [--move <old> <new>]...
 */
import { existsSync, writeFileSync } from 'node:fs'
import { relative } from 'node:path'
import {
  adminSourceFiles,
  compareWithBaseline,
  countsOf,
  formatBaseline,
  lowerBaseline,
  readBaseline,
  scanFiles,
} from '../src/locales/__tests__/admin-ratchet'
import { RATCHETS } from '../src/locales/__tests__/admin-ratchets'

const files = adminSourceFiles()
let failed = false

/** The `--move <old> <new>` pairs, in order. */
function moves(args: readonly string[]): [string, string][] {
  const pairs: [string, string][] = []
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== '--move') continue
    const [from, to] = [args[i + 1], args[i + 2]]
    if (!from || !to) throw new Error('--move needs the old and the new path')
    pairs.push([from, to])
    i += 2
  }
  return pairs
}
const renames = moves(process.argv.slice(2))

for (const ratchet of RATCHETS) {
  const found = scanFiles(ratchet.scan, files)
  const counts = countsOf(found)
  const path = relative(process.cwd(), ratchet.baselinePath)
  if (!existsSync(ratchet.baselinePath)) {
    writeFileSync(ratchet.baselinePath, formatBaseline(counts))
    console.log(`${ratchet.name}: wrote ${path} (${Object.keys(counts).length} files)`)
    continue
  }
  const baseline = readBaseline(ratchet.baselinePath)
  for (const [from, to] of renames) {
    if (baseline[from] === undefined) continue
    baseline[to] = (baseline[to] ?? 0) + baseline[from]!
    delete baseline[from]
  }
  const lowered = lowerBaseline(baseline, counts)
  const before = Object.values(baseline).reduce((sum, count) => sum + count, 0)
  const after = Object.values(lowered).reduce((sum, count) => sum + count, 0)
  writeFileSync(ratchet.baselinePath, formatBaseline(lowered))
  console.log(`${ratchet.name}: ${before} -> ${after} in ${path}`)
  for (const { file, count, baseline: allowed } of compareWithBaseline(found, lowered)
    .regressions) {
    failed = true
    console.error(`  ${file} has ${count} ${ratchet.problem} (baseline ${allowed}). ${ratchet.fix}`)
  }
}

if (failed) process.exit(1)
