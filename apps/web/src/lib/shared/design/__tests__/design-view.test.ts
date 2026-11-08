/**
 * The design as a portal page applies it. The feedback page's welcome message
 * shows only when the design turns it on and it has something to say.
 */
import { describe, expect, it } from 'vitest'
import { designView } from '../design-view'
import { defaultDesign, portalDesign } from '../schema'
import { contrastRatio } from '../contrast'
import { resolveDesign } from '../resolve'
import { brandStatusColour } from '../status-colours'

const body = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }],
}

describe('designView', () => {
  it('carries the board the feed opens on, or null for every board', () => {
    const doc = defaultDesign()
    expect(designView(doc, null).feedback.openOn).toBeNull()
    doc.pages.feedback.openOn = 'board_01h455vb4pex5vsknk084sn02q' as never
    expect(portalDesign.parse(doc).pages.feedback.openOn).toBe('board_01h455vb4pex5vsknk084sn02q')
    expect(designView(doc, null).feedback.openOn).toBe('board_01h455vb4pex5vsknk084sn02q')
    expect(
      portalDesign.safeParse({
        ...doc,
        pages: { ...doc.pages, feedback: { ...doc.pages.feedback, openOn: 'bugs' } },
      }).success
    ).toBe(false)
  })

  it('carries the design’s own favicon and share image, where it has them', () => {
    const doc = defaultDesign()
    expect(designView(doc, null).icons).toMatchObject({ favicon: null, shareImage: null })
    doc.brand.favicon = { key: 'favicons/a.png' }
    doc.brand.shareImage = { key: 'portal-images/b.png' }
    expect(designView(doc, null).icons).toMatchObject({
      favicon: '/api/storage/favicons/a.png',
      shareImage: '/api/storage/portal-images/b.png',
    })
  })

  it('offers the brand icon as a favicon: an SVG as it is, else squared on the server', () => {
    const doc = defaultDesign()
    expect(designView(doc, null).icons?.mark).toBeNull()
    doc.brand.logo.mark.light = { key: 'logos/icon.svg' }
    expect(designView(doc, null).icons?.mark).toBe('/api/storage/logos/icon.svg')
    doc.brand.logo.mark.light = { key: 'logos/icon.png' }
    expect(designView(doc, null).icons?.mark).toMatch(/^\/brand\.png\?v=\w+&kind=icon$/)
  })

  it('versions the share card by what it shows', () => {
    const doc = defaultDesign()
    const before = designView(doc, null).icons?.card
    expect(before).toBeTruthy()
    expect(designView(defaultDesign(), null).icons?.card).toBe(before)
    doc.brand.light.background = '#112233'
    expect(designView(doc, null).icons?.card).not.toBe(before)
  })

  it('gives the browser the page colour for each mode the design shows', () => {
    const doc = defaultDesign()
    doc.brand.light.background = '#fafafa'
    expect(designView(doc, null).icons?.themeColor?.light).toBe('#fafafa')
    expect(designView(doc, null).icons?.themeColor?.dark).toMatch(/^#[0-9a-f]{6}$/)
    doc.mode = 'light'
    expect(designView(doc, null).icons?.themeColor?.dark).toBeNull()
  })

  it('carries the welcome message when it is on and has text', () => {
    const doc = defaultDesign()
    doc.pages.feedback.welcome = { show: true, body }
    expect(designView(doc, 1).feedback.welcome).toEqual(body)
  })

  it('leaves the welcome message out when it is off or empty', () => {
    const doc = defaultDesign()
    doc.pages.feedback.welcome = { show: false, body }
    expect(designView(doc, 1).feedback.welcome).toBeNull()
    doc.pages.feedback.welcome = { show: true, body: { type: 'doc', content: [] } }
    expect(designView(doc, 1).feedback.welcome).toBeNull()
  })

  it('carries the feedback page headline', () => {
    const doc = defaultDesign()
    doc.pages.feedback.headline = { title: { en: 'Ideas' }, subtitle: {} }
    expect(designView(doc, null).feedback.headline).toEqual({
      title: { en: 'Ideas' },
      subtitle: {},
    })
  })

  it('carries how the header shows the brand, with its wordmark files', () => {
    const doc = defaultDesign()
    doc.brand.logo = {
      ...doc.brand.logo,
      display: 'wordmark',
      wordmark: { light: { key: 'logos/ink.svg' }, dark: null },
    }
    expect(designView(doc, 1).logo).toEqual({
      display: 'wordmark',
      name: null,
      wordmark: { light: '/api/storage/logos/ink.svg', dark: null },
      mark: { light: null, dark: null },
    })
  })

  it('carries the logo’s colours for status markers only when the design asks for them', () => {
    const doc = defaultDesign()
    doc.brand.logoColours = ['#ecb22e', '#36c5f0']
    expect(designView(doc, 1).statusColours).toBeNull()
    doc.layout.status = 'brand'
    expect(designView(doc, 1).statusColours).toHaveLength(2)
    doc.brand.logoColours = []
    expect(designView(doc, 1).statusColours).toBeNull()
  })

  it('raises each status marker colour to 3:1 on the page and the cards, keeping its hue', () => {
    const doc = defaultDesign()
    doc.layout.status = 'brand'
    doc.brand.logoColours = ['#0058a3', '#ffdb00']
    const view = designView(doc, 1)
    const light = resolveDesign(doc).light!
    expect(view.statusColours![0]).toBe('#0058a3')
    const yellow = view.statusColours![1]!
    expect(yellow).not.toBe('#ffdb00')
    for (const bg of [light.background!, light.card!])
      expect(contrastRatio(yellow, bg)).toBeGreaterThanOrEqual(3)
    expect(brandStatusColour('#eab308', view.statusColours!)).toBe(yellow)
  })

  it('raises them against the dark page for a dark design', () => {
    const doc = defaultDesign()
    doc.mode = 'dark'
    doc.layout.status = 'brand'
    doc.brand.logoColours = ['#0058a3']
    const dark = resolveDesign(doc).dark!
    const [blue] = designView(doc, 1).statusColours!
    expect(contrastRatio(blue!, dark.background!)).toBeGreaterThanOrEqual(3)
  })

  it('carries the band image and where it sits, beside the words unless it says', () => {
    const doc = defaultDesign()
    expect(designView(doc, 1).bandImage).toBeNull()
    doc.brand.bandImage = { key: 'portal-images/room.jpg' }
    expect(designView(doc, 1).bandImage).toEqual({
      url: '/api/storage/portal-images/room.jpg',
      place: 'side',
    })
    doc.layout.imagePlace = 'pattern'
    expect(designView(doc, 1).bandImage?.place).toBe('pattern')
  })

  it('says when the band image is Home’s only and when its words sit on a measured veil', () => {
    const doc = defaultDesign()
    doc.layout.band = 'brand'
    doc.layout.imagePlace = 'cover'
    doc.brand.bandImage = {
      key: 'portal-images/room.jpg',
      homeOnly: true,
      shade: { tone: 'dark', strength: 40, under: '#333333' },
    }
    expect(designView(doc, 1).bandImage).toMatchObject({ homeOnly: true, shaded: true })
    doc.layout.imagePlace = 'side'
    expect(designView(doc, 1).bandImage).not.toHaveProperty('shaded')
  })

  it('describes the band image for those who cannot see it, unless it is decoration', () => {
    const doc = defaultDesign()
    doc.brand.bandImage = { key: 'portal-images/room.jpg', alt: 'Our team at work' }
    expect(designView(doc, 1).bandImage?.alt).toBe('Our team at work')
    doc.brand.bandImage.decorative = true
    expect(designView(doc, 1).bandImage).not.toHaveProperty('alt')
  })

  it('offers the smaller copies made on upload as a srcset, the full image last', () => {
    const doc = defaultDesign()
    doc.brand.bandImage = {
      key: 'portal-images/room.webp',
      width: 2560,
      variants: [
        { key: 'portal-images/room-640.webp', w: 640 },
        { key: 'portal-images/room-1280.webp', w: 1280 },
      ],
    }
    expect(designView(doc, 1).bandImage?.srcSet).toBe(
      '/api/storage/portal-images/room-640.webp 640w,' +
        '/api/storage/portal-images/room-1280.webp 1280w,' +
        '/api/storage/portal-images/room.webp 2560w'
    )
  })

  it('leaves an image stored before copies were made as the one file it is', () => {
    const doc = defaultDesign()
    doc.brand.bandImage = { key: 'portal-images/room.jpg' }
    expect(designView(doc, 1).bandImage).not.toHaveProperty('srcSet')
    // Copies without the full image's width still lead to it, which the browser cannot size.
    doc.brand.bandImage = {
      key: 'portal-images/room.jpg',
      variants: [{ key: 'portal-images/room-640.webp', w: 640 }],
    }
    expect(designView(doc, 1).bandImage).not.toHaveProperty('srcSet')
  })

  it('carries a name the header shows in place of the workspace’s', () => {
    const doc = defaultDesign()
    doc.brand.logo = { ...doc.brand.logo, display: 'name', name: 'Harbor & Pine' }
    expect(designView(doc, 1).logo).toMatchObject({ display: 'name', name: 'Harbor & Pine' })
  })
})
