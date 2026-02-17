import { describe, it, expect } from 'vitest'
import { parseJsonConfig } from '../settings.service'
import { DEFAULT_PORTAL_CONFIG, DEFAULT_WIDGET_CONFIG } from '../settings.types'

describe('parseJsonConfig', () => {
  it('returns default when json is null', () => {
    const result = parseJsonConfig(null, DEFAULT_PORTAL_CONFIG)
    expect(result).toEqual(DEFAULT_PORTAL_CONFIG)
  })

  it('returns default when json is invalid', () => {
    const result = parseJsonConfig('not valid json', DEFAULT_PORTAL_CONFIG)
    expect(result).toEqual(DEFAULT_PORTAL_CONFIG)
  })

  it('deep merges nested objects instead of replacing them', () => {
    // Stored config only has email enabled — password key is missing
    const stored = JSON.stringify({
      oauth: { email: true },
    })

    const result = parseJsonConfig(stored, DEFAULT_PORTAL_CONFIG)

    // password should be preserved from the default (true)
    expect(result.oauth.password).toBe(true)
    // email should come from stored config
    expect(result.oauth.email).toBe(true)
    // features should be preserved from the default
    expect(result.features).toEqual(DEFAULT_PORTAL_CONFIG.features)
  })

  it('stored values override defaults for nested keys', () => {
    const stored = JSON.stringify({
      oauth: { password: false, email: true },
      features: { publicView: false },
    })

    const result = parseJsonConfig(stored, DEFAULT_PORTAL_CONFIG)

    expect(result.oauth.password).toBe(false)
    expect(result.oauth.email).toBe(true)
    // google/github preserved from defaults
    expect(result.oauth.google).toBe(true)
    expect(result.oauth.github).toBe(true)
    // Explicit override
    expect(result.features.publicView).toBe(false)
    // Rest of features preserved from defaults
    expect(result.features.submissions).toBe(true)
  })

  it('handles flat configs (no nested objects)', () => {
    const stored = JSON.stringify({ enabled: true })

    const result = parseJsonConfig(stored, DEFAULT_WIDGET_CONFIG)

    expect(result.enabled).toBe(true)
    expect(result.identifyVerification).toBe(false)
  })

  it('preserves default oauth.password when stored oauth omits it (bug fix)', () => {
    // This is the exact scenario that caused the bug:
    // DB stored oauth without password key, shallow merge lost the default
    const stored = JSON.stringify({
      oauth: { email: true, google: false, github: false },
      features: DEFAULT_PORTAL_CONFIG.features,
    })

    const result = parseJsonConfig(stored, DEFAULT_PORTAL_CONFIG)

    // password must be true from defaults — this is what the toggle displays
    expect(result.oauth.password).toBe(true)
    // Count of enabled methods must be >= 2 so email isn't the "last" one
    const enabledCount = Object.values(result.oauth).filter(Boolean).length
    expect(enabledCount).toBeGreaterThanOrEqual(2)
  })
})
