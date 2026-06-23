import { describe, it, expect } from 'vitest'
import { parseJsonConfig } from '../settings.helpers'
import {
  DEFAULT_PORTAL_CONFIG,
  DEFAULT_WIDGET_CONFIG,
  workspaceAllowsAnonymous,
  type PublicPortalConfig,
} from '../settings.types'

describe('DEFAULT_PORTAL_CONFIG', () => {
  it('DEFAULT_PORTAL_CONFIG carries a moderationDefault of none', () => {
    expect(DEFAULT_PORTAL_CONFIG.moderationDefault).toEqual({ requireApproval: 'none' })
  })

  it('DEFAULT_PORTAL_CONFIG has widgetSignIn defaulting to false', () => {
    expect(DEFAULT_PORTAL_CONFIG.access?.widgetSignIn).toBe(false)
  })
})

describe('PublicPortalConfig.portalAccess', () => {
  it('portalAccess shape includes widgetSignIn', () => {
    // Verify the type carries widgetSignIn (build-time type assertion via satisfies)
    const cfg = {
      features: DEFAULT_PORTAL_CONFIG.features,
      portalAccess: { isPrivate: true, widgetSignIn: false },
    } satisfies PublicPortalConfig
    expect(cfg.portalAccess?.isPrivate).toBe(true)
    expect(cfg.portalAccess?.widgetSignIn).toBe(false)
  })

  it('portalAccess.widgetSignIn is boolean', () => {
    const cfg: PublicPortalConfig = {
      features: DEFAULT_PORTAL_CONFIG.features,
      portalAccess: { isPrivate: false, widgetSignIn: true },
    }
    expect(typeof cfg.portalAccess?.widgetSignIn).toBe('boolean')
    expect(cfg.portalAccess?.widgetSignIn).toBe(true)
  })
})

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
      features: { allowAnonymous: false },
    })

    const result = parseJsonConfig(stored, DEFAULT_PORTAL_CONFIG)

    expect(result.oauth.password).toBe(false)
    expect(result.oauth.email).toBe(true)
    // google/github preserved from defaults
    expect(result.oauth.google).toBe(true)
    expect(result.oauth.github).toBe(true)
    // Explicit override
    expect(result.features.allowAnonymous).toBe(false)
    // Rest of features preserved from defaults
    expect(result.features.allowEditAfterEngagement).toBe(false)
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

describe('workspaceAllowsAnonymous', () => {
  it('allows anonymous only when the flag is explicitly true (string config)', () => {
    expect(workspaceAllowsAnonymous(JSON.stringify({ features: { allowAnonymous: true } }))).toBe(
      true
    )
  })

  it('allows anonymous when the flag is explicitly true (object config)', () => {
    expect(workspaceAllowsAnonymous({ features: { allowAnonymous: true } })).toBe(true)
  })

  it('fails closed when the flag is false, missing, or the config is null/undefined', () => {
    expect(workspaceAllowsAnonymous(JSON.stringify({ features: { allowAnonymous: false } }))).toBe(
      false
    )
    expect(workspaceAllowsAnonymous(JSON.stringify({ features: {} }))).toBe(false)
    expect(workspaceAllowsAnonymous(null)).toBe(false)
    expect(workspaceAllowsAnonymous(undefined)).toBe(false)
  })

  it('fails closed on an empty string (a live portal_config state, see migration 0084) instead of throwing', () => {
    // Pre-0084 / restored-backup rows can carry '' rather than NULL; the gate
    // must deny, not 500. Every other portal-config parse site try/catches.
    expect(() => workspaceAllowsAnonymous('')).not.toThrow()
    expect(workspaceAllowsAnonymous('')).toBe(false)
  })

  it('fails closed on malformed JSON instead of throwing', () => {
    expect(() => workspaceAllowsAnonymous('{ not valid json')).not.toThrow()
    expect(workspaceAllowsAnonymous('{ not valid json')).toBe(false)
  })
})
