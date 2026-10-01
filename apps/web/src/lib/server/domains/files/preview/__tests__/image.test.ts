// @vitest-environment node
import { describe, it, expect } from 'vitest'
import * as mupdf from 'mupdf'
import { deriveImagePreview, webpSize, heifSize } from '../image'
import { PreviewRefusedError } from '../result'

function pixmap(width: number, height: number): mupdf.Pixmap {
  const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, width, height], false)
  pix.clear(200)
  return pix
}

const png = (w: number, h: number) => pixmap(w, h).asPNG().slice()
const jpeg = (w: number, h: number) => pixmap(w, h).asJPEG(80).slice()

function decodedSize(bytes: Uint8Array): { width: number; height: number } {
  const image = new mupdf.Image(bytes)
  return { width: image.getWidth(), height: image.getHeight() }
}

/** Splice an EXIF block with one Orientation tag in after a JPEG's SOI marker. */
function withExifOrientation(jpg: Uint8Array, orientation: number): Uint8Array {
  const tiff = [
    0x49,
    0x49,
    0x2a,
    0x00,
    0x08,
    0x00,
    0x00,
    0x00, // little-endian TIFF header, IFD at 8
    0x01,
    0x00, // one entry
    0x12,
    0x01,
    0x03,
    0x00,
    0x01,
    0x00,
    0x00,
    0x00,
    orientation,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00, // no next IFD
  ]
  const payload = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff] // "Exif\0\0"
  const length = payload.length + 2
  const app1 = [0xff, 0xe1, length >> 8, length & 0xff, ...payload]
  return new Uint8Array([...jpg.subarray(0, 2), ...app1, ...jpg.subarray(2)])
}

function box(type: string, ...children: Uint8Array[]): Uint8Array {
  const body = children.reduce((n, c) => n + c.length, 0)
  const out = new Uint8Array(8 + body)
  new DataView(out.buffer).setUint32(0, 8 + body)
  out.set(new TextEncoder().encode(type), 4)
  let p = 8
  for (const c of children) {
    out.set(c, p)
    p += c.length
  }
  return out
}

function u32be(...values: number[]): Uint8Array {
  const out = new Uint8Array(values.length * 4)
  values.forEach((v, i) => new DataView(out.buffer).setUint32(i * 4, v))
  return out
}

/** ftyp + meta(iprp(ipco(ispe...))) with the given sizes, and an optional rotation. */
function heifHeader(brand: string, sizes: Array<[number, number]>, rotation?: number): Uint8Array {
  const ispes = sizes.map(([w, h]) => box('ispe', u32be(0, w, h)))
  const props = rotation === undefined ? ispes : [...ispes, box('irot', new Uint8Array([rotation]))]
  const meta = box('meta', u32be(0), box('iprp', box('ipco', ...props)))
  const ftyp = box('ftyp', new TextEncoder().encode(brand), u32be(0))
  return new Uint8Array([...ftyp, ...meta])
}

function riff(chunk: string, data: number[]): Uint8Array {
  const body = [...new TextEncoder().encode('WEBP'), ...new TextEncoder().encode(chunk)]
  const len = data.length
  const out = [
    ...new TextEncoder().encode('RIFF'),
    ...[0, 0, 0, 0],
    ...body,
    len & 0xff,
    (len >> 8) & 0xff,
    0,
    0,
    ...data,
  ]
  return new Uint8Array(out)
}

// A 64x48 HEIC written by libheif's encoder.
const HEIC_64x48 = Uint8Array.from(
  atob(
    'AAAAHGZ0eXBoZWl4AAAAAG1pZjFoZWl4bWlhZgAAAXxtZXRhAAAAAAAAACFoZGxyAAAAAAAAAABwaWN0AAAAAAAAAAAAAAAA' +
      'AAAAACJpbG9jAAAAAERAAAEAAQAAAAABoAABAAAAAAAAAEYAAAAjaWluZgAAAAAAAQAAABVpbmZlAgAAAAABAABodmMxAAAA' +
      'AA5waXRtAAAAAAABAAAA/GlwcnAAAADcaXBjbwAAAHVodmNDAQQIAAAAAAAAAAAAHvAA/P36+gAADwNgAAEAF0ABDAH//wQI' +
      'AAADAJ24AAADAAAeugJAYQABACpCAQEECAAAAwCduAAAAwAAHqAggQTZbq5Ka5uAhoMCAAADADIAAAMAAhBiAAEABkQBwXPA' +
      'iQAAABNjb2xybmNseAABAA0ABoAAAAAUaXNwZQAAAAAAAABAAAAAQAAAAChjbGFwAAAAQAAAAAEAAAAwAAAAAQAAAAAAAAAC' +
      '////8AAAAAIAAAAQcGl4aQAAAAADCgoKAAAAGGlwbWEAAAAAAAAAAQABBYECAwWEAAAATm1kYXQAAABCKAGvE4D1Zsp2s9Z7' +
      'f+0xWG5viMvluSSssyQFFCs9tLdxauTN9qCeyZKIdyG4sdX3xSpJ0sjWTk6RsMDhqKHTbwxO'
  ),
  (c) => c.charCodeAt(0)
)

