import { describe, expect, it } from 'vitest'
import { isSettingId, settingIdOf } from '../setting-ids'

describe('settingIdOf', () => {
  it('names a setting by its path in the design document', () => {
    expect(settingIdOf('layout.band')).toBe('layout.band')
    expect(settingIdOf('brand.light.accent')).toBe('brand.light.accent')
    expect(settingIdOf('tune.headline.size')).toBe('tune.headline.size')
    expect(settingIdOf('css')).toBe('css')
  })

  it('reads through optional, nullable and union parts', () => {
    expect(settingIdOf('brand.fonts.heading.id')).toBe('brand.fonts.heading.id')
    expect(settingIdOf('brand.dark.accent')).toBe('brand.dark.accent')
  })

  it('drops the keys of a map, which a person can choose', () => {
    expect(settingIdOf('pages.feedback.copy.prompt.en')).toBe('pages.feedback.copy.prompt')
    expect(settingIdOf('pages.feedback.copy.prompt.Our secret launch')).toBe(
      'pages.feedback.copy.prompt'
    )
  })

  it('stops at a list or at anything the schema does not name', () => {
    expect(settingIdOf('pages.home.blocks')).toBe('pages.home.blocks')
    expect(settingIdOf('pages.home.blocks.0.title')).toBe('pages.home.blocks')
    expect(settingIdOf('layout.Acme rebrand')).toBe('layout')
    expect(settingIdOf('Acme rebrand')).toBeNull()
  })
})

describe('isSettingId', () => {
  it('accepts only paths the schema names', () => {
    expect(isSettingId('layout.band')).toBe(true)
    expect(isSettingId('pages.feedback.copy.prompt')).toBe(true)
    expect(isSettingId('pages.feedback.copy.prompt.en')).toBe(false)
    expect(isSettingId('layout.Acme rebrand')).toBe(false)
    expect(isSettingId('https://example.com')).toBe(false)
    expect(isSettingId('')).toBe(false)
  })
})
