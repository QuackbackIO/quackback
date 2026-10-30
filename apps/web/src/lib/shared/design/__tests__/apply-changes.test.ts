/**
 * Quackback AI changes the draft through a short list of design fields. Each
 * change is applied on its own and kept only when the design stays valid and
 * readable; a change outside the scope a person picked is never applied.
 */
import { describe, expect, it } from 'vitest'
import { defaultDesign } from '@/lib/shared/design/schema'
import { applyDesignChanges, DESIGN_AI_PATHS, scopeFields } from '../apply-changes'

describe('applyDesignChanges', () => {
  it('applies colours, fonts and layout, and reports each one', () => {
    const result = applyDesignChanges(
      defaultDesign(),
      [
        { path: 'brand.light.accent', value: '#0F766E' },
        { path: 'brand.fonts.heading', value: 'fraunces' },
        { path: 'layout.cards', value: 'raised' },
        { path: 'pages.feedback.headline.title', value: 'Shape what we build' },
      ],
      'site'
    )
    expect(result.design.brand.light.accent).toBe('#0f766e')
    expect(result.design.brand.fonts.heading).toEqual({ kind: 'bundled', id: 'fraunces' })
    expect(result.design.layout.cards).toBe('raised')
    expect(result.design.pages.feedback.headline?.title.en).toBe('Shape what we build')
    expect(result.applied.map((change) => change.path)).toEqual([
      'brand.light.accent',
      'brand.fonts.heading',
      'layout.cards',
      'pages.feedback.headline.title',
    ])
    expect(result.applied[0]).toMatchObject({ before: 'oklch(0.886 0.176 86)', after: '#0f766e' })
  })

  it('skips a path it does not offer, such as CSS', () => {
    const result = applyDesignChanges(
      defaultDesign(),
      [
        { path: 'css', value: 'body { display: none }' },
        { path: 'brand.logo.display', value: 'mark' },
      ],
      'site'
    )
    expect(result.applied).toEqual([])
    expect(result.skipped).toBe(2)
    expect(result.design.css).toBeUndefined()
  })

  it('skips a value the design does not allow, and keeps the rest', () => {
    const result = applyDesignChanges(
      defaultDesign(),
      [
        { path: 'layout.cards', value: 'floating' },
        { path: 'brand.light.accent', value: 'red' },
        { path: 'layout.density', value: 'compact' },
      ],
      'site'
    )
    expect(result.applied.map((change) => change.path)).toEqual(['layout.density'])
    expect(result.skipped).toBe(2)
  })

  it('skips a change that would make text unreadable', () => {
    const result = applyDesignChanges(
      defaultDesign(),
      [{ path: 'brand.light.ink', value: '#fdfdfd' }],
      'site'
    )
    expect(result.applied).toEqual([])
    expect(result.design.brand.light.ink).toBe('#0a0a0a')
  })

  it('stays inside the section a person picked', () => {
    const result = applyDesignChanges(
      defaultDesign(),
      [
        { path: 'layout.nav', value: 'pills' },
        { path: 'layout.cards', value: 'list' },
      ],
      'header'
    )
    expect(result.applied.map((change) => change.path)).toEqual(['layout.nav'])
    expect(result.design.layout.cards).toBe('bordered')
  })

  it('clears an optional colour with null, and refuses to clear a required one', () => {
    const doc = defaultDesign()
    doc.brand.light.surface = '#fafafa'
    const cleared = applyDesignChanges(
      doc,
      [
        { path: 'brand.light.surface', value: null },
        { path: 'brand.light.ink', value: null },
      ],
      'site'
    )
    expect(cleared.design.brand.light.surface).toBeUndefined()
    expect(cleared.design.brand.light.ink).toBe('#0a0a0a')
    expect(cleared.applied.map((change) => change.path)).toEqual(['brand.light.surface'])
  })

  it('writes the subtitle to the subtitle and the headline to the headline', () => {
    const result = applyDesignChanges(
      defaultDesign(),
      [
        { path: 'pages.feedback.headline.title', value: 'Help shape Ledger' },
        { path: 'pages.feedback.headline.subtitle', value: 'Tell us what would help.' },
      ],
      'site'
    )
    expect(result.design.pages.feedback.headline).toEqual({
      title: { en: 'Help shape Ledger' },
      subtitle: { en: 'Tell us what would help.' },
    })
    expect(result.applied[1]).toEqual({
      path: 'pages.feedback.headline.subtitle',
      before: null,
      after: 'Tell us what would help.',
    })
  })

  it('names the changes it left alone for being outside the section', () => {
    const result = applyDesignChanges(
      defaultDesign(),
      [
        { path: 'layout.band', value: 'brand' },
        { path: 'layout.nav', value: 'pills' },
        { path: 'css', value: 'body {}' },
      ],
      'header'
    )
    expect(result.outOfScope).toEqual(['layout.band'])
    expect(result.applied.map((change) => change.path)).toEqual(['layout.nav'])
  })

  it('writes the welcome message as paragraphs, and reads it back as text', () => {
    const result = applyDesignChanges(
      defaultDesign(),
      [
        { path: 'pages.feedback.welcome.show', value: true },
        { path: 'pages.feedback.welcome.body', value: 'Welcome!\n\nTell us what would help.' },
      ],
      'welcome'
    )
    expect(result.design.pages.feedback.welcome.body).toEqual({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Welcome!' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Tell us what would help.' }] },
      ],
    })
    expect(result.applied[1]).toEqual({
      path: 'pages.feedback.welcome.body',
      before: null,
      after: 'Welcome!\n\nTell us what would help.',
    })
  })

  it('lists the fields each section reaches', () => {
    expect(scopeFields('header')).toEqual(['layout.header', 'layout.nav'])
    expect(scopeFields('site')).toEqual([...DESIGN_AI_PATHS])
  })

  it('offers every path a scope names', () => {
    expect(DESIGN_AI_PATHS).toContain('pages.feedback.defaultSort')
    expect(DESIGN_AI_PATHS).not.toContain('css')
  })
})
