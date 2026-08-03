/**
 * Differential-coverage test for the public changelog taxonomy query factory —
 * key shape + queryFn delegation.
 */
import { describe, it, expect, vi } from 'vitest'

const m = vi.hoisted(() => ({
  taxonomy: vi.fn(() => Promise.resolve({ categories: [], products: [] })),
}))
vi.mock('@/lib/server/functions/changelog', () => ({
  listChangelogsFn: vi.fn(),
  getChangelogFn: vi.fn(),
  listChangelogTaxonomyFn: vi.fn(),
  listPublicChangelogsFn: vi.fn(),
  getPublicChangelogFn: vi.fn(),
  listPublicChangelogTaxonomyFn: m.taxonomy,
}))

import { publicChangelogTaxonomyQuery, publicChangelogFilterKeys } from '../changelog'

describe('publicChangelogTaxonomyQuery', () => {
  it('uses the taxonomy key and delegates to the server fn', async () => {
    const opts = publicChangelogTaxonomyQuery()
    expect(opts.queryKey).toEqual(publicChangelogFilterKeys.taxonomy())
    await (opts.queryFn as () => Promise<unknown>)()
    expect(m.taxonomy).toHaveBeenCalled()
  })
})
