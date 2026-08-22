import { describe, it, expect } from 'vitest'
import { resolveChangelogSettings } from '../settings.changelog'
import {
  changelogSettingsSchema,
  DEFAULT_CHANGELOG_SETTINGS,
} from '@/lib/shared/changelog-settings'
import { statusSettingsSchema } from '@/lib/shared/status-settings'

describe('resolveChangelogSettings', () => {
  it('defaults to public audience and auto-subscribe on', () => {
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
      changelogSettings: { autoSubscribe: false },
    })
    expect(resolveChangelogSettings(meta).autoSubscribe).toBe(false)
  })

  it('ignores deprecated portalTabEnabled and collaborationDisabled at read time', () => {
    const meta = JSON.stringify({
      changelogSettings: { portalTabEnabled: false, collaborationDisabled: true },
    })
    expect(resolveChangelogSettings(meta)).toEqual(DEFAULT_CHANGELOG_SETTINGS)
  })

  it('falls back to defaults on unparseable metadata rather than throwing', () => {
    expect(resolveChangelogSettings('not json')).toEqual(DEFAULT_CHANGELOG_SETTINGS)
  })

  it('ignores an invalid stored shape and falls back to defaults', () => {
    const meta = JSON.stringify({ changelogSettings: { audience: 'nope' } })
    expect(resolveChangelogSettings(meta)).toEqual(DEFAULT_CHANGELOG_SETTINGS)
  })
})

describe('changelogSettingsSchema', () => {
  it('strips deprecated portalTabEnabled and collaborationDisabled on write', () => {
    const parsed = changelogSettingsSchema.parse({
      portalTabEnabled: false,
      collaborationDisabled: true,
      autoSubscribe: false,
    })
    expect(parsed).toEqual({ autoSubscribe: false })
    expect(parsed).not.toHaveProperty('portalTabEnabled')
    expect(parsed).not.toHaveProperty('collaborationDisabled')
  })
})

describe('statusSettingsSchema', () => {
  it('strips deprecated portalTabEnabled on write', () => {
    const parsed = statusSettingsSchema.parse({
      portalTabEnabled: false,
      audience: 'authenticated',
    })
    expect(parsed).toEqual({ audience: 'authenticated' })
    expect(parsed).not.toHaveProperty('portalTabEnabled')
  })
})
