/**
 * Every portal page asks one helper what to inject. On legacy it is exactly
 * what the pages computed before; on v2 it is the chosen design's.
 */
import { describe, expect, it } from 'vitest'
import { generateWorkspaceThemeCSS } from '@/lib/shared/theme'
import { portalFontIds, portalTheme, portalThemeMode } from '../view'

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
      },
    })
    expect(portalThemeMode(v2('auto'))).toBe('user')
    expect(portalThemeMode(v2('light'))).toBe('light')
    expect(portalThemeMode({ brandingConfig: { themeMode: 'light' }, ...v2('dark') })).toBe('dark')
    expect(portalThemeMode({ brandingConfig: { themeMode: 'light' } })).toBe('light')
  })
})
