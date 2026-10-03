import { describe, it, expect } from 'vitest'
import {
  normalizeLocale,
  resolveLocale,
  isRtlLocale,
  SUPPORTED_LOCALES,
  DEFAULT_LOCALE,
  isViewerMessage,
  loadMessages,
  loadPortalMessages,
  loadViewerMessages,
  loadWidgetMessages,
  withoutViewerMessages,
  loadAskMessages,
  isAskMessage,
  adminSeedMessages,
  isTourMessage,
  loadTourMessages,
} from '../i18n'

describe('normalizeLocale', () => {
  it('returns exact match for supported locale', () => {
    expect(normalizeLocale('en')).toBe('en')
    expect(normalizeLocale('de')).toBe('de')
    expect(normalizeLocale('ru')).toBe('ru')
  })
  it('strips region to find base locale', () => {
    expect(normalizeLocale('fr-FR')).toBe('fr')
    expect(normalizeLocale('de-AT')).toBe('de')
    expect(normalizeLocale('ru-RU')).toBe('ru')
  })
  it('returns null for locales without message catalogs', () => {
    expect(normalizeLocale('ja-JP')).toBeNull()
    expect(normalizeLocale('it')).toBeNull()
  })
  it('returns null for unsupported locale', () => {
    expect(normalizeLocale('zz')).toBeNull()
    expect(normalizeLocale('xx-YY')).toBeNull()
  })
  it('handles case insensitivity', () => {
    expect(normalizeLocale('EN')).toBe('en')
    expect(normalizeLocale('FR-fr')).toBe('fr')
  })
  it('returns null for empty or invalid input', () => {
    expect(normalizeLocale('')).toBeNull()
    expect(normalizeLocale('not-a-locale-at-all')).toBeNull()
  })
  // Chinese is script-sensitive: Simplified and Traditional are distinct
  // catalogs, so a bare "zh" or region/script subtags must resolve to the
  // right variant rather than collapsing to a non-existent "zh" catalog.
  it('maps Simplified Chinese tags to zh-cn', () => {
    expect(normalizeLocale('zh')).toBe('zh-cn')
    expect(normalizeLocale('zh-CN')).toBe('zh-cn')
    expect(normalizeLocale('zh-Hans')).toBe('zh-cn')
    expect(normalizeLocale('zh-Hans-CN')).toBe('zh-cn')
    expect(normalizeLocale('zh-SG')).toBe('zh-cn')
  })
  it('lets an explicit script subtag win over region', () => {
    // Hans in a Traditional-script region is still Simplified, and vice versa.
    expect(normalizeLocale('zh-Hans-HK')).toBe('zh-cn')
    expect(normalizeLocale('zh-Hans-TW')).toBe('zh-cn')
    expect(normalizeLocale('zh-Hant-CN')).toBe('zh-tw')
  })
  it('maps Traditional Chinese tags to zh-tw', () => {
    expect(normalizeLocale('zh-TW')).toBe('zh-tw')
    expect(normalizeLocale('zh-Hant')).toBe('zh-tw')
    expect(normalizeLocale('zh-Hant-TW')).toBe('zh-tw')
    expect(normalizeLocale('zh-HK')).toBe('zh-tw')
    expect(normalizeLocale('zh-MO')).toBe('zh-tw')
  })
  it('handles Chinese tags case-insensitively', () => {
    expect(normalizeLocale('ZH-cn')).toBe('zh-cn')
    expect(normalizeLocale('zh-hant')).toBe('zh-tw')
    expect(normalizeLocale('ZH-HANT-tw')).toBe('zh-tw')
  })
  it('falls back to Simplified for irregular zh tags Intl cannot parse', () => {
    // e.g. Min Nan / Cantonese extlang forms — degrade rather than throw.
    expect(normalizeLocale('zh-min-nan')).toBe('zh-cn')
    expect(normalizeLocale('zh-yue')).toBe('zh-cn')
  })
  it('maps Dutch and Flemish tags to nl', () => {
    expect(normalizeLocale('nl')).toBe('nl')
    expect(normalizeLocale('nl-NL')).toBe('nl')
    expect(normalizeLocale('nl-BE')).toBe('nl')
    expect(normalizeLocale('NL-nl')).toBe('nl')
  })
  it('maps Polish tags to pl', () => {
    expect(normalizeLocale('pl')).toBe('pl')
    expect(normalizeLocale('pl-PL')).toBe('pl')
    expect(normalizeLocale('PL-pl')).toBe('pl')
  })
})

