/**
 * Every portal page asks one helper what to inject. On legacy it is exactly
 * what the pages computed before; on v2 it is the chosen design's.
 */
import { describe, expect, it } from 'vitest'
import { generateWorkspaceThemeCSS } from '@/lib/shared/theme'
import { defaultDesign } from '../schema'
import {
  portalDefaultSort,
  portalFontIds,
  portalTheme,
  portalThemeMode,
  savedWelcomeCard,
} from '../view'

const brandingConfig = {
  themeMode: 'dark' as const,
  light: { primary: '#0f766e', fontSans: '"Inter", sans-serif' },
}

describe('portalTheme', () => {
  it('keeps today’s output on legacy', () => {
    expect(portalTheme({ brandingConfig, customCss: '.x { color: red }' })).toEqual({
      themeMode: 'dark',
      themeStyles: generateWorkspaceThemeCSS(brandingConfig),
      customCss: '.x { color: red }',
      configFontSans: '"Inter", sans-serif',
    })
    expect(portalTheme(null)).toEqual({
      themeMode: 'user',
      themeStyles: generateWorkspaceThemeCSS({}),
      customCss: '',
      configFontSans: null,
    })
  })

  it('uses the design on v2 and ignores the legacy settings', () => {
    const portalDesign = {
      engine: 'v2' as const,
      mode: 'auto' as const,
      revision: 2,
      themeStyles: '[data-portal-theme] { --qb-accent: #7a1f35; }',
      customCss: '',
      fontSans: '"Fraunces", serif',
      fontIds: ['fraunces'],
      attributes: {},
      feedback: { welcome: null, headline: null, defaultSort: 'trending' as const, copy: {} },
      home: { headline: null, blocks: [] },
      nav: defaultDesign().nav,
      vocabulary: { post: 'idea' as const, board: 'board' as const },
    }
    expect(portalTheme({ brandingConfig, customCss: '.x {}', portalDesign })).toEqual({
      themeMode: 'user',
      themeStyles: portalDesign.themeStyles,
      customCss: '',
      configFontSans: '"Fraunces", serif',
    })
  })
})

describe('portalFontIds', () => {
  it('names the design’s families on v2 and none on legacy, which reads its CSS', () => {
    expect(portalFontIds({ brandingConfig })).toEqual([])
    const portalDesign = {
      engine: 'v2' as const,
      mode: 'auto' as const,
      revision: null,
      themeStyles: '',
      customCss: '',
      fontSans: '',
      fontIds: ['inter', 'fraunces'],
      attributes: {},
      feedback: { welcome: null, headline: null, defaultSort: 'trending' as const, copy: {} },
      home: { headline: null, blocks: [] },
      nav: defaultDesign().nav,
      vocabulary: { post: 'idea' as const, board: 'board' as const },
    }
    expect(portalFontIds({ portalDesign })).toEqual(['inter', 'fraunces'])
  })
})

describe('portalThemeMode', () => {
  it('maps a design’s mode to the forced theme', () => {
    const v2 = (mode: 'auto' | 'light' | 'dark') => ({
      portalDesign: {
        engine: 'v2' as const,
        mode,
        revision: null,
        themeStyles: '',
        customCss: '',
        fontSans: '',
        fontIds: [],
        attributes: {},
        feedback: { welcome: null, headline: null, defaultSort: 'trending' as const, copy: {} },

        home: { headline: null, blocks: [] },
        nav: defaultDesign().nav,
        vocabulary: { post: 'idea' as const, board: 'board' as const },
      },
    })
    expect(portalThemeMode(v2('auto'))).toBe('user')
    expect(portalThemeMode(v2('light'))).toBe('light')
    expect(portalThemeMode({ brandingConfig: { themeMode: 'light' }, ...v2('dark') })).toBe('dark')
    expect(portalThemeMode({ brandingConfig: { themeMode: 'light' } })).toBe('light')
  })
})

describe('savedWelcomeCard', () => {
  const legacy = { body: { type: 'doc', content: [] } }
  const v2 = (welcome: unknown) =>
    ({
      engine: 'v2',
      mode: 'auto',
      revision: 1,
      themeStyles: '',
      customCss: '',
      fontSans: '',
      fontIds: [],
      attributes: {},
      feedback: { welcome, headline: null, defaultSort: 'trending', copy: {} },
    }) as never

  it('keeps the portal settings’ card on legacy', () => {
    expect(savedWelcomeCard(undefined, legacy)).toBe(legacy)
    expect(savedWelcomeCard({ engine: 'legacy' }, legacy)).toBe(legacy)
  })

  it('takes the design’s message on v2, and nothing when it is off', () => {
    const body = { type: 'doc', content: [{ type: 'paragraph' }] }
    expect(savedWelcomeCard(v2(body), legacy)).toEqual({ body })
    expect(savedWelcomeCard(v2(null), legacy)).toBeUndefined()
  })
})

describe('portalDefaultSort', () => {
  it('is trending on legacy and the design’s choice on v2', () => {
    expect(portalDefaultSort(undefined)).toBe('trending')
    expect(portalDefaultSort({ portalDesign: { engine: 'legacy' } })).toBe('trending')
    const portalDesign = {
      engine: 'v2' as const,
      mode: 'auto' as const,
      revision: 1,
      themeStyles: '',
      customCss: '',
      fontSans: '',
      fontIds: [],
      attributes: {},
      feedback: { welcome: null, headline: null, defaultSort: 'new' as const, copy: {} },
      home: { headline: null, blocks: [] },
      nav: defaultDesign().nav,
      vocabulary: { post: 'idea' as const, board: 'board' as const },
    }
    expect(portalDefaultSort({ portalDesign })).toBe('new')
  })
})
