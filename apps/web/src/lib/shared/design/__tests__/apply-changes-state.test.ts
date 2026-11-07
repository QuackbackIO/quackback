/**
 * Plain text writes the language a person sees, and a change made earlier can
 * be told apart as still applied, undone, or changed since.
 */
import { describe, expect, it } from 'vitest'
import { defaultDesign } from '@/lib/shared/design/schema'
import { applyDesignChanges, changeState } from '../apply-changes'

const untrusted = { blockTypes: [], links: new Set<string>(), checkCss: () => null }

describe('plain text by language', () => {
  it('writes the language given, and keeps the others', () => {
    const start = applyDesignChanges(
      defaultDesign(),
      [{ path: 'pages.feedback.headline.title', value: 'Shape what we build' }],
      'site'
    ).design
    const { design } = applyDesignChanges(
      start,
      [{ path: 'pages.feedback.headline.title', value: 'Gestalte mit uns' }],
      'site',
      { ...untrusted, language: 'de' }
    )
    expect(design.pages.feedback.headline?.title).toEqual({
      en: 'Shape what we build',
      de: 'Gestalte mit uns',
    })
  })

  it('writes English when no language is given', () => {
    const { design } = applyDesignChanges(
      defaultDesign(),
      [{ path: 'pages.feedback.headline.title', value: 'Hello' }],
      'site',
      untrusted
    )
    expect(design.pages.feedback.headline?.title).toEqual({ en: 'Hello' })
  })
})

describe('changeState', () => {
  const made = applyDesignChanges(
    defaultDesign(),
    [
      { path: 'brand.light.accent', value: '#0f766e' },
      { path: 'brand.fonts.heading', value: 'fraunces' },
    ],
    'site'
  )
  const [accent, font] = made.applied

  it('is applied while the draft holds the change, keys in any order', () => {
    const saved = structuredClone(made.design)
    saved.brand.fonts.heading = { id: 'fraunces', kind: 'bundled' } as never
    expect(changeState(saved, accent!)).toBe('applied')
    expect(changeState(saved, font!)).toBe('applied')
  })

  it('is applied straight after any change, however the draft stores the value', () => {
    const result = applyDesignChanges(
      defaultDesign(),
      [
        { path: 'brand.light.accent', value: '#0F766E' },
        { path: 'brand.fonts.body', value: 'fraunces' },
        { path: 'layout.cards', value: 'raised' },
        { path: 'pages.feedback.headline.title', value: 'Shape what we build' },
        { path: 'tune.headline', value: { size: 64, weight: 700 } },
        { path: 'tune.button.radius', value: 999 },
        { path: 'pages.feedback.welcome', value: { show: true, body: 'Hello\n\nThere' } },
        { path: 'brand.logo.tone', value: 'dark' },
      ],
      'site'
    )
    expect(result.applied.length).toBeGreaterThan(6)
    for (const change of result.applied)
      expect(changeState(result.design, change), change.path).toBe('applied')
  })

  it('is undone once the draft is back to the value before', () => {
    expect(changeState(defaultDesign(), accent!)).toBe('undone')
  })

  it('is changed when the draft has moved on to another value', () => {
    const later = structuredClone(made.design)
    later.brand.light.accent = '#ff0000'
    expect(changeState(later, accent!)).toBe('changed')
  })
})
