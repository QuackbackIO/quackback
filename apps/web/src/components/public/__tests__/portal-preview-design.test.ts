/**
 * The frame reads the draft the builder posts with the design schema before
 * anything uses it, then builds its view with the server's code, keeping
 * images from the workspace's storage only.
 */
import { describe, expect, it } from 'vitest'
import { designView } from '@/lib/shared/design/design-view'
import { defaultDesign } from '@/lib/shared/design/schema'
import { pageView, readDraftView, sharedView } from '../portal-preview-design'

/** The draft as it arrives: a structured clone of what the builder posted. */
const posted = (value: unknown) => readDraftView(structuredClone(value))

describe('a draft design read from the preview message', () => {
  it('builds the view the server builds for the same design', () => {
    const draft = defaultDesign()
    draft.pages.feedback.headline = { title: { en: 'Ideas' }, subtitle: { en: 'Tell us' } }
    expect(posted(draft)).toEqual(designView(draft, null))
  })

  it('reads nothing from a message the schema does not accept', () => {
    expect(posted(null)).toBeNull()
    expect(posted(undefined)).toBeNull()
    expect(posted('design')).toBeNull()
    // The old resolved shape, or a forged one, is not a design.
    expect(posted({ css: ':root{}', attributes: { onload: 'x' }, fontIds: [] })).toBeNull()
    expect(posted({ ...defaultDesign(), mode: 'neon' })).toBeNull()
    expect(posted({ ...defaultDesign(), script: 'alert(1)' })).toBeNull()
  })

  it('keeps the logo’s files, and reads no design whose file keys are not plain storage keys', () => {
    const draft = defaultDesign()
    draft.brand.logo.display = 'wordmark'
    draft.brand.logo.wordmark = { light: { key: 'header-logos/a.svg' }, dark: null }
    draft.brand.logo.mark = { light: { key: 'header-logos/icon.png' }, dark: null }
    expect(posted(draft)?.logo).toEqual({
      display: 'wordmark',
      name: null,
      wordmark: { light: '/api/storage/header-logos/a.svg', dark: null },
      mark: { light: '/api/storage/header-logos/icon.png', dark: null },
    })
    // A key that could carry a query or leave an attribute is no design at all.
    draft.brand.logo.wordmark.dark = { key: 'x.svg?u=https://evil.example' }
    expect(posted(draft)).toBeNull()
    draft.brand.logo.wordmark.dark = null
    draft.brand.logo.mark.dark = { key: 'icon.png#"onerror' }
    expect(posted(draft)).toBeNull()
  })

  it('keeps a band image and its smaller copies only from storage', () => {
    const draft = defaultDesign()
    draft.brand.heroImage = {
      key: 'portal-images/room.webp',
      width: 2560,
      variants: [{ key: 'portal-images/room-640.webp', w: 640 }],
    }
    expect(posted(draft)?.bandImage).toEqual(designView(draft, null).bandImage)
    expect(posted(draft)?.bandImage?.srcSet).toContain('640w')

    // A copy whose key could end a srcset candidate is no design at all.
    draft.brand.heroImage.variants = [{ key: 'room 640.webp, //evil.example/x', w: 640 }]
    expect(posted(draft)).toBeNull()

    delete draft.brand.heroImage.variants
    draft.brand.heroImage.key = 'room.webp?x=1'
    expect(posted(draft)).toBeNull()
  })
})

describe('a view shared with the one drawn before it', () => {
  const view = () => readDraftView(defaultDesign())!

  it('is the view drawn before when nothing in it changed', () => {
    const before = view()
    expect(sharedView(before, view())).toBe(before)
  })

  it('keeps each part that did not change as the very object it was', () => {
    const before = view()
    const changed = defaultDesign()
    changed.pages.feedback.defaultSort =
      changed.pages.feedback.defaultSort === 'top' ? 'new' : 'top'
    const after = sharedView(before, readDraftView(changed))!
    expect(after).not.toBe(before)
    expect(after.feedback).not.toBe(before.feedback)
    expect(after.feedback.defaultSort).toBe(changed.pages.feedback.defaultSort)
    expect(after.nav).toBe(before.nav)
    expect(after.home).toBe(before.home)
    expect(after.logo).toBe(before.logo)
  })

  it('is the new view when there was none before, or none now', () => {
    const next = view()
    expect(sharedView(null, next)).toBe(next)
    expect(sharedView(next, null)).toBeNull()
  })
})

describe('the view the frame’s pages read', () => {
  const view = () => readDraftView(defaultDesign())!

  it('stays the view before for a change that reaches the page as style alone', () => {
    const before = view()
    const changed = defaultDesign()
    changed.brand.light.accent = '#225544'
    const next = sharedView(before, readDraftView(changed))!
    expect(next.themeStyles).not.toBe(before.themeStyles)
    expect(pageView(before, next)).toBe(before)
  })

  it('is the new view once a part a page reads changes', () => {
    const before = view()
    const changed = defaultDesign()
    changed.pages.feedback.defaultSort =
      changed.pages.feedback.defaultSort === 'top' ? 'new' : 'top'
    const next = sharedView(before, readDraftView(changed))!
    expect(pageView(before, next)).toBe(next)
  })

  it('is the new view when there was none before, or none now', () => {
    const next = view()
    expect(pageView(null, next)).toBe(next)
    expect(pageView(next, null)).toBeNull()
  })
})
