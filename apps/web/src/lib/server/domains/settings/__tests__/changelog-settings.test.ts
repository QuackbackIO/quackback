import { describe, it, expect } from 'vitest'
import { resolveChangelogSettings } from '../settings.changelog'
import { DEFAULT_CHANGELOG_SETTINGS } from '@/lib/shared/changelog-settings'

describe('resolveChangelogSettings', () => {
  it('defaults to public audience, portal tab on, auto-subscribe on', () => {
    expect(resolveChangelogSettings(null)).toEqual(DEFAULT_CHANGELOG_SETTINGS)
    expect(resolveChangelogSettings('{}')).toEqual(DEFAULT_CHANGELOG_SETTINGS)
  })

  it('returns the stored metadata settings merged over defaults', () => {
    const meta = JSON.stringify({
      changelogSettings: { audience: 'authenticated', emailsDisabled: true },
    })
    expect(resolveChangelogSettings(meta)).toEqual({
      ...DEFAULT_CHANGELOG_SETTINGS,
      audience: 'authenticated',
      emailsDisabled: true,
    })
  })

  it('preserves sibling metadata keys (does not require exclusive ownership)', () => {
    const meta = JSON.stringify({
      officeHours: { enabled: true },
      changelogSettings: { portalTabEnabled: false },
    })
    expect(resolveChangelogSettings(meta).portalTabEnabled).toBe(false)
  })

  it('falls back to defaults on unparseable metadata rather than throwing', () => {
    expect(resolveChangelogSettings('not json')).toEqual(DEFAULT_CHANGELOG_SETTINGS)
  })

  it('ignores an invalid stored shape and falls back to defaults', () => {
    const meta = JSON.stringify({ changelogSettings: { audience: 'nope' } })
    expect(resolveChangelogSettings(meta)).toEqual(DEFAULT_CHANGELOG_SETTINGS)
  })
})
