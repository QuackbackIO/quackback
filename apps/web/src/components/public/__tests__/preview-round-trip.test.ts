/**
 * The canvas draws the draft from the preview message, so what the builder
 * sends must arrive whole: a part the frame drops shows the live portal's
 * default in its place, and a draft with no changes then looks unlike what
 * visitors see.
 */
import { describe, expect, it } from 'vitest'
import { designPreview } from '@/components/admin/settings/appearance/use-design-draft'
import { designChanges } from '@/lib/shared/design/diff'
import { DESIGN_OPTIONS } from '@/lib/shared/design/options'
import { defaultDesign } from '@/lib/shared/design/schema'
import { readDesignPreview } from '../portal-preview-design'

/** What the frame reads from the message the builder posts. */
const sentAndRead = (draft: ReturnType<typeof defaultDesign>) => {
  const sent = designPreview(draft)
  return { sent, read: readDesignPreview(JSON.parse(JSON.stringify(sent))) }
}

describe('a draft sent to the canvas', () => {
  it('arrives with the hero image’s smaller copies', () => {
    const draft = defaultDesign()
    draft.brand.bandImage = {
      key: 'portal-images/room.webp',
      width: 2560,
      variants: [{ key: 'portal-images/room-640.webp', w: 640 }],
    }
    const { sent, read } = sentAndRead(draft)
    expect(read?.bandImage?.srcSet).toBe(sent.bandImage?.srcSet)
    expect(read?.bandImage?.srcSet).toContain('640w')
  })

  it('arrives with everything the builder sends', () => {
    const draft = defaultDesign()
    draft.pages.home.blocks = [
      { id: 'composer01', type: 'composer', grid: { x: 0, y: 0, w: 12, h: 4 } },
      {
        id: 'ideas01',
        type: 'ideas',
        grid: { x: 0, y: 4, w: 6, h: 8 },
        sort: 'trending',
        count: 3,
      },
    ]
    draft.pages.home.composer = 'band'
    draft.pages.home.composerWidth = 'narrow'
    draft.brand.logo.display = 'mark_and_name'
    draft.brand.logo.mark = { light: { key: 'header-logos/mark.png' }, dark: null }
    const { sent, read } = sentAndRead(draft)
    expect(designChanges(sent, read)).toEqual([])
  })

  it('arrives with the New request button’s own words', () => {
    const draft = defaultDesign()
    draft.pages.support = { request: { en: 'Ask us' } }
    expect(sentAndRead(draft).read?.copy).toEqual({ request: { en: 'Ask us' } })
  })

  it('keeps the composer in the band, where the live portal draws it', () => {
    const draft = defaultDesign()
    draft.pages.home.blocks = [
      { id: 'composer01', type: 'composer', grid: { x: 0, y: 0, w: 12, h: 4 } },
    ]
    draft.pages.home.composer = 'band'
    expect(sentAndRead(draft).read?.home?.composer).toBe('band')
  })

  it('keeps the composer’s width in the band, and drops one it does not know', () => {
    const draft = defaultDesign()
    draft.pages.home.blocks = [
      { id: 'composer01', type: 'composer', grid: { x: 0, y: 0, w: 12, h: 4 } },
    ]
    draft.pages.home.composer = 'band'
    for (const width of DESIGN_OPTIONS.composerWidth) {
      draft.pages.home.composerWidth = width
      expect(sentAndRead(draft).read?.home?.composerWidth).toBe(width)
    }
    const sent = JSON.parse(JSON.stringify(designPreview(draft)))
    sent.home.composerWidth = 'huge'
    expect(readDesignPreview(sent)?.home).not.toHaveProperty('composerWidth')
  })

  it('carries the hero’s main action and its call to action, and only those it can be', () => {
    const draft = defaultDesign()
    draft.pages.home.mainAction = 'button'
    draft.pages.home.button = {
      to: 'roadmap',
      second: true,
      label: { en: 'See what is next' },
      secondLabel: { en: 'Tell us' },
    }
    const { sent, read } = sentAndRead(draft)
    expect(read?.home?.mainAction).toBe('button')
    expect(read?.home?.button).toEqual(draft.pages.home.button)
    expect(designChanges(sent, read)).toEqual([])
    const forged = JSON.parse(JSON.stringify(designPreview(draft)))
    forged.home.mainAction = 'banner'
    forged.home.button = { to: 'elsewhere', second: 'yes', label: { en: 7 } }
    const home = readDesignPreview(forged)?.home
    expect(home).not.toHaveProperty('mainAction')
    expect(home).not.toHaveProperty('button')
  })

  it('keeps the design’s own mark, from the workspace’s storage only', () => {
    const draft = defaultDesign()
    draft.brand.logo.mark = {
      light: { key: 'header-logos/mark.png' },
      dark: { key: 'header-logos/mark-dark.png' },
    }
    const { sent, read } = sentAndRead(draft)
    expect(read?.logo?.mark).toEqual(sent.logo.mark)
    const forged = readDesignPreview({
      css: '',
      logo: {
        display: 'mark',
        name: null,
        wordmark: {},
        mark: { light: 'https://evil.example/x.png', dark: '/api/storage/a.png' },
      },
    })
    expect(forged?.logo?.mark).toEqual({ light: null, dark: '/api/storage/a.png' })
  })

  it('drops a composer place it does not know', () => {
    const read = readDesignPreview({
      css: '',
      home: { headline: null, blocks: [], composer: 'sidebar' },
    })
    expect(read?.home).not.toHaveProperty('composer')
  })
})
