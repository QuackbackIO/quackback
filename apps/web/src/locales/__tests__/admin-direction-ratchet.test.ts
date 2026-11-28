/**
 * Guard: admin keeps mirroring in a right-to-left language. Each admin file
 * may hold no more left/right classes, unmirrored icons and one-way moves than its
 * baseline (admin-direction-baseline.json); a new file holds none. The
 * baseline keeps the sides that are physical on purpose. See
 * docs/translating.md.
 */
import { describe, expect, it } from 'vitest'
import { adminSourceFiles, scanFiles } from './admin-ratchet'
import { RATCHETS } from './admin-ratchets'
import { ratchetReport } from './ratchet-report'

const ratchet = RATCHETS.find(({ name }) => name === 'direction')!
const files = adminSourceFiles()

describe('admin direction ratchet', () => {
  it('no admin file gains a left/right class, an unmirrored icon or a one-way move', () => {
    const report = ratchetReport(ratchet, scanFiles(ratchet.scan, files))
    expect(report.regressions, report.regressions).toBe('')
  })

  it('the baseline is as low as the code (run bun run i18n:baseline)', () => {
    const report = ratchetReport(ratchet, scanFiles(ratchet.scan, files))
    expect(report.stale).toEqual([])
  })
})
