import { describe, expect, it } from 'vitest'
import {
  friendlyPlatformLabel,
  isGeneratedSystemLabel,
  platformLabelFromHostname,
} from '../platform-label'

describe('platform-label', () => {
  it('takes the first hostname label', () => {
    expect(platformLabelFromHostname('awesome.quackback.co.uk')).toBe('awesome')
  })

  it('recognizes provisioned system labels and full hosts', () => {
    expect(isGeneratedSystemLabel('ws-4a048e07941c5e7840e986c0')).toBe(true)
    expect(isGeneratedSystemLabel('ws-4a048e07941c5e7840e986c0.quackback.co.uk')).toBe(true)
    expect(isGeneratedSystemLabel('awesome')).toBe(false)
    expect(isGeneratedSystemLabel('ws-team')).toBe(false)
  })

  it('does not treat a generated system host as a friendly URL', () => {
    expect(friendlyPlatformLabel('ws-4a048e07941c5e7840e986c0.quackback.co.uk')).toBe('')
    expect(friendlyPlatformLabel('awesome.quackback.co.uk')).toBe('awesome')
    expect(friendlyPlatformLabel(null)).toBe('')
  })
})
