import { describe, expect, it } from 'vitest'
import { DEFAULT_STATUS_SETTINGS, isStatusPagePublished } from '../status-settings'
import { DEFAULT_FEATURE_FLAGS } from '@/lib/server/domains/settings/settings.types'

describe('isStatusPagePublished', () => {
  it('stays unpublished when the flag is on but enabled is false', () => {
    expect(isStatusPagePublished({ statusPage: true }, { enabled: false })).toBe(false)
  })

  it('publishes when the flag is on and enabled is true', () => {
    expect(isStatusPagePublished({ statusPage: true }, { enabled: true })).toBe(true)
  })

  it('stays unpublished when the flag is off', () => {
    expect(isStatusPagePublished({ statusPage: false }, { enabled: true })).toBe(false)
    expect(isStatusPagePublished({ statusPage: false }, { enabled: false })).toBe(false)
    expect(isStatusPagePublished(DEFAULT_FEATURE_FLAGS, DEFAULT_STATUS_SETTINGS)).toBe(false)
  })
})
