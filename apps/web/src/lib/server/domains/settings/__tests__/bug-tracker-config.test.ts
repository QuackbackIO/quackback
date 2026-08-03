import { describe, it, expect } from 'vitest'
import { parseJsonConfig, normalizeBugTrackerInput, publicBugTracker } from '../settings.helpers'
import {
  DEFAULT_PORTAL_CONFIG,
  type PortalConfig,
  type PublicPortalConfig,
} from '../settings.types'

describe('PortalBugTrackerConfig defaults', () => {
  it('is off by default', () => {
    expect(DEFAULT_PORTAL_CONFIG.bugTracker?.enabled).toBe(false)
  })

  it('has an empty url by default', () => {
    expect(DEFAULT_PORTAL_CONFIG.bugTracker?.url).toBe('')
  })

  it('defaults to bug/issue keywords', () => {
    expect(DEFAULT_PORTAL_CONFIG.bugTracker?.keywords).toEqual(['bug', 'issue'])
  })
})

describe('PortalBugTrackerConfig type', () => {
  it('is exposed as an optional field on PortalConfig', () => {
    const cfg: PortalConfig = {
      ...DEFAULT_PORTAL_CONFIG,
      bugTracker: { enabled: true, url: 'https://example.com/issues', keywords: ['bug'] },
    }
    expect(cfg.bugTracker?.enabled).toBe(true)
  })

  it('is exposed on PublicPortalConfig without an enabled flag', () => {
    const projection: PublicPortalConfig = {
      features: DEFAULT_PORTAL_CONFIG.features,
      bugTracker: { url: 'https://example.com/issues', keywords: ['bug'] },
    }
    expect(projection.bugTracker?.url).toBe('https://example.com/issues')
  })
})

describe('parseJsonConfig deep-merges bugTracker', () => {
  it('preserves bugTracker defaults when stored config omits it', () => {
    const stored = JSON.stringify({ features: { allowAnonymous: false } })
    const result = parseJsonConfig(stored, DEFAULT_PORTAL_CONFIG)
    expect(result.bugTracker).toEqual(DEFAULT_PORTAL_CONFIG.bugTracker)
  })

  it('replaces keywords wholesale rather than merging the array', () => {
    const stored = JSON.stringify({ bugTracker: { keywords: ['crash'] } })
    const result = parseJsonConfig(stored, DEFAULT_PORTAL_CONFIG)
    expect(result.bugTracker?.keywords).toEqual(['crash'])
  })
})

describe('normalizeBugTrackerInput', () => {
  it('returns the input unchanged when undefined', () => {
    expect(normalizeBugTrackerInput(undefined)).toBeUndefined()
  })

  it('trims the url', () => {
    const out = normalizeBugTrackerInput({ url: '  https://example.com/issues  ' })
    expect(out?.url).toBe('https://example.com/issues')
  })

  it('trims, dedupes case-insensitively, and drops empty keywords', () => {
    const out = normalizeBugTrackerInput({ keywords: [' Bug ', 'bug', 'issue', '', '   '] })
    expect(out?.keywords).toEqual(['Bug', 'issue'])
  })
})

describe('publicBugTracker', () => {
  it('returns undefined when the config is undefined', () => {
    expect(publicBugTracker(undefined)).toBeUndefined()
  })

  it('returns undefined when disabled', () => {
    expect(
      publicBugTracker({ enabled: false, url: 'https://example.com/issues', keywords: ['bug'] })
    ).toBeUndefined()
  })

  it('returns undefined when the url is blank', () => {
    expect(publicBugTracker({ enabled: true, url: '   ', keywords: ['bug'] })).toBeUndefined()
  })

  it('returns url and keywords when enabled with a url', () => {
    expect(
      publicBugTracker({ enabled: true, url: 'https://example.com/issues', keywords: ['bug'] })
    ).toEqual({ url: 'https://example.com/issues', keywords: ['bug'] })
  })
})
