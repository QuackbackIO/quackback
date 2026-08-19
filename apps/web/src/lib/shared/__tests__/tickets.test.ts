import { describe, it, expect } from 'vitest'
import { resolveResolvedStatusId } from '../tickets'

describe('resolveResolvedStatusId', () => {
  it('picks the closed status with the resolved slug', () => {
    expect(
      resolveResolvedStatusId([
        { id: 's_open', slug: 'new', category: 'open' },
        { id: 's_wont', slug: 'wont_do', category: 'closed' },
        { id: 's_res', slug: 'resolved', category: 'closed' },
      ])
    ).toBe('s_res')
  })

  it('falls back to the first closed status (the catalogue is position-ordered)', () => {
    expect(
      resolveResolvedStatusId([
        { id: 's_open', slug: 'new', category: 'open' },
        { id: 's_done', slug: 'done', category: 'closed' },
        { id: 's_wont', slug: 'wont_do', category: 'closed' },
      ])
    ).toBe('s_done')
  })

  it('ignores a non-closed status that happens to carry the slug', () => {
    expect(
      resolveResolvedStatusId([{ id: 's_open', slug: 'resolved', category: 'open' }])
    ).toBeUndefined()
  })

  it('returns undefined for an empty or missing catalogue', () => {
    expect(resolveResolvedStatusId([])).toBeUndefined()
    expect(resolveResolvedStatusId(undefined)).toBeUndefined()
  })
})
