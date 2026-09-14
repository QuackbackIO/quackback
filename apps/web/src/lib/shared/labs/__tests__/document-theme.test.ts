import { describe, expect, it } from 'vitest'
import { visualThemeAttribute } from '../document-theme'

describe('visualThemeAttribute', () => {
  it('omits the marker for legacy and missing values', () => {
    expect(visualThemeAttribute('legacy')).toBeUndefined()
    expect(visualThemeAttribute(undefined)).toBeUndefined()
    expect(visualThemeAttribute(null)).toBeUndefined()
  })

  it('sets the refined marker only when the experiment is active', () => {
    expect(visualThemeAttribute('refined')).toBe('refined')
  })
})
