import { describe, expect, it } from 'vitest'
import { sortForSearch } from '../filters'

describe('sortForSearch', () => {
  it('switches to best match when a search starts from the default order', () => {
    expect(sortForSearch('trending', undefined, 'zap', 'trending')).toBe('relevance')
    expect(sortForSearch('newest', undefined, 'zap', 'newest')).toBe('relevance')
  })

  it('keeps an order picked on purpose', () => {
    expect(sortForSearch('top', undefined, 'zap', 'trending')).toBe('top')
    expect(sortForSearch('trending', 'za', 'zap', 'trending')).toBe('trending')
  })

  it('goes back to the default order when the search is cleared', () => {
    expect(sortForSearch('relevance', 'zap', '', 'trending')).toBe('trending')
    expect(sortForSearch('relevance', 'zap', undefined, 'newest')).toBe('newest')
    expect(sortForSearch('new', 'zap', '', 'trending')).toBe('new')
  })
})
