import { describe, expect, it } from 'vitest'
import {
  FONT_FORMATS,
  FONT_UPLOADS,
  UPLOADED_FONT_KEY,
  fontExtension,
  fontTypeExtension,
  sizeLabel,
  uploadedFontFaces,
  uploadedFontUrl,
} from '../font-uploads'

describe('font upload formats', () => {
  it('caps each format and six files per family', () => {
    expect(FONT_FORMATS.woff2.maxBytes).toBe(400 * 1024)
    expect(FONT_FORMATS.woff.maxBytes).toBe(600 * 1024)
    expect(FONT_FORMATS.ttf.maxBytes).toBe(1024 * 1024)
    expect(FONT_FORMATS.otf.maxBytes).toBe(1024 * 1024)
    expect(FONT_UPLOADS.maxFiles).toBe(6)
    expect(FONT_UPLOADS.prefix).toBe('fonts')
  })

  it('reads a format from a file name or a content type', () => {
    expect(fontExtension('Brand-Bold.WOFF2')).toBe('woff2')
    expect(fontExtension('Brand.eot')).toBeNull()
    expect(fontExtension('toString')).toBeNull()
    expect(fontTypeExtension('font/otf')).toBe('otf')
    expect(fontTypeExtension('image/png')).toBeNull()
  })

  it('labels sizes for a refusal', () => {
    expect(sizeLabel(400 * 1024)).toBe('400 KB')
    expect(sizeLabel(1024 * 1024)).toBe('1 MB')
  })
})

describe('UPLOADED_FONT_KEY', () => {
  it('accepts keys the upload route issues', () => {
    expect(UPLOADED_FONT_KEY.test('fonts/2026/10/abc-brand-bold.woff2')).toBe(true)
  })
  it.each([
    'fonts/../secret.woff2',
    'fonts/a/../b.woff2',
    'fonts/.hidden.woff2',
    'logos/a.woff2',
    'fonts/a.png',
    'fonts/a").x{}.woff2',
    'fonts/a b.woff2',
    'fonts/a;b.woff2',
    "fonts/a'b.woff2",
    'fonts/A.woff2',
  ])('rejects %s', (key) => {
    expect(UPLOADED_FONT_KEY.test(key)).toBe(false)
  })
})

describe('uploadedFontFaces', () => {
  it('writes one @font-face per file, served from this origin', () => {
    const css = uploadedFontFaces({
      family: 'Sohne',
      fallback: 'inter',
      files: [
        { key: 'fonts/2026/10/a-400.woff2', weight: 400, style: 'normal' },
        { key: 'fonts/2026/10/a-700i.otf', weight: 700, style: 'italic' },
      ],
    })
    expect(uploadedFontUrl('fonts/x.woff2')).toBe('/api/storage/fonts/x.woff2')
    expect(css).toContain(
      '@font-face { font-family: "Sohne"; src: url("/api/storage/fonts/2026/10/a-400.woff2") format("woff2"); font-weight: 400; font-style: normal; font-display: swap; }'
    )
    expect(css).toContain('format("opentype"); font-weight: 700; font-style: italic;')
  })

  it('writes a variable font’s file with the weights it covers', () => {
    const font = (weightTo: number) => ({
      family: 'Sohne',
      fallback: 'inter' as const,
      files: [{ key: 'fonts/2026/11/v.woff2', weight: 100, weightTo, style: 'normal' as const }],
    })
    expect(uploadedFontFaces(font(900))).toContain('font-weight: 100 900;')
    // A range that runs backwards or past 900 is no font a stylesheet may hold.
    expect(uploadedFontFaces(font(100))).toBe('')
    expect(uploadedFontFaces(font(1200))).toBe('')
  })

  it('writes nothing for a family or key that could break out of the rule', () => {
    expect(
      uploadedFontFaces({
        family: 'A"}body{x:y',
        fallback: 'inter',
        files: [{ key: 'fonts/a.woff2', weight: 400, style: 'normal' }],
      })
    ).toBe('')
    expect(
      uploadedFontFaces({
        family: 'Ok',
        fallback: 'inter',
        files: [{ key: 'fonts/a").x{}.woff2', weight: 400, style: 'normal' }],
      })
    ).toBe('')
  })
})
