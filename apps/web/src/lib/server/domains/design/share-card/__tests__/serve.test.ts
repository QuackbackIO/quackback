import { describe, expect, it, vi } from 'vitest'
import { designView } from '@/lib/shared/design/design-view'
import { defaultDesign, type PortalDesign } from '@/lib/shared/design/schema'
import { portalFavicon, portalShareImage } from '@/lib/shared/portal-head'
import { decodePng, encodePng } from '../../extract/png'
import { serveBrandImage, type BrandImageDeps } from '../serve'

const red = () => {
  const data = new Uint8Array(40 * 20 * 4)
  for (let i = 0; i < data.length; i += 4) data.set([220, 20, 20, 255], i)
  return encodePng({ width: 40, height: 20, data })
}

function deps(doc: PortalDesign | null, icon: Uint8Array | null = null) {
  const settings = doc ? { name: 'Acme Corp', portalDesign: designView(doc, 4) } : null
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

  it('draws the initial tile in PNG for an SVG icon, which mail cannot show', async () => {
    const doc = defaultDesign()
    doc.brand.logo.mark.light = { key: 'logos/i.svg' }
    const { value, read } = deps(doc, new TextEncoder().encode('<svg/>'))
    const res = await serveBrandImage(new URLSearchParams('v=x&kind=icon'), value)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(read).not.toHaveBeenCalled()
  })
})
