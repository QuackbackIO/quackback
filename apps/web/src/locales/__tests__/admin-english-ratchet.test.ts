/**
 * Guard: admin code does not gain English. Each admin file may hold no more
 * English strings in code than its baseline (admin-english-baseline.json); a
 * new file holds none. Moving a string to the catalog lowers the count; then
 * `bun run i18n:baseline` lowers the baseline. See docs/translating.md.
 */
import { describe, expect, it } from 'vitest'
import { adminSourceFiles, scanFiles } from './admin-ratchet'
import { RATCHETS } from './admin-ratchets'
import { ratchetReport } from './ratchet-report'

const ratchet = RATCHETS.find(({ name }) => name === 'english')!
const files = adminSourceFiles()

describe('admin English ratchet', () => {
  it('scans the admin sources', () => {
    expect(files.length).toBeGreaterThan(500)
    expect(files).toContain('routes/admin.tsx')
  })

  it('no admin file gains English in code', () => {
    const report = ratchetReport(ratchet, scanFiles(ratchet.scan, files))
    expect(report.regressions, report.regressions).toBe('')
  })

  it('the baseline is as low as the code (run bun run i18n:baseline)', () => {
    const report = ratchetReport(ratchet, scanFiles(ratchet.scan, files))
    expect(report.stale).toEqual([])
  })
})
