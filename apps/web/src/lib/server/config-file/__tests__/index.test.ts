import { describe, it, expect } from 'vitest'
import { hashSpec } from '../index'

// `startQuackbackConfigWatcher` glues hashSpec, fs.watch, and the
// reconciler together; integration coverage is split across
// `watcher.test.ts` (file-level changes), `reconciler.test.ts`
// (db-side effects), and `report-status.test.ts` (status reporter).
// This file just covers the pure `hashSpec` helper.

describe('hashSpec', () => {
  it('returns a deterministic SHA256 hex digest of JSON.stringify(spec)', () => {
    const a = hashSpec({ workspace: { name: 'Acme' } })
    const b = hashSpec({ workspace: { name: 'Acme' } })
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })

  it('produces different hashes for different specs', () => {
    const a = hashSpec({ workspace: { name: 'Acme' } })
    const b = hashSpec({ workspace: { name: 'Other' } })
    expect(a).not.toBe(b)
  })

  it('hashes an empty spec without throwing', () => {
    expect(hashSpec({})).toMatch(/^[0-9a-f]{64}$/)
  })
})
