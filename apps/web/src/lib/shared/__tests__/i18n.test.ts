import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import {
  normalizeLocale,
  resolveLocale,
  isRtlLocale,
  SUPPORTED_LOCALES,
  DEFAULT_LOCALE,
  isViewerMessage,
  loadAreaMessages,
  loadMessages,
  loadPortalMessages,
  loadViewerMessages,
  loadWidgetMessages,
  isUnsubscribeMessage,
  loadUnsubscribeMessages,
  messageArea,
  withoutPageScopedMessages,
  isSetupWizardMessage,
  loadOnboardingMessages,
  SETUP_WIZARD_MESSAGE_PREFIXES,
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
  it('maps Thai tags to th', () => {
    expect(normalizeLocale('th')).toBe('th')
    expect(normalizeLocale('th-TH')).toBe('th')
    expect(normalizeLocale('TH-th')).toBe('th')
  })
  it('maps every Portuguese tag to pt-br, the only Portuguese catalog', () => {
    expect(normalizeLocale('pt-BR')).toBe('pt-br')
    expect(normalizeLocale('pt')).toBe('pt-br')
    expect(normalizeLocale('pt-PT')).toBe('pt-br')
    expect(normalizeLocale('PT-ao')).toBe('pt-br')
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
  it('resolves Thai from the header and explicit override', () => {
    expect(resolveLocale('th-TH,th;q=0.9,en;q=0.8')).toBe('th')
    expect(resolveLocale('en', 'th-TH')).toBe('th')
    expect(resolveLocale('th;q=0,en;q=0.5')).toBe('en')
  })
  it('resolves Portuguese from the header', () => {
    expect(resolveLocale('pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7')).toBe('pt-br')
    expect(resolveLocale('pt,en;q=0.8')).toBe('pt-br')
    expect(resolveLocale('pt-PT,pt;q=0.9,en;q=0.8')).toBe('pt-br')
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
    for (const seeded of [widget, portal, withoutPageScopedMessages(all)]) {
      expect(Object.keys(seeded).filter(isViewerMessage)).toEqual([])
      expect(seeded['files.download']).toBe(all['files.download'])
    }
    expect(viewer['files.viewer.close']).toBe('Schließen')
    expect(Object.keys(viewer).length).toBeGreaterThan(0)
    expect(Object.keys(viewer).every(isViewerMessage)).toBe(true)
  })
})

describe('unsubscribe page strings', () => {
  it('are seeded by that page alone, translated, and by no shared surface', async () => {
    const [all, widget, portal, unsubscribe] = await Promise.all([
      loadMessages('de'),
      loadWidgetMessages('de'),
      loadPortalMessages('de'),
      loadUnsubscribeMessages('de'),
    ])
    for (const seeded of [widget, portal, withoutPageScopedMessages(all)]) {
      expect(Object.keys(seeded).filter(isUnsubscribeMessage)).toEqual([])
    }
    expect(unsubscribe['unsubscribe.confirm.button']).toBe('Abmelden')
    expect(Object.keys(unsubscribe).every(isUnsubscribeMessage)).toBe(true)
  })

  it('leaves nothing out of the admin catalog but the page-scoped strings', async () => {
    const [all, viewer, unsubscribe] = await Promise.all([
      loadMessages('de'),
      loadViewerMessages('de'),
      loadUnsubscribeMessages('de'),
    ])
    const wizard = Object.keys(all).filter(isSetupWizardMessage)
    const areas = Object.keys(all).filter((key) => messageArea(key) !== null)
    expect(
      Object.keys(viewer).length +
        Object.keys(unsubscribe).length +
        wizard.length +
        areas.length +
        Object.keys(withoutPageScopedMessages(all)).length
    ).toBe(Object.keys(all).length)
  })
})

describe('setup wizard strings', () => {
  it('are seeded by the wizard and left out of the admin catalog', async () => {
    const [all, onboarding] = await Promise.all([loadMessages('de'), loadOnboardingMessages('de')])
    expect(Object.keys(withoutPageScopedMessages(all)).filter(isSetupWizardMessage)).toEqual([])
    const wizard = Object.keys(all).filter(isSetupWizardMessage)
    expect(wizard.length).toBeGreaterThan(0)
    for (const key of wizard) expect(onboarding[key]).toBe(all[key])
  })

  // Leaving them out of the admin catalog is only safe while nothing outside
  // the wizard renders them.
  it('are rendered by the wizard alone', () => {
    const src = join(__dirname, '../../..')
    const wizardDirs = ['routes/onboarding', 'components/onboarding']
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) {
          if (entry.name !== '__tests__' && entry.name !== 'locales') walk(path)
          continue
        }
        if (!/\.(tsx?|ts)$/.test(entry.name)) continue
        const rel = relative(src, path)
        if (wizardDirs.some((dir) => rel.startsWith(dir)) || rel === 'lib/shared/i18n.ts') continue
        const text = readFileSync(path, 'utf8')
        if (SETUP_WIZARD_MESSAGE_PREFIXES.some((prefix) => text.includes(`'${prefix}`)))
          offenders.push(rel)
      }
    }
    walk(src)
    expect(offenders).toEqual([])
  })
})

describe('area strings', () => {
  it('are left out of the catalogs pages seed and load for their area', async () => {
    const [all, widget, portal, settings] = await Promise.all([
      loadMessages('pl'),
      loadWidgetMessages('pl'),
      loadPortalMessages('pl'),
      loadAreaMessages('pl', 'settings', 'notificationPreferences'),
    ])
    for (const seeded of [widget, portal, withoutPageScopedMessages(all)]) {
      expect(Object.keys(seeded).filter((key) => messageArea(key) !== null)).toEqual([])
    }
    expect(portal['portal.header.nav.feedback']).toBe(all['portal.header.nav.feedback'])
    expect(settings['portal.settings.profile.avatar.title']).toBe('Awatar')
    expect(settings['portal.settings.notifications.channel.inApp']).toBe('W aplikacji')
    expect(
      Object.keys(settings).every((key) =>
        ['settings', 'notificationPreferences'].includes(messageArea(key) ?? '')
      )
    ).toBe(true)
  })

  it('puts a key in the first area whose prefix it has', () => {
    expect(messageArea('portal.settings.notifications.saving')).toBe('notificationPreferences')
    expect(messageArea('portal.settings.profile.title')).toBe('settings')
    expect(messageArea('portal.hc.home.title')).toBe('helpCenter')
    expect(messageArea('portal.auth.twoFactor.verify')).toBe('twoFactor')
    expect(messageArea('portal.auth.continue')).toBeNull()
    expect(messageArea('portal.header.nav.feedback')).toBeNull()
  })
})
