import { describe, it, expect } from 'vitest'
import { formatCategoryCount } from '../category-count'

describe('formatCategoryCount', () => {
  it('shows a single number when direct and recursive match', () => {
    expect(formatCategoryCount(5, 5)).toBe('5')
    expect(formatCategoryCount(0, 0)).toBe('0')
  })

  it('shows "direct / total" when a parent has articles nested below it', () => {
    expect(formatCategoryCount(0, 24)).toBe('0 / 24')
    expect(formatCategoryCount(2, 7)).toBe('2 / 7')
  })

  it('still formats when recursive is smaller (should not happen but stays defensible)', () => {
    // Guards against a caller passing mis-ordered args. Treat as "different"
    // so the discrepancy is visible rather than silently collapsed.
    expect(formatCategoryCount(3, 1)).toBe('3 / 1')
  })
})
