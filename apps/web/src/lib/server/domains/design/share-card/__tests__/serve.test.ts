import { describe, expect, it, vi } from 'vitest'
import { designView } from '@/lib/shared/design/design-view'
import { defaultDesign, type PortalDesign } from '@/lib/shared/design/schema'
import { portalFavicon, portalShareImage, type PortalHeadTemplates } from '@/lib/shared/portal-head'
import { decodePng, encodePng } from '../../extract/png'
import { serveBrandImage, shareCardSample, type BrandImageDeps } from '../serve'

const red = () => {
  const data = new Uint8Array(40 * 20 * 4)
  for (let i = 0; i < data.length; i += 4) data.set([220, 20, 20, 255], i)
  return encodePng({ width: 40, height: 20, data })
}

const ENGLISH_HEAD: PortalHeadTemplates = {
  pages: {
    feedback: 'Feedback',
    roadmap: 'Roadmap',
    changelog: 'Changelog',
    status: 'Status',
    help: 'Help Center',
  },
  portal: '{name}',
  feedback: '{name}',
  roadmap: '{name}',
  changelog: '{name}',
  entry: '{title}',
  status: '{name}',
  incident: '{title}',
  post: '{title}',
}

function deps(doc: PortalDesign | null, icon: Uint8Array | null = null) {
  const settings = doc
    ? {
        name: 'Acme Corp',
        portalDesign: designView(doc, 4),
        portalHeadWords: undefined as PortalHeadTemplates | undefined,
      }
    : null
  const read = vi.fn(async () => icon)
  const value: BrandImageDeps = {
    load: async () => (doc && settings ? { doc, settings } : null),
    readObject: read,
  }
  return { value, read, settings }
}

/** The query the portal's head asks for. */
function queryOf(url: string | null): URLSearchParams {
  return new URL(url ?? '/', 'https://acme.test').searchParams
}

