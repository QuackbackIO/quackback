import { describe, expect, it } from 'vitest'
import {
  friendlyPlatformLabel,
  hostnameRegistrableSuffix,
  isGeneratedSystemLabel,
  platformLabelFromHostname,
  platformUrlSuffix,
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

  it('strips the first label for the registrable suffix', () => {
    expect(hostnameRegistrableSuffix('awesome.quackback.co.uk')).toBe('quackback.co.uk')
    expect(hostnameRegistrableSuffix('acme.quackback.io')).toBe('quackback.io')
  })

  it('takes the URL-field suffix from the platform host, not a custom-primary origin', () => {
    expect(
      platformUrlSuffix({
        platformHostname: 'acme.quackback.co.uk',
        canonicalOrigin: 'https://feedback.example.com',
      })
    ).toBe('quackback.co.uk')
  })

  it('falls back to the canonical host when no platform hostname is chosen yet', () => {
    expect(
      platformUrlSuffix({
        platformHostname: null,
        canonicalOrigin: 'https://ws-4a048e07941c5e7840e986c0.quackback.co.uk',
      })
    ).toBe('quackback.co.uk')
  })
})
