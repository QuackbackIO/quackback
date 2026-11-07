/**
 * The page background a brand match sets: the measured decision as a design
 * change (a tint or a light gradient as light mode's, a dark site's glow in
 * the `dark` field), applied through the schema and drawn readable; a tint or
 * gradient a match set before going when the site shows none, an upload
 * staying; and the reply naming it in plain words.
 */
import { describe, expect, it } from 'vitest'
import { applyDesignChanges } from '@/lib/shared/design/apply-changes'
import { resolveDesign } from '@/lib/shared/design/resolve'
import { defaultDesign, type PortalDesign } from '@/lib/shared/design/schema'
import type { PageFillDecision } from '../../extract/page-fill-decide'
import { pageBackgroundChanges } from '../brand-decide'
import { brandReply, pageBackgroundWords, pageColourName } from '../brand-reply'

const CREAM: PageFillDecision = {
  background: { kind: 'tint', colour: '#f7f3ea' },
  look: 'tint',
  mode: 'light',
  colours: ['#f7f3ea'],
  why: 'the page colour outside the hero and the cards, #f7f3ea, is not white',
}
const DRIFT: PageFillDecision = {
  background: { kind: 'gradient', stops: ['#d6e4ff', '#ffffff'], direction: 'down' },
  look: 'drift',
  mode: 'light',
  colours: ['#d6e4ff', '#ffffff'],
  why: 'the page colour drifts from #d6e4ff at the top to #ffffff at the bottom',
}
const GLOW: PageFillDecision = {
  background: {
    kind: 'solid',
    dark: {
      kind: 'gradient',
      shape: 'radial',
      centre: 'top',
      stops: ['#31225c', 'page'],
      strength: 'strong',
    },
  },
  look: 'glow',
  mode: 'dark',
  colours: ['#31225c', '#0a0a15'],
  why: 'a soft glow of #31225c over the #0a0a15 page, strongest at the top',
}

const applied = (doc: PortalDesign, decided: PageFillDecision | null) =>
  applyDesignChanges(
    doc,
    pageBackgroundChanges(decided, doc.layout.background).map(({ path, value }) => ({
      path,
      value,
    })),
    'site'
  )

const withBackground = (background: unknown): PortalDesign => {
  const doc = defaultDesign()
  return { ...doc, layout: { ...doc.layout, background } } as PortalDesign
}

describe('the page background as a design change', () => {
  it('sets a measured tint as the site’s background, with its evidence', () => {
    const changes = pageBackgroundChanges(CREAM, undefined)
    expect(changes).toEqual([
      { path: 'layout.background', value: CREAM.background, why: CREAM.why },
    ])
    const out = applied(defaultDesign(), CREAM)
    expect(out.refused).toEqual([])
    expect(out.design.layout.background).toEqual({ kind: 'tint', colour: '#f7f3ea' })
    const drawn = resolveDesign(out.design)
    expect(drawn.errors).toEqual([])
    // Light mode draws the exact colour measured.
    expect(drawn.backgrounds.light?.site.css).toBe('#f7f3ea')
  })

  it('sets a light gradient from the measured stops, top first', () => {
    const out = applied(defaultDesign(), DRIFT)
    expect(out.design.layout.background).toEqual(DRIFT.background)
    expect(resolveDesign(out.design).errors).toEqual([])
  })

  it('puts a dark site’s glow in dark mode’s background, light mode staying solid', () => {
    const doc = { ...defaultDesign(), mode: 'dark' as const }
    const out = applied(doc, GLOW)
    expect(out.refused).toEqual([])
    expect(out.design.layout.background).toEqual(GLOW.background)
    const drawn = resolveDesign(out.design)
    expect(drawn.errors).toEqual([])
    expect(drawn.backgrounds.dark?.site.css).toMatch(/^radial-gradient/)
  })

  it('takes away a tint or gradient a match set before when the site shows none', () => {
    for (const before of [
      { kind: 'tint', colour: '#f7f3ea' },
      { kind: 'gradient', stops: ['#d6e4ff', '#ffffff'] },
      { kind: 'solid', dark: { kind: 'gradient', stops: ['#31225c', 'page'] } },
    ]) {
      const out = applied(withBackground(before), null)
      expect(out.design.layout.background).toEqual({ kind: 'solid' })
    }
  })

  it('leaves the page alone when the site shows none and nothing was set', () => {
    expect(pageBackgroundChanges(null, undefined)).toEqual([])
    expect(pageBackgroundChanges(null, { kind: 'solid' })).toEqual([])
  })

  it('keeps an uploaded image or a pattern, the person’s own', () => {
    expect(
      pageBackgroundChanges(null, {
        kind: 'image',
        image: { key: 'portal-images/bg.png' },
      })
    ).toEqual([])
    expect(pageBackgroundChanges(null, { kind: 'pattern', pattern: 'dots' })).toEqual([])
  })
})

describe('the page background in the reply', () => {
  it('names a page colour by its cast', () => {
    expect(pageColourName('#f7f3ea')).toBe('cream')
    expect(pageColourName('#f7f5f2')).toBe('cream')
    expect(pageColourName('#eef2f8')).toBe('grey-blue')
    expect(pageColourName('#f5f5f5')).toBe('grey')
    expect(pageColourName('#ffffff')).toBe('white')
    expect(pageColourName('#fdfdfd')).toBe('white')
    expect(pageColourName('#d6e4ff')).toBe('blue')
  })

  it('says each look in plain words', () => {
    expect(pageBackgroundWords(CREAM)).toBe('a soft cream page, as your site has')
    expect(pageBackgroundWords(DRIFT)).toBe(
      'a soft blue-to-white gradient behind the page, as your site has'
    )
    expect(pageBackgroundWords(GLOW)).toMatch(
      /^a soft [a-z ]+ glow behind the page, as your site has$/
    )
  })

  it('names it in the reply, and nothing when the page is its own colour', () => {
    const base = {
      shots: 1,
      roles: null,
      heading: null,
      band: 'none',
      failed: [],
      logo: 'placed' as const,
      faceClose: true,
    }
    expect(brandReply({ ...base, pageBackground: CREAM }).reply).toContain(
      'a soft cream page, as your site has'
    )
    expect(brandReply({ ...base, pageBackground: null }).reply).not.toMatch(/page, as your site/)
    expect(brandReply({ ...base, pageBackground: CREAM }).reply).not.toMatch(/—/)
  })
})
