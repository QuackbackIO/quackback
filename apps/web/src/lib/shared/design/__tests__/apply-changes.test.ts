/**
 * Quackback AI changes the draft with one tool: any field of the design, by
 * its path. Each change is applied on its own and kept only when the design
 * stays valid and readable; a change outside the scope a person picked is
 * never applied, and the model's own changes bring in nothing the workspace
 * did not give it.
 */
import { describe, expect, it } from 'vitest'
import { defaultDesign } from '@/lib/shared/design/schema'
import { applyDesignChanges, docText, scopeFields } from '../apply-changes'

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

  it('sets the headlines’ own face by name, and gives them back the heading font with null', () => {
    const set = applyDesignChanges(
      defaultDesign(),
      [{ path: 'brand.fonts.display', value: 'oswald' }],
      'site'
    )
    expect(set.design.brand.fonts.display).toEqual({ kind: 'bundled', id: 'oswald' })
    const cleared = applyDesignChanges(
      set.design,
      [{ path: 'brand.fonts.display', value: null }],
      'site'
    )
    expect(cleared.design.brand.fonts.display).toBeUndefined()
  })

  it('refuses a field the design does not have, and a path that reaches outside it', () => {
    const result = applyDesignChanges(
      defaultDesign(),
      [
        { path: 'brand.gradient', value: 'linear-gradient(red, blue)' },
        { path: '__proto__.polluted', value: true },
        { path: 'layout.cards.inner', value: 1 },
        { path: 'brand.logo.display', value: 'mark' },
      ],
      'site'
    )
    expect(result.applied.map((change) => change.path)).toEqual(['brand.logo.display'])
    expect(result.refused.map((change) => change.path)).toEqual([
      'brand.gradient',
      '__proto__.polluted',
      'layout.cards.inner',
    ])
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
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
      before: {},
      after: { en: 'Tell us what would help.' },
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
    expect(result.outOfScope).toEqual(['layout.band', 'css'])
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
    expect(result.applied[1]?.path).toBe('pages.feedback.welcome.body')
    expect(docText(result.applied[1]?.after)).toBe('Welcome!\n\nTell us what would help.')
  })

  it('lists the fields each section reaches, and everything under them', () => {
    expect(scopeFields('header')).toEqual([
      'layout.header',
      'layout.nav',
      'layout.headerOnBand',
      'nav',
      'brand.logo',
    ])
    const home = applyDesignChanges(
      defaultDesign(),
      [
        { path: 'nav.home.on', value: true },
        { path: 'pages.home.blocks.0', value: { type: 'composer', width: 'full' } },
        { path: 'layout.cards', value: 'list' },
      ],
      'home'
    )
    expect(home.applied.map((change) => change.path)).toEqual([
      'nav.home.on',
      'pages.home.blocks.0',
    ])
    expect(home.outOfScope).toEqual(['layout.cards'])
  })

  it('undoes any change by writing back what was there, a removed field included', () => {
    const changed = applyDesignChanges(
      defaultDesign(),
      [
        { path: 'pages.feedback.copy.submit', value: 'Send it' },
        { path: 'nav.items', value: [{ type: 'feedback', shown: true }] },
      ],
      'site'
    )
    const undone = applyDesignChanges(
      changed.design,
      changed.applied.map((change) => ({ path: change.path, value: change.before })),
      'site'
    )
    expect(undone.design).toEqual(defaultDesign())
  })

  it('writes own wording and dark colours that are not there yet', () => {
    const result = applyDesignChanges(
      defaultDesign(),
      [
        { path: 'pages.feedback.copy.prompt', value: 'Pitch an idea' },
        { path: 'brand.dark.background', value: '#101614' },
      ],
      'site'
    )
    expect(result.refused).toEqual([])
    expect(result.design.pages.feedback.copy.prompt).toEqual({ en: 'Pitch an idea' })
    expect(result.design.brand.dark?.background).toBe('#101614')
  })

  it('places only files stored for the request, never one the model names', () => {
    const untrusted = {
      blockTypes: [],
      links: new Set<string>(),
      checkCss: () => null,
      files: new Set(['header-logos/site-abc.svg']),
    }
    const placed = applyDesignChanges(
      defaultDesign(),
      [
        { path: 'brand.logo.wordmark.light', value: { key: 'header-logos/site-abc.svg' } },
        { path: 'brand.logo.display', value: 'wordmark' },
      ],
      'site',
      untrusted
    )
    expect(placed.refused).toEqual([])
    expect(placed.design.brand.logo.wordmark.light).toEqual({ key: 'header-logos/site-abc.svg' })
    const named = applyDesignChanges(
      defaultDesign(),
      [{ path: 'brand.bandImage', value: { key: 'portal-images/other.jpg' } }],
      'site',
      untrusted
    )
    expect(named.refused).toEqual([
      { path: 'brand.bandImage', reason: 'images and fonts are uploaded in Brand' },
    ])
  })

  it('keeps the rest of a Home layout from the model when a block’s page is off', () => {
    const result = applyDesignChanges(
      defaultDesign(),
      [
        {
          path: 'pages.home.blocks',
          value: [
            { type: 'composer', width: 'two_thirds' },
            { type: 'status', width: 'third' },
          ],
        },
      ],
      'site',
      { blockTypes: ['composer'], links: new Set(), checkCss: () => null }
    )
    expect(result.design.pages.home.blocks.map((block) => block.type)).toEqual(['composer'])
    expect(result.refused).toEqual([
      { path: 'pages.home.blocks', reason: 'the status block needs its page on' },
    ])
  })
})
