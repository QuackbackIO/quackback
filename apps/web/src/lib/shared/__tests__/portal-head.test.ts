import { describe, expect, it } from 'vitest'
import { designView } from '@/lib/shared/design/design-view'
import { defaultDesign } from '@/lib/shared/design/schema'
import { SUPPORTED_LOCALES } from '@/lib/shared/i18n'
import { portalHeadTemplates } from '@/lib/server/domains/settings/portal-head-words'
import {
  pageShareMeta,
  pageTitle,
  portalFavicon,
  portalHeadWords,
  portalMainLanguage,
  portalShareImage,
  portalSiteName,
  portalThemeColors,
  type PortalHeadSettings,
} from '../portal-head'

function withDesign(edit: (doc: ReturnType<typeof defaultDesign>) => void = () => {}) {
  const doc = defaultDesign()
  edit(doc)
  return { name: 'Acme Corp', portalDesign: designView(doc, 3) } satisfies PortalHeadSettings
}

describe('portalSiteName', () => {
  it('is the Brand kit title, as the header shows it, else the workspace name', () => {
    expect(portalSiteName(withDesign((doc) => (doc.brand.logo.name = 'GitHub')))).toBe('GitHub')
    expect(portalSiteName(withDesign())).toBe('Acme Corp')
    expect(portalSiteName({ name: 'Acme Corp', portalDesign: { engine: 'legacy' } })).toBe(
      'Acme Corp'
    )
  })
})

describe('portalMainLanguage', () => {
  it('is the language the workspace states, else English', () => {
    expect(portalMainLanguage({ helpCenterConfig: { locales: { default: 'de' } } })).toBe('de')
    expect(portalMainLanguage({ helpCenterConfig: { locales: { default: 'pt' } } })).toBe('pt-br')
    expect(portalMainLanguage({})).toBe('en')
  })

  it('writes the head in it, whoever is visiting', () => {
    const helpCenterConfig = { locales: { default: 'fr' } }
    // The server puts the main language's words in the settings, as getWorkspaceSettings does.
    const settings = {
      ...withDesign(),
      helpCenterConfig,
      portalHeadWords: portalHeadTemplates({ helpCenterConfig }),
    }
    expect(pageTitle(settings, 'roadmap')).toBe('Feuille de route - Acme Corp')
    expect(portalHeadWords(settings).changelog('Acme')).toBe('Les dernières nouveautés de Acme.')
  })
})

describe('the head words', () => {
  it('speak of posts and feedback, never feature requests or ideas', () => {
    const english = portalHeadWords({})
    const all = [
      english.portal('Acme'),
      english.feedback('Acme'),
      english.roadmap('Acme'),
      english.changelog('Acme'),
      english.entry('Dark mode', 'Acme'),
      english.status('Acme'),
      english.incident('Outage', 'Acme'),
      english.post('Dark mode', 'Bugs'),
    ].join(' ')
    expect(all).not.toMatch(/feature request|idea/i)
    expect(english.portal('Acme')).toMatch(/posts/)
  })

  it('fall back to English when the settings carry none, such as settings cached before', () => {
    expect(
      portalHeadWords({ helpCenterConfig: { locales: { default: 'fr' } } }).pages.roadmap
    ).toBe('Roadmap')
  })

  it('have every page and description in every language, with the name in each', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const helpCenterConfig = { locales: { default: locale } }
      const words = portalHeadWords({
        helpCenterConfig,
        portalHeadWords: portalHeadTemplates({ helpCenterConfig }),
      })
      expect(words.portal('ZZNAME')).toContain('ZZNAME')
      expect(words.entry('ZZTITLE', 'ZZNAME')).toContain('ZZTITLE')
      expect(Object.values(words.pages).every((name) => name.length > 0)).toBe(true)
      expect(words.portal('x')).not.toMatch(/—/)
    }
  })
})

describe('portalFavicon', () => {
  it('runs from the design favicon to the brand icon, the workspace logo, then the default', () => {
    const icon = (doc: ReturnType<typeof defaultDesign>) =>
      (doc.brand.logo.mark.light = { key: 'logos/i.png' })
    const both = withDesign((doc) => {
      icon(doc)
      doc.brand.favicon = { key: 'favicons/f.png' }
    })
    expect(portalFavicon(both)).toBe('/api/storage/favicons/f.png')
    expect(portalFavicon(withDesign(icon))).toMatch(/^\/brand\.png\?v=\w+&kind=icon$/)
    const logo = { brandingData: { logoUrl: '/api/storage/logo.png' } }
    expect(portalFavicon({ ...withDesign(), ...logo })).toBe('/api/storage/logo.png')
    expect(portalFavicon(withDesign())).toBe('/logo.png')
  })
})

describe('portalShareImage', () => {
  it('is the design’s own image where it has one', () => {
    const settings = withDesign((doc) => (doc.brand.shareImage = { key: 'portal-images/s.png' }))
    expect(portalShareImage(settings, 'https://acme.test')).toBe(
      'https://acme.test/api/storage/portal-images/s.png'
    )
    expect(pageShareMeta(settings, 'https://acme.test', 'roadmap')).toEqual([])
  })

  it('is the drawn card otherwise, never the default duck, with the page for a page', () => {
    const settings = withDesign()
    const site = portalShareImage(settings, 'https://acme.test')
    expect(site).toMatch(/^https:\/\/acme\.test\/brand\.png\?v=\w+$/)
    expect(pageShareMeta(settings, 'https://acme.test', 'roadmap')).toEqual([
      { property: 'og:image', content: `${site}&page=roadmap` },
    ])
  })

  it('changes address when the title changes, so a cached card is never stale', () => {
    const a = portalShareImage(withDesign(), '')
    const b = portalShareImage(
      withDesign((doc) => (doc.brand.logo.name = 'Other')),
      ''
    )
    expect(a).not.toBe(b)
  })

  it('leaves a legacy portal to its own image', () => {
    expect(portalShareImage({ portalDesign: { engine: 'legacy' } }, 'https://acme.test')).toBeNull()
  })
})

describe('portalThemeColors', () => {
  it('gives the page colour per mode by media query, or the one mode a portal is fixed to', () => {
    const settings = withDesign((doc) => (doc.brand.light.background = '#fafafa'))
    const both = portalThemeColors(settings.portalDesign, undefined)
    expect(both).toHaveLength(2)
    expect(both[0]).toEqual({ content: '#fafafa', media: '(prefers-color-scheme: light)' })
    expect(both[1]!.media).toBe('(prefers-color-scheme: dark)')
    expect(portalThemeColors(settings.portalDesign, 'light')).toEqual([{ content: '#fafafa' }])
    expect(portalThemeColors({ engine: 'legacy' }, undefined)).toEqual([])
  })
})
