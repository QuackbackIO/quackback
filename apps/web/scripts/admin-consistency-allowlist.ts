#!/usr/bin/env bun
/**
 * Prints the admin consistency allowlist for today's source: every file that
 * still breaks a rule, per rule. The guard test fails on offenders missing from
 * the allowlist and on stale entries, so entries are removed as files are
 * fixed, never added.
 *
 * Usage: bun scripts/admin-consistency-allowlist.ts --print
 */
import {
  scanAdminFiles,
  RULE_NAMES,
} from '../src/components/admin/__tests__/admin-consistency.rules'
import { AUTOMATION_PAGES, SETTINGS_PAGES } from '../src/components/admin/settings/settings-pages'

if (!process.argv.includes('--print')) {
  console.error('Usage: bun scripts/admin-consistency-allowlist.ts --print')
  process.exit(1)
}

const offenders = scanAdminFiles([...Object.keys(SETTINGS_PAGES), ...Object.keys(AUTOMATION_PAGES)])
const lines = [
  "import type { RuleName } from './admin-consistency.rules'",
  '',
  '/** Files (or, for registry-pages, registry paths) that do not comply yet. Entries only shrink. */',
  'export const ALLOWLIST: Record<RuleName, string[]> = {',
]
for (const rule of RULE_NAMES) {
  lines.push(`  '${rule}': [`)
  for (const entry of offenders[rule]) lines.push(`    '${entry}',`)
  lines.push('  ],')
}
lines.push('}', '')
console.log(lines.join('\n'))
