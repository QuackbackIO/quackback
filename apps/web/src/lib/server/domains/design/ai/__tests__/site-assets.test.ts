import { beforeEach, describe, expect, it, vi } from 'vitest'

const files = vi.hoisted(() => new Map<string, Uint8Array | string>())
const stored = vi.hoisted(() => [] as Array<{ key: string; type: string }>)
const usable = vi.hoisted(() => ({ value: true }))

vi.mock('@/lib/server/content/unfurl', () => ({
  fetchFollowingRedirects: vi.fn(async (url: string) => {
    const body = files.get(url)
    if (body === undefined) return { response: new Response('', { status: 404 }), finalUrl: url }
    return { response: new Response(body as BodyInit), finalUrl: url }
  }),
}))
vi.mock('@/lib/server/storage/s3', () => ({
  isS3Usable: () => usable.value,
  uploadObject: vi.fn(async (key: string, _body: Uint8Array, type: string) => {
    stored.push({ key, type })
    return `/api/storage/${key}`
  }),
}))

import { importSiteAssets } from '../site-assets'
import type { SiteSignals } from '../site-signals'

const signals = (extra: Partial<SiteSignals>) =>
  ({ domain: 'example.com', logo: null, shareImage: null, ...extra }) as SiteSignals

/** A PNG header of the given size, enough for the size reader. */
function png(width: number, height: number) {
  const bytes = new Uint8Array(32)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  new DataView(bytes.buffer).setUint32(16, width)
  new DataView(bytes.buffer).setUint32(20, height)
  return bytes
}

function jpeg(width: number, height: number) {
  return new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    height >> 8,
    height & 0xff,
    width >> 8,
    width & 0xff,
  ])
}

beforeEach(() => {
  files.clear()
  stored.length = 0
  usable.value = true
})

describe('a website’s wordmark', () => {
  it('stores a wide inline SVG, named by its content, with its own colours', async () => {
    const svg = '<svg viewBox="0 0 120 30"><path fill="#ff4f40" d="M0 0h1v1z"/></svg>'
    const first = await importSiteAssets(signals({ logo: { svg } }))
    expect(first.wordmark).toEqual({
      key: expect.stringMatching(/^header-logos\/site-[0-9a-f]{32}\.svg$/),
      colours: ['#ff4f40'],
    })
    expect(stored).toEqual([{ key: first.wordmark!.key, type: 'image/svg+xml' }])
    const again = await importSiteAssets(signals({ logo: { svg } }))
    expect(again.wordmark!.key).toBe(first.wordmark!.key)
  })

  it('leaves a square logo, which is a mark, and an SVG that holds a script', async () => {
    expect(
      (await importSiteAssets(signals({ logo: { svg: '<svg width="33" height="34"/>' } }))).wordmark
    ).toBeNull()
    expect(
      (
        await importSiteAssets(
          signals({ logo: { svg: '<svg viewBox="0 0 90 30"><script/></svg>' } })
        )
      ).wordmark
    ).toBeNull()
    expect(stored).toEqual([])
  })

  it('fetches a logo file, and keeps it when it is wide', async () => {
    files.set('https://example.com/logo@2x.png', png(201, 75))
    files.set('https://example.com/badge.png', png(64, 64))
    files.set(
      'https://example.com/logo.svg',
      '<svg viewBox="0 0 90 36"><path fill="#0058a3"/></svg>'
    )
    expect(
      (await importSiteAssets(signals({ logo: { url: 'https://example.com/logo@2x.png' } })))
        .wordmark
    ).toMatchObject({
      key: expect.stringMatching(/\.png$/),
    })
    expect(
      (await importSiteAssets(signals({ logo: { url: 'https://example.com/badge.png' } }))).wordmark
    ).toBeNull()
    expect(
      (await importSiteAssets(signals({ logo: { url: 'https://example.com/logo.svg' } }))).wordmark
    ).toMatchObject({
      key: expect.stringMatching(/\.svg$/),
      colours: ['#0058a3'],
    })
  })
})

describe('a website’s share image', () => {
  it('stores a photo large enough for a band, with its bytes for the model', async () => {
    files.set('https://example.com/og.jpg', jpeg(1100, 630))
    const { shareImage } = await importSiteAssets(
      signals({ shareImage: 'https://example.com/og.jpg' })
    )
    expect(shareImage).toMatchObject({
      key: expect.stringMatching(/^portal-images\/site-[0-9a-f]{32}\.jpeg$/),
      mimeType: 'image/jpeg',
    })
    expect(Buffer.from(shareImage!.base64, 'base64')).toEqual(Buffer.from(jpeg(1100, 630)))
  })

  it('leaves a small image, a page that is not an image, and a missing one', async () => {
    files.set('https://example.com/small.jpg', jpeg(300, 200))
    files.set('https://example.com/page', '<html></html>')
    for (const url of [
      'https://example.com/small.jpg',
      'https://example.com/page',
      'https://example.com/gone',
    ])
      expect((await importSiteAssets(signals({ shareImage: url }))).shareImage, url).toBeNull()
  })
})

it('stores nothing where storage is not set up', async () => {
  usable.value = false
  const svg = '<svg viewBox="0 0 120 30"/>'
  expect(await importSiteAssets(signals({ logo: { svg } }))).toEqual({
    wordmark: null,
    shareImage: null,
  })
  expect(stored).toEqual([])
})