describe('serveBrandImage', () => {
  it('draws the card the head asks for, and lets it be kept for good', async () => {
    const doc = defaultDesign()
    doc.brand.light.background = '#0c862c'
    const { value, settings } = deps(doc)
    const res = await serveBrandImage(
      queryOf(portalShareImage(settings, 'https://acme.test', 'roadmap')),
      value
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(res.headers.get('cache-control')).toContain('immutable')
    const img = decodePng(new Uint8Array(await res.arrayBuffer()))
    expect([img.width, img.height]).toEqual([1200, 630])
    expect([...img.data.subarray(0, 3)]).toEqual([0x0c, 0x86, 0x2c])
  })

  it('draws today’s card for an old address, but only briefly cached', async () => {
    const { value } = deps(defaultDesign())
    const res = await serveBrandImage(new URLSearchParams('v=old'), value)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).not.toContain('immutable')
  })

  it('moves a page’s card to a new address when the page’s name changes', async () => {
    const doc = defaultDesign()
    doc.brand.logo.mark.light = { key: 'logos/i.png' }
    const { value, read, settings } = deps(doc, red())
    const before = portalShareImage(settings, '', 'roadmap')
    await serveBrandImage(queryOf(before), value)
    // The main language changes, and with it the words under the title.
    const words = { ...ENGLISH_HEAD, pages: { ...ENGLISH_HEAD.pages, roadmap: 'Feuille de route' } }
    settings!.portalHeadWords = words
    const after = portalShareImage(settings, '', 'roadmap')
    expect(after).not.toBe(before)
    const stale = await serveBrandImage(queryOf(before), value)
    expect(stale.headers.get('cache-control')).not.toContain('immutable')
    expect(read).toHaveBeenCalledTimes(2)
    const current = await serveBrandImage(queryOf(after), value)
    expect(current.headers.get('cache-control')).toContain('immutable')
    // The portal's own card names no page, so its address stays.
    settings!.portalHeadWords = undefined
    const own = portalShareImage(settings, '')
    settings!.portalHeadWords = words
    expect(portalShareImage(settings, '')).toBe(own)
  })

  it('draws the card once per version', async () => {
    const doc = defaultDesign()
    doc.brand.logo.mark.light = { key: 'logos/i.png' }
    const { value, read, settings } = deps(doc, red())
    const query = queryOf(portalShareImage(settings, '', 'status'))
    await serveBrandImage(query, value)
    await serveBrandImage(query, value)
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('fits the brand icon into a square for the favicon', async () => {
    const doc = defaultDesign()
    doc.brand.logo.mark.light = { key: 'logos/wide.png' }
    const { value, settings } = deps(doc, red())
    const res = await serveBrandImage(queryOf(settings!.portalDesign.icons!.mark!), value)
    expect(res.status).toBe(200)
    const img = decodePng(new Uint8Array(await res.arrayBuffer()))
    expect(img.width).toBe(img.height)
  })

  it('sends a favicon it cannot read on to the stored file', async () => {
    const doc = defaultDesign()
    doc.brand.logo.mark.light = { key: 'logos/i.webp' }
    const { value, settings } = deps(doc, new Uint8Array([1, 2, 3]))
    const res = await serveBrandImage(queryOf(settings!.portalDesign.icons!.mark!), value)
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/api/storage/logos/i.webp')
  })

  it('draws the card without an icon it cannot read', async () => {
    const doc = defaultDesign()
    doc.brand.logo.mark.light = { key: 'logos/i.webp' }
    const { value } = deps(doc, new Uint8Array([1, 2, 3]))
    expect((await serveBrandImage(new URLSearchParams('v=x'), value)).status).toBe(200)
  })

  it('has nothing for a portal without a design', async () => {
    expect((await serveBrandImage(new URLSearchParams('v=x'), deps(null).value)).status).toBe(404)
  })

  it('draws the initial tile for a brand without an icon, kept as long as the card', async () => {
    const doc = defaultDesign()
    doc.brand.light.accent = '#0c862c'
    const { value, settings } = deps(doc)
    const favicon = portalFavicon(settings)
    const res = await serveBrandImage(queryOf(favicon), value)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(res.headers.get('cache-control')).toContain('immutable')
    const img = decodePng(new Uint8Array(await res.arrayBuffer()))
    expect(img.width).toBe(img.height)
    // The brand colour fills the tile; its rounded corner is clear.
    const at = (x: number, y: number) => [
      ...img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4),
    ]
    expect(at(img.width - 20, img.height / 2)).toEqual([0x0c, 0x86, 0x2c, 255])
    expect(at(0, 0)[3]).toBe(0)
    // An old address still gets the tile, only briefly cached.
    const old = await serveBrandImage(new URLSearchParams('v=old&kind=icon'), value)
    expect(old.status).toBe(200)
    expect(old.headers.get('cache-control')).not.toContain('immutable')
  })

  it('draws an SVG icon to PNG for the favicon square and the card', async () => {
    const doc = defaultDesign()
    doc.brand.logo.mark.light = { key: 'logos/i.svg' }
    doc.brand.light.background = '#ffffff'
    const mark = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#dc1414"/></svg>'
    )
    const { value } = deps(doc, mark)
    const res = await serveBrandImage(new URLSearchParams('v=x&kind=icon'), value)
    expect(res.status).toBe(200)
    const img = decodePng(new Uint8Array(await res.arrayBuffer()))
    expect([...img.data.subarray(0, 4)]).toEqual([0xdc, 0x14, 0x14, 255])
    // The card shows the icon where it sits, not the initial tile.
    const card = decodePng(
      new Uint8Array(await (await serveBrandImage(new URLSearchParams('v=y'), value)).arrayBuffer())
    )
    const o = (150 * card.width + 150) * 4
    expect([...card.data.subarray(o, o + 3)]).toEqual([0xdc, 0x14, 0x14])
  })

  it('draws the initial tile for an SVG icon it cannot draw', async () => {
    const doc = defaultDesign()
    doc.brand.logo.mark.light = { key: 'logos/t.svg' }
    const { value } = deps(
      doc,
      new TextEncoder().encode('<svg viewBox="0 0 9 9"><text>A</text></svg>')
    )
    const res = await serveBrandImage(new URLSearchParams('v=x&kind=icon'), value)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(res.headers.get('cache-control')).not.toContain('immutable')
  })
})

