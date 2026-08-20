/**
 * `JOBS.md`'s queue table is derived from `JOB_DEFINITIONS`, not restated.
 *
 * The reason this file exists, in one sentence: the previous hand-written count
 * ("seven queue modules arm lazily on first enqueue") was true when it was
 * written and false the moment a queue moved, and nothing said so. A number in
 * prose is a claim about the registry with no way to fail.
 *
 * So the table is generated here and compared byte for byte. Adding, removing
 * or re-tuning a definition without regenerating the doc turns this red, and
 * the failure message is the corrected table ready to paste.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  JOB_DEFINITIONS,
  concurrencyFor,
  leaseMsFor,
  maxAttemptsFor,
  type JobDefinition,
} from '../definitions'

const DOC = path.resolve(__dirname, '../JOBS.md')
const START = '<!-- QUEUE-TABLE:START — generated from JOB_DEFINITIONS; do not hand-edit -->'
const END = '<!-- QUEUE-TABLE:END -->'

function scheduleCell(def: JobDefinition): string {
  if (def.cron) return `\`${def.cron}\``
  if (def.dynamicSchedules) return 'dynamic'
  return '—'
}

/** Cell values per row, ignoring the column padding prettier reflows. */
function expectedRows(defs: readonly JobDefinition[]): string[][] {
  return defs.map((def) => [
    `\`${def.name}\``,
    scheduleCell(def),
    String(concurrencyFor(def)),
    String(maxAttemptsFor(def)),
    `${leaseMsFor(def) / 1000}s`,
  ])
}

/** Parse the markdown table body into cell values, dropping the rule row. */
function parseRows(block: string): string[][] {
  return block
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('|'))
    .map((line) =>
      line
        .slice(1, line.lastIndexOf('|'))
        .split('|')
        .map((cell) => cell.trim())
    )
    .filter((cells) => !cells.every((cell) => /^-+$/.test(cell)))
    .slice(1) // the header
}

describe('JOBS.md §10 queue table', () => {
  const doc = readFileSync(DOC, 'utf8')

  it('has the generated block the rest of this suite compares against', () => {
    // The precondition. Without it, a rename of the markers would make the
    // comparison below vacuous rather than red.
    expect(doc).toContain(START)
    expect(doc).toContain(END)
    expect(JOB_DEFINITIONS.length).toBeGreaterThan(0)
  })

  it('matches the registry exactly', () => {
    const body = doc.slice(doc.indexOf(START) + START.length, doc.indexOf(END))
    // Cell values, not raw text: prettier reflows the column padding, and a
    // test that failed on whitespace would be turned off rather than fixed.
    expect(parseRows(body)).toEqual(expectedRows(JOB_DEFINITIONS))
  })

  it('parses a real table — so the comparison above cannot pass on nothing', () => {
    const body = doc.slice(doc.indexOf(START) + START.length, doc.indexOf(END))
    expect(parseRows(body).length).toBe(JOB_DEFINITIONS.length)
    expect(parseRows(body)[0][0]).toMatch(/^`.+`$/)
  })

  it('names every registered queue, so a new one cannot land undocumented', () => {
    for (const def of JOB_DEFINITIONS) {
      expect(doc).toContain(`\`${def.name}\``)
    }
  })
})