describe('resolveLocale', () => {
  it('returns first supported locale from Accept-Language header', () => {
    expect(resolveLocale('fr-FR,fr;q=0.9,en;q=0.8')).toBe('fr')
    expect(resolveLocale('de,en;q=0.5')).toBe('de')
    expect(resolveLocale('ru-RU,ru;q=0.9,en;q=0.8')).toBe('ru')
  })
  it('falls back to default when no supported locale found', () => {
    expect(resolveLocale('zz,xx;q=0.5')).toBe('en')
    expect(resolveLocale('')).toBe('en')
    expect(resolveLocale(null)).toBe('en')
  })
  it('respects quality weights', () => {
    expect(resolveLocale('en;q=0.5,de;q=0.9')).toBe('de')
  })
  it('ignores entries marked not-acceptable with q=0', () => {
    // RFC 7231: q=0 means the client explicitly rejects that language.
    expect(resolveLocale('de;q=0')).toBe('en')
    expect(resolveLocale('de;q=0,fr;q=0.5')).toBe('fr')
  })
  it('returns explicit locale when provided', () => {
    expect(resolveLocale('de,en;q=0.5', 'fr')).toBe('fr')
  })
  it('falls back to header when explicit locale is unsupported', () => {
    expect(resolveLocale('de,en;q=0.5', 'zz')).toBe('de')
  })
  it('resolves Chinese variants from the header', () => {
    expect(resolveLocale('zh-CN,zh;q=0.9,en;q=0.8')).toBe('zh-cn')
    expect(resolveLocale('zh-TW,zh;q=0.9,en;q=0.8')).toBe('zh-tw')
    expect(resolveLocale('zh-Hant-HK,zh;q=0.8')).toBe('zh-tw')
  })
  it('resolves Dutch from the header', () => {
    expect(resolveLocale('nl-NL,nl;q=0.9,en-US;q=0.8,en;q=0.7')).toBe('nl')
    expect(resolveLocale('nl-BE,fr-BE;q=0.8')).toBe('nl')
    expect(resolveLocale('en', 'nl')).toBe('nl')
  })
  it('resolves Polish from the header', () => {
    expect(resolveLocale('pl-PL,pl;q=0.9,en-US;q=0.8,en;q=0.7')).toBe('pl')
    expect(resolveLocale('pl,de;q=0.8')).toBe('pl')
    expect(resolveLocale('en', 'pl')).toBe('pl')
  })
  it('respects an explicit Chinese locale override', () => {
    expect(resolveLocale('en', 'zh-Hant')).toBe('zh-tw')
    expect(resolveLocale('en', 'zh-CN')).toBe('zh-cn')
  })
})

describe('isRtlLocale', () => {
  it('returns true for RTL locales', () => {
    expect(isRtlLocale('ar')).toBe(true)
    expect(isRtlLocale('he')).toBe(true)
    expect(isRtlLocale('fa')).toBe(true)
    expect(isRtlLocale('ur')).toBe(true)
  })
  it('returns false for LTR locales', () => {
    expect(isRtlLocale('en')).toBe(false)
    expect(isRtlLocale('fr')).toBe(false)
    expect(isRtlLocale('de')).toBe(false)
  })
})

describe('SUPPORTED_LOCALES', () => {
  it('includes en as default', () => {
    expect(SUPPORTED_LOCALES).toContain('en')
  })
  it('includes ru', () => {
    expect(SUPPORTED_LOCALES).toContain('ru')
  })
  it('includes Simplified and Traditional Chinese', () => {
    expect(SUPPORTED_LOCALES).toContain('zh-cn')
    expect(SUPPORTED_LOCALES).toContain('zh-tw')
  })
  it('includes nl', () => {
    expect(SUPPORTED_LOCALES).toContain('nl')
  })
  it('includes pl', () => {
    expect(SUPPORTED_LOCALES).toContain('pl')
  })
  it('DEFAULT_LOCALE is en', () => {
    expect(DEFAULT_LOCALE).toBe('en')
  })
})

describe('viewer strings', () => {
  it('are left out of the catalogs pages seed and kept for the viewer', async () => {
    const [all, widget, portal, viewer] = await Promise.all([
      loadMessages('de'),
      loadWidgetMessages('de'),
      loadPortalMessages('de'),
      loadViewerMessages('de'),
    ])
    for (const seeded of [widget, portal, withoutViewerMessages(all)]) {
      expect(Object.keys(seeded).filter(isViewerMessage)).toEqual([])
      expect(seeded['files.download']).toBe(all['files.download'])
    }
    expect(viewer['files.viewer.close']).toBe('Schließen')
    expect(Object.keys(viewer).length).toBeGreaterThan(0)
    expect(Object.keys(viewer).every(isViewerMessage)).toBe(true)
    expect(Object.keys(viewer).length + Object.keys(withoutViewerMessages(all)).length).toBe(
      Object.keys(all).length
    )
  })

  it('leaves Copilot and search strings to the chunks that render them', async () => {
    const all = await loadMessages('fr')
    const seeded = adminSeedMessages(all)
    const ask = await loadAskMessages('fr')
    expect(Object.keys(seeded).filter(isAskMessage)).toEqual([])
    // The sidebar Search row renders on every admin page.
    expect(seeded['ask.search.row']).toBe(all['ask.search.row'])
    expect(ask['ask.chat.newChat']).toBe(all['ask.chat.newChat'])
    expect(ask['ask.destination.settings_portal']).toBe(all['ask.destination.settings_portal'])
    expect(Object.keys(ask).every(isAskMessage)).toBe(true)
  })
})

describe('admin seed', () => {
  it('leaves out the viewer, tour overlay and wizard strings and keeps the rest', async () => {
    const [all, tour] = await Promise.all([loadMessages('de'), loadTourMessages('de')])
    const seeded = adminSeedMessages(all)
    expect(Object.keys(seeded).filter(isViewerMessage)).toEqual([])
    expect(Object.keys(seeded).filter(isTourMessage)).toEqual([])
    expect(seeded['onboarding.goals.title']).toBeUndefined()
    expect(seeded['onboarding.workspace.title']).toBeUndefined()
    // The tour's entry points and the launch plan stay seeded.
    expect(seeded['onboarding.tour.replay']).toBe(all['onboarding.tour.replay'])
    expect(seeded['onboarding.launch.title']).toBe(all['onboarding.launch.title'])
    expect(seeded['files.download']).toBe(all['files.download'])
    expect(tour['onboarding.tour.next']).toBe(all['onboarding.tour.next'])
    expect(Object.keys(tour).every(isTourMessage)).toBe(true)
    expect(Object.keys(tour).length).toBeGreaterThan(20)
  })
})
