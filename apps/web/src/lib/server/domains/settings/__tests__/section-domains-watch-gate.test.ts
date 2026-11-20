// @vitest-environment node
/**
 * The section domain watch's schedule gate on a pooled process (Cloud's
 * fleet): the runner asks a gate on every pass in every workspace, so the
 * answer there costs no query. The rest of the gate is proved against a real
 * database in section-domains-watch.db.test.ts.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

const reads = vi.hoisted(() => ({ hosting: 0, map: 0 }))
vi.mock('../section-domains.service', () => ({
  readHostingIfSetUp: async () => {
    reads.hosting += 1
    return { cloud: false, projection: null }
  },
  getSectionDomains: async () => {
    reads.map += 1
    return { help: { hostname: 'help.acme.com', verifiedAt: '2026-11-01T00:00:00.000Z' } }
  },
}))
vi.mock('../section-domains-watch', () => ({ watchSectionDomains: async () => ({}) }))

const { isSectionDomainsWatchDue } = await import('../section-domains-watch-queue')

afterEach(() => {
  vi.unstubAllEnvs()
  reads.hosting = 0
  reads.map = 0
})

describe('isSectionDomainsWatchDue', () => {
  it('is shut on a pooled process without reading anything', async () => {
    vi.stubEnv('QUACKBACK_TENANCY', 'pooled')
    expect(await isSectionDomainsWatchDue()).toBe(false)
    expect(reads).toEqual({ hosting: 0, map: 0 })
  })

  it('reads the settings on a single-workspace server', async () => {
    vi.stubEnv('QUACKBACK_TENANCY', 'single')
    expect(await isSectionDomainsWatchDue()).toBe(true)
    expect(reads).toEqual({ hosting: 1, map: 1 })
  })
})