describe('deriveImagePreview', () => {
  it('records the size of a small image without a thumbnail', async () => {
    const result = await deriveImagePreview(png(120, 80), 'image/png')
    expect(result).toEqual({ status: 'ready', meta: { width: 120, height: 80 } })
  })

  it('scales a large PNG down to a 640px thumbnail', async () => {
    const result = await deriveImagePreview(png(2000, 1000), 'image/png')
    expect(result.meta).toEqual({ width: 2000, height: 1000 })
    const [thumb] = result.derived!
    expect(thumb).toMatchObject({
      field: 'thumbKey',
      suffix: 'thumb.png',
      contentType: 'image/png',
    })
    expect(decodedSize(thumb!.bytes)).toEqual({ width: 640, height: 320 })
  })

  it('writes a JPEG thumbnail for a large photo', async () => {
    const result = await deriveImagePreview(jpeg(1800, 1200), 'image/jpeg')
    const [thumb] = result.derived!
    expect(thumb).toMatchObject({ suffix: 'thumb.jpg', contentType: 'image/jpeg' })
    expect(Array.from(thumb!.bytes.subarray(0, 2))).toEqual([0xff, 0xd8])
    const size = decodedSize(thumb!.bytes)
    expect(size.width).toBe(640)
    expect(Math.abs(size.height - (1200 * 640) / 1800)).toBeLessThan(1)
  })

  it('reports the size a photo displays at, after its EXIF rotation', async () => {
    const result = await deriveImagePreview(withExifOrientation(jpeg(300, 200), 6), 'image/jpeg')
    expect(result.meta).toEqual({ width: 200, height: 300 })
  })

  it('reads WebP sizes from the header', async () => {
    // VP8 (lossy): frame tag, start code, 14-bit width and height.
    const vp8 = riff('VP8 ', [0, 0, 0, 0x9d, 0x01, 0x2a, 0x40, 0x06, 0xb0, 0x04])
    expect(webpSize(vp8)).toEqual({ width: 1600, height: 1200 })
    // VP8L (lossless): signature byte, then (width-1) and (height-1) in 14 bits each.
    const w = 300 - 1
    const h = 200 - 1
    const bits = w | (h << 14)
    const vp8l = riff('VP8L', [
      0x2f,
      bits & 0xff,
      (bits >> 8) & 0xff,
      (bits >> 16) & 0xff,
      bits >>> 24,
    ])
    expect(webpSize(vp8l)).toEqual({ width: 300, height: 200 })
    // VP8X (extended): 24-bit canvas (width-1) and (height-1).
    const vp8x = riff('VP8X', [0, 0, 0, 0, 0x7f, 0x0c, 0x00, 0x37, 0x09, 0x00])
    expect(webpSize(vp8x)).toEqual({ width: 3200, height: 2360 })
    expect(webpSize(new Uint8Array(12))).toBeNull()

    const result = await deriveImagePreview(vp8, 'image/webp')
    expect(result).toEqual({ status: 'ready', meta: { width: 1600, height: 1200 } })
  })

  it('reads AVIF sizes from the largest image property, rotated', async () => {
    expect(
      heifSize(
        heifHeader('avif', [
          [320, 240],
          [4032, 3024],
        ])
      )
    ).toEqual({
      width: 4032,
      height: 3024,
    })
    expect(heifSize(heifHeader('avif', [[4032, 3024]], 1))).toEqual({ width: 3024, height: 4032 })
    const result = await deriveImagePreview(heifHeader('avif', [[800, 600]]), 'image/avif')
    expect(result).toEqual({ status: 'ready', meta: { width: 800, height: 600 } })
  })

  it('converts HEIC to a JPEG rendition and sizes it from the rendition', async () => {
    const result = await deriveImagePreview(HEIC_64x48, 'image/heic')
    expect(result.status).toBe('ready')
    expect(result.meta).toEqual({ width: 64, height: 48 })
    const rendition = result.derived!.find((d) => d.field === 'renditionKey')!
    expect(rendition).toMatchObject({ suffix: 'rendition.jpg', contentType: 'image/jpeg' })
    expect(decodedSize(rendition.bytes)).toEqual({ width: 64, height: 48 })
  })

  it('sizes a HEIC over 24 megapixels without decoding it', async () => {
    // A header alone: decoding it would throw.
    const header = heifHeader('heic', [[6000, 4500]])
    expect(await deriveImagePreview(header, 'image/heic')).toEqual({
      status: 'ready',
      meta: { width: 6000, height: 4500 },
    })
  })

  it('refuses a HEIC whose size cannot be read before decoding', async () => {
    // The image property renamed: the decoder may still read the stream, but
    // nothing says how big it will be.
    const unsized = HEIC_64x48.slice()
    const at = Buffer.from(unsized).indexOf('ispe')
    expect(at).toBeGreaterThan(0)
    unsized.set(new TextEncoder().encode('xspe'), at)
    const err = await deriveImagePreview(unsized, 'image/heic').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PreviewRefusedError)
    expect(err).toMatchObject({ reason: 'heic-size-unknown' })
  })

  it('records nothing for SVG', async () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>')
    expect(await deriveImagePreview(svg, 'image/svg+xml')).toEqual({ status: 'none', meta: {} })
  })

  it('refuses a corrupt PNG', async () => {
    const corrupt = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
    await expect(deriveImagePreview(corrupt, 'image/png')).rejects.toThrow()
  })
})
