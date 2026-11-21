/**
 * Quarantined e2e tests are not forgotten debt: each one is listed in
 * apps/web/e2e/QUARANTINE.md with the PR or issue that fixes it, and an entry
 * goes when its quarantine is lifted. See the ledger module for the format.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  checkLedger,
  describeLedgerReport,
  parseLedger,
  scanSpec,
} from '@/lib/server/e2e-harness/quarantine-ledger'

const WEB_ROOT = resolve(__dirname, '../../../../..')
const E2E_ROOT = join(WEB_ROOT, 'e2e')

function specFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : specFiles(path)
    return entry.name.endsWith('.ts') ? [path] : []
  })
}

describe('e2e quarantine ledger', () => {
  it('lists every quarantined test, and only those, each with its fix', () => {
    const scans = specFiles(E2E_ROOT).map((path) =>
      scanSpec(relative(E2E_ROOT, path), readFileSync(path, 'utf8'))
    )
    const ledger = parseLedger(readFileSync(join(E2E_ROOT, 'QUARANTINE.md'), 'utf8'))

    // The scan read the suites (an empty ledger with nothing quarantined is fine).
    expect(scans.length).toBeGreaterThan(50)
    expect(describeLedgerReport(checkLedger(scans, ledger))).toBeNull()
  })
})

describe('scanSpec', () => {
  it('finds a test tagged directly, through a shared constant, and with two ids', () => {
    const source = `
const QUARANTINED = { tag: ['@core', '@quarantine'], annotation: { type: 'quarantine', description: 'x' } }
test('AB-C-01 direct', { tag: ['@core', '@quarantine'] }, async () => {})
test('AB-C-02 shared', QUARANTINED, async () => {})
test('AB-C-03 AB-C-04 spread', { ...QUARANTINED }, async () => {})
test('AB-C-05 not quarantined', { tag: '@core' }, async () => {})
test.describe('group', () => {
  test("AB-C-06 nested", { tag: "@quarantine" }, async () => {})
})
`
    const scan = scanSpec('x.spec.ts', source)
    expect(scan.tests.map((t) => t.ids)).toEqual([
      ['AB-C-01'],
      ['AB-C-02'],
      ['AB-C-03', 'AB-C-04'],
      ['AB-C-06'],
    ])
    expect(scan.unattributed).toEqual([])
  })

  it('counts a @quarantine tag written in the title', () => {
    const scan = scanSpec('t.spec.ts', "test('AB-T-01 title tagged @quarantine', async () => {})")
    expect(scan.tests.map((t) => t.ids)).toEqual([['AB-T-01']])
  })

  it('reports a tag it cannot tie to a test, a test with no id and a tagged describe', () => {
    const source = `
const tags = ['@quarantine']
test('no id here', { tag: '@quarantine' }, async () => {})
test.describe('AB-D-01 group', { tag: '@quarantine' }, () => {})
`
    const scan = scanSpec('y.spec.ts', source)
    expect(scan.unattributed).toEqual(['y.spec.ts:2'])
    expect(scan.withoutId.map((t) => t.title)).toEqual(['no id here'])
    expect(scan.describes).toEqual(['y.spec.ts:4 AB-D-01 group'])
  })
})

describe('checkLedger', () => {
  const ledgerText = `# E2E quarantine

## Quarantined tests

### Area

- AB-C-01 · fix: #1234
  \`x.spec.ts\` › AB-C-01 the reason.
- AB-C-02 AB-C-03 · fix: https://github.com/QuackbackIO/quackback/issues/99
  \`x.spec.ts\` › the reason.
- AB-C-09 · fix: product bug, not yet filed
  \`x.spec.ts\` › the reason.
- AB-C-10 · fix: #1
- \`x.spec.ts\` › AB-C-11 an entry in the old shape

## Afterwards

- AB-Z-01 not an entry
`
  const scan = scanSpec(
    'x.spec.ts',
    `
test('AB-C-01 a', { tag: '@quarantine' }, async () => {})
test('AB-C-02 b', { tag: '@quarantine' }, async () => {})
test('AB-C-04 c', { tag: '@quarantine' }, async () => {})
test('AB-C-09 d', { tag: '@quarantine' }, async () => {})
`
  )

  it('names the missing, stale and unowned ids and the malformed entries', () => {
    const report = checkLedger([scan], parseLedger(ledgerText))
    expect(report.missing).toEqual(['AB-C-04'])
    expect(report.stale).toEqual(['AB-C-03', 'AB-C-10'])
    expect(report.unowned).toEqual(['AB-C-09'])
    expect(report.problems).toEqual([expect.stringContaining('AB-C-11 an entry in the old shape')])

    const message = describeLedgerReport(report) ?? ''
    expect(message).toContain('not in apps/web/e2e/QUARANTINE.md: AB-C-04.')
    expect(message).toContain('no test with that id is tagged @quarantine: AB-C-03, AB-C-10.')
    expect(message).toContain('name no fix PR or issue: AB-C-09.')
  })

  it('holds when every quarantined id has an owned entry and nothing else is listed', () => {
    const ledger = parseLedger(`## Quarantined tests

- AB-C-01 · fix: #1
- AB-C-02 · fix: #2 (merged); lift: #3
`)
    const ok = scanSpec(
      'x.spec.ts',
      `test('AB-C-01 a', { tag: '@quarantine' }, async () => {})
test('AB-C-02 b', { tag: '@quarantine' }, async () => {})`
    )
    expect(describeLedgerReport(checkLedger([ok], ledger))).toBeNull()
  })

  it('holds with an empty ledger and nothing quarantined', () => {
    const report = checkLedger(
      [scanSpec('x.spec.ts', "test('AB-C-01 a', { tag: '@core' }, async () => {})")],
      parseLedger('## Quarantined tests\n\nNone right now.\n')
    )
    expect(describeLedgerReport(report)).toBeNull()
  })

  it('fails when entries exist but no quarantined test is found', () => {
    const report = checkLedger([], parseLedger('## Quarantined tests\n\n- AB-C-01 · fix: #1\n'))
    expect(report.problems).toContain(
      'QUARANTINE.md lists entries but the scan found no quarantined test'
    )
  })
})
