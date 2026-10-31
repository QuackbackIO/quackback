/**
 * Which engine renders a workspace's portal. The legacy engine stays unless
 * the flag is on; then a published design wins, and a workspace with no
 * custom CSS is converted on read. The override forces legacy everywhere.
 */
import { describe, expect, it } from 'vitest'
import { defaultDesign } from '@/lib/shared/design/schema'
import { advancedCssRemainder, portalDesignView, resolveDesignSource } from '../engine'

const teal = () => {
  const doc = defaultDesign()
  doc.brand.light.accent = '#0f766e'
  return doc
}

const legacy = (customCss = '') => ({
  brandingConfig: { light: { primary: '#7a1f35' }, themeMode: 'light' as const },
  customCss,
})

describe('resolveDesignSource', () => {
  it('keeps legacy while the flag is off', () => {
    const source = resolveDesignSource({
      override: undefined,
      flagOn: false,
      published: { document: teal(), number: 3 },
      legacy: legacy(),
    })
    expect(source).toEqual({ engine: 'legacy' })
  })

  it('keeps legacy when the override says so, whatever the flag', () => {
    const source = resolveDesignSource({
      override: 'legacy',
      flagOn: true,
      published: { document: teal(), number: 3 },
      legacy: legacy(),
    })
    expect(source).toEqual({ engine: 'legacy' })
  })

  it('renders the published design', () => {
    const source = resolveDesignSource({
      override: undefined,
      flagOn: true,
      published: { document: teal(), number: 3 },
      legacy: legacy('.post-card { color: red }'),
    })
    expect(source).toMatchObject({ engine: 'v2', revision: 3 })
    expect(source.engine === 'v2' && source.doc.brand.light.accent).toBe('#0f766e')
  })

  it('converts a workspace without custom CSS on read', () => {
    const source = resolveDesignSource({
      override: undefined,
      flagOn: true,
      published: null,
      legacy: legacy('  /* nothing yet */\n'),
    })
    expect(source).toMatchObject({ engine: 'v2', revision: null })
    expect(source.engine === 'v2' && source.doc.brand.light.accent).toBe('#7a1f35')
    expect(source.engine === 'v2' && source.doc.mode).toBe('light')
  })

  it('keeps legacy for a workspace with custom CSS and no published design', () => {
    const source = resolveDesignSource({
      override: undefined,
      flagOn: true,
      published: null,
      legacy: legacy('.post-card { color: red }'),
    })
    expect(source).toEqual({ engine: 'legacy' })
  })
})

describe('advancedCssRemainder', () => {
  it('ignores comments and whitespace', () => {
    expect(advancedCssRemainder(' /* a */ \n /* b\n c */ ')).toBe('')
    expect(advancedCssRemainder('a { color: red }')).toBe('a { color: red }')
  })
})

describe('portalDesignView', () => {
  it('says nothing for legacy', () => {
    expect(portalDesignView({ engine: 'legacy' })).toEqual({ engine: 'legacy' })
  })

  it('carries the mode, the scoped theme and the design CSS in its own layer', () => {
    const doc = teal()
    doc.mode = 'dark'
    doc.css = '.qb-post-card { border-width: 2px }'
    const view = portalDesignView({ engine: 'v2', doc, revision: 4 })
    expect(view).toMatchObject({ engine: 'v2', mode: 'dark', revision: 4 })
    if (view.engine !== 'v2') throw new Error('expected v2')
    expect(view.themeStyles).toContain('[data-portal-theme] {')
    expect(view.customCss).toBe('@layer tenant {\n.qb-post-card { border-width: 2px }\n}')
    expect(view.fontIds).toEqual(['inter'])
  })

  it('has no design CSS when the design has none', () => {
    const view = portalDesignView({ engine: 'v2', doc: teal(), revision: null })
    expect(view.engine === 'v2' && view.customCss).toBe('')
  })
})
