/**
 * The design engine's one font registry: every bundled id has a label, a
 * stack and the weights its stylesheet loads, and a stack resolves back to
 * its id so the portal loads the family a design uses.
 */
import { describe, expect, it } from 'vitest'
import { BRANDING_FONTS } from '@/lib/shared/theme/fonts'
import {
  BUNDLED_FONTS,
  bundledFontIdForStack,
  bundledFontStack,
  designFontIds,
  uploadedFontFaces,
  uploadedFontFile,
} from '../fonts'
import { designView } from '../design-view'
import { BUNDLED_FONT_IDS } from '../options'
import { defaultDesign, portalDesign, UPLOADED_FONT_KEY } from '../schema'

describe('BUNDLED_FONTS', () => {
  it('covers every bundled id', () => {
    expect(Object.keys(BUNDLED_FONTS).sort()).toEqual([...BUNDLED_FONT_IDS].sort())
  })

  it('keeps today’s stacks for today’s families', () => {
    for (const font of BRANDING_FONTS) expect(bundledFontStack(font.id), font.id).toBe(font.value)
  })

  it('loads the regular weight and a heading weight for every family', () => {
    for (const [id, font] of Object.entries(BUNDLED_FONTS)) {
      expect(font.weights, id).toContain(400)
      expect(Math.max(...font.weights), id).toBeGreaterThanOrEqual(600)
    }
  })

  it('resolves a stack back to its id', () => {
    expect(bundledFontIdForStack(bundledFontStack('fraunces'))).toBe('fraunces')
    expect(bundledFontIdForStack('"Comic Sans MS", cursive')).toBeNull()
  })
})

describe('designFontIds', () => {
  it('lists the body and heading families once each', () => {
    const doc = defaultDesign()
    expect(designFontIds(doc)).toEqual(['inter'])
    doc.brand.fonts.heading = { kind: 'bundled', id: 'fraunces' }
    expect(designFontIds(doc)).toEqual(['inter', 'fraunces'])
  })

  it('loads the headlines’ own face too', () => {
    const doc = defaultDesign()
    doc.brand.fonts.display = { kind: 'bundled', id: 'oswald' }
    expect(designFontIds(doc)).toEqual(['inter', 'oswald'])
  })

  it('loads an uploaded family’s bundled fallback', () => {
    const doc = defaultDesign()
    doc.brand.fonts.body = { kind: 'uploaded', family: 'Acme Sans', files: [], fallback: 'manrope' }
    expect(designFontIds(doc)).toEqual(['manrope', 'inter'])
  })
})

const unbounded = {
  kind: 'uploaded' as const,
  family: 'Unbounded',
  files: [
    { key: 'fonts/2026/10/a-unbounded-400.woff2', weight: 400, style: 'normal' as const },
    { key: 'fonts/2026/10/b-unbounded-700.woff2', weight: 700, style: 'normal' as const },
    { key: 'fonts/2026/10/c-unbounded-800-italic.woff2', weight: 800, style: 'italic' as const },
  ],
  fallback: 'space-grotesk' as const,
}

describe('uploaded fonts', () => {
  it('keep their files under fonts/, in keys that cannot end a url()', () => {
    for (const key of ['fonts/2026/10/abc-brand_bold.woff2', 'fonts/kiln/unbounded-700.woff2'])
      expect(key).toMatch(UPLOADED_FONT_KEY)
    for (const key of [
      'logos/2026/10/abc-brand.woff2',
      'fonts/2026/10/abc-brand.woff',
      'fonts/../logos/x.woff2',
      'fonts/.hidden.woff2',
      'fonts/a") ; } body { color: red } x { a: url("b.woff2',
      'fonts/A-Brand.woff2',
    ])
      expect(key).not.toMatch(UPLOADED_FONT_KEY)
    const doc = defaultDesign()
    doc.brand.fonts.heading = {
      ...unbounded,
      files: [{ key: 'logos/x.woff2', weight: 700, style: 'normal' }],
    }
    expect(portalDesign.safeParse(doc).success).toBe(false)
  })

  it('load through @font-face rules, one per file, from the portal’s own origin', () => {
    const doc = defaultDesign()
    doc.brand.fonts.heading = unbounded
    doc.brand.fonts.body = unbounded
    const faces = uploadedFontFaces(doc)
    expect(faces.match(/@font-face/g)).toHaveLength(3)
    expect(faces).toContain(
      '@font-face { font-family: "Unbounded"; src: url("/api/storage/fonts/2026/10/b-unbounded-700.woff2") format("woff2"); font-weight: 700; font-style: normal; font-display: swap; }'
    )
    expect(faces).toContain('font-weight: 800; font-style: italic;')
    expect(uploadedFontFaces(defaultDesign())).toBe('')
    expect(designView(doc, null).themeStyles.startsWith(faces)).toBe(true)
    expect(designView(doc, null).fontSans).toBe(`"Unbounded", ${bundledFontStack('space-grotesk')}`)
  })

  it('pick the upright file nearest a weight', () => {
    expect(uploadedFontFile(unbounded, 600).weight).toBe(700)
    expect(uploadedFontFile(unbounded, 900).weight).toBe(700)
    expect(uploadedFontFile(unbounded, 300).weight).toBe(400)
  })
})