describe('a brand with a full logo and no icon', () => {
  const svgLogo = new TextEncoder().encode(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 10"><rect width="40" height="10" fill="#1414dc"/></svg>'
  )
  const withLogo = () => {
    const doc = defaultDesign()
    doc.brand.light.background = '#ffffff'
    doc.brand.logo.wordmark.light = { key: 'logos/full.svg' }
    return doc
  }

  it('draws the full logo on the card, wide, in place of the initial', async () => {
    const { value } = deps(withLogo(), svgLogo)
    const card = decodePng(
      new Uint8Array(await (await serveBrandImage(new URLSearchParams('v=x'), value)).arrayBuffer())
    )
    const blue = (x: number, y: number) => {
      const o = (y * card.width + x) * 4
      return [...card.data.subarray(o, o + 3)]
    }
    // 480 wide from the margin, a quarter as tall, centred on the icon's row.
    expect(blue(100, 168)).toEqual([0x14, 0x14, 0xdc])
    expect(blue(560, 168)).toEqual([0x14, 0x14, 0xdc])
    expect(blue(600, 168)).toEqual([0xff, 0xff, 0xff])
  })

  it('serves the full logo for email headers, and keeps the initial tile as the favicon', async () => {
    const { value, settings } = deps(withLogo(), svgLogo)
    const logo = await serveBrandImage(new URLSearchParams('v=x&kind=logo'), value)
    const img = decodePng(new Uint8Array(await logo.arrayBuffer()))
    expect(img.width).toBe(img.height)
    const mid = (img.height / 2) * img.width * 4 + (img.width / 2) * 4
    expect([...img.data.subarray(mid, mid + 3)]).toEqual([0x14, 0x14, 0xdc])
    expect(portalFavicon(settings)).toMatch(/kind=icon$/)
    const favicon = await serveBrandImage(queryOf(portalFavicon(settings)), value)
    const tile = decodePng(new Uint8Array(await favicon.arrayBuffer()))
    expect([...tile.data.subarray(mid, mid + 3)]).not.toEqual([0x14, 0x14, 0xdc])
  })
})

describe('shareCardSample', () => {
  it('is the very card /brand.png serves once the design is published', async () => {
    const doc = defaultDesign()
    doc.brand.logo.mark.light = { key: 'logos/i.png' }
    const { value, settings } = deps(doc, red())
    const served = await serveBrandImage(queryOf(portalShareImage(settings, '')), value)
    const sample = await shareCardSample(doc, { name: 'Acme Corp' }, value)
    expect(sample.startsWith('data:image/png;base64,')).toBe(true)
    expect(
      Buffer.from(sample.split(',')[1]!, 'base64').equals(Buffer.from(await served.arrayBuffer()))
    ).toBe(true)
  })

  it('is the share image, or the logo where the card cannot draw the title', async () => {
    const { value } = deps(defaultDesign())
    const own = defaultDesign()
    own.brand.shareImage = { key: 'portal-images/s.png' }
    expect(await shareCardSample(own, { name: 'Acme' }, value)).toBe(
      '/api/storage/portal-images/s.png'
    )
    const cjk = defaultDesign()
    cjk.brand.logo.name = '反馈中心'
    const settings = { name: 'Acme', brandingData: { logoUrl: '/api/storage/logo.png' } }
    expect(await shareCardSample(cjk, settings, value)).toBe('/api/storage/logo.png')
  })
})
