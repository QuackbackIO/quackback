import { describe, it, expect } from 'vitest'
import { getHelpCenterBaseUrl } from '../help-center-url'

describe('getHelpCenterBaseUrl', () => {
  it('returns /hc as the inline help center base path', () => {
    expect(getHelpCenterBaseUrl()).toBe('/hc')
  })
})
