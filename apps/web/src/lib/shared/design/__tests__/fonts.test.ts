/**
 * The design engine's one font registry: every bundled id has a label, a
 * stack and the weights its stylesheet loads, and a stack resolves back to
 * its id so the portal loads the family a design uses.
 */
import { readdirSync, readFileSync } from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { fontModules } from '@/lib/build/font-manifest'
import { BRANDING_FONTS } from '@/lib/shared/theme/fonts'
import {
  BUNDLED_FONTS,
  bundledFontIdForStack,
  bundledFontStack,
  closestWeight,
  designFontIds,
  fontWeights,
  tunedWeights,
  uploadedFontFaces,
  uploadedFontFile,
  wordGap,
  WORD_GAP_FLOOR,
} from '../fonts'
import { designView } from '../design-view'
import { BUNDLED_FONT_IDS } from '../options'
import { defaultDesign, portalDesign, UPLOADED_FONT_KEY } from '../schema'

describe('wordGap', () => {
  it('is a family’s own space, measured, and a typical one where it is not known', () => {
    // Plus Jakarta Sans draws its space at 0.165em, well under a typical sans's.
    expect(wordGap({ kind: 'bundled', id: 'jakarta' })).toBe('0.165em')
    expect(wordGap({ kind: 'bundled', id: 'inter' })).toBe('0.237em')
    expect(wordGap({ kind: 'bundled', id: 'system' })).toBe('0.25em')
    expect(
      wordGap({ kind: 'uploaded', family: 'Brand', fallback: 'jakarta', files: [] } as never)
    ).toBe('0.25em')
  })

  it('knows every bundled family but the system ones, and their spaces sit near a quarter em', () => {
    for (const id of BUNDLED_FONT_IDS) {
      const space = parseFloat(wordGap({ kind: 'bundled', id }))
      expect(space, id).toBeGreaterThan(0.15)
      expect(space, id).toBeLessThanOrEqual(0.6)
    }
    expect(parseFloat(WORD_GAP_FLOOR)).toBeLessThan(0.237)
  })
})

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

  it('lists exactly the weights each family’s stylesheet loads, so no weight is faked', () => {
    const src = path.resolve(__dirname, '../../../..')
    const loader = readFileSync(path.join(src, 'lib/shared/theme/font-loader.ts'), 'utf8')
    const files = new Map([...fontModules(loader, src)].map(([file, id]) => [id, file]))
    for (const [id, font] of Object.entries(BUNDLED_FONTS)) {
      if (font.category === 'system' || id === 'inter') continue
      const file = files.get(id)
      expect(file, id).toBeDefined()
      const css = readFileSync(file!, 'utf8')
      const loaded = [...css.matchAll(/@fontsource\/[a-z0-9-]+\/(\d{3})\.css/g)].map((m) => +m[1]!)
      expect(loaded, id).toEqual([...font.weights])
    }
  })

  it('loads the light weight of every family whose package ships one, so a light headline is drawn light', () => {
    // A thin serif headline (300) matched Merriweather, Fraunces or Source Serif at 300,
    // each shipped at 300, but none was loaded there: it was drawn at 400 or heavier.
    const src = path.resolve(__dirname, '../../../..')
    const loader = readFileSync(path.join(src, 'lib/shared/theme/font-loader.ts'), 'utf8')
    for (const [file, id] of fontModules(loader, src)) {
      const pkg = readFileSync(file, 'utf8').match(/@fontsource\/([a-z0-9-]+)\//)?.[1]
      if (!pkg) continue
      const dir = path.dirname(
        require.resolve(`@fontsource/${pkg}/package.json`, { paths: [__dirname] })
      )
      const ships = readdirSync(dir).includes('300.css')
      expect(BUNDLED_FONTS[id as keyof typeof BUNDLED_FONTS].weights.includes(300), id).toBe(ships)
    }
  })

  it('offers Inter light, as its variable face loads every weight from 100 to 900', () => {
    // A light display headline (a payments site's 300) drawn in Inter was snapped to 400.
    const css = readFileSync(
      require.resolve('@fontsource-variable/inter/index.css', { paths: [__dirname] }),
      'utf8'
    )
    expect(css).toMatch(/font-weight: 100 900;/)
    expect(BUNDLED_FONTS.inter.weights).toContain(300)
  })

  it('covers the classes brands are set in: heavy, wide, slab, display serif and rounded', () => {
    expect(BUNDLED_FONTS.archivo.weights).toContain(900)
    expect(BUNDLED_FONTS.unbounded.category).toBe('display')
    expect(BUNDLED_FONTS['roboto-slab'].category).toBe('slab')
    expect(BUNDLED_FONTS['bodoni-moda'].weights).toContain(900)
    expect(BUNDLED_FONTS.quicksand.category).toBe('rounded')
    expect(BUNDLED_FONTS.fraunces.weights).toContain(900)
  })

  it('offers Mona Sans and Hanken Grotesk as sans, with the weights their stylesheets load', () => {
    for (const id of ['mona-sans', 'hanken-grotesk'] as const) {
      expect(BUNDLED_FONTS[id].category, id).toBe('sans')
      expect(BUNDLED_FONTS[id].weights, id).toEqual([300, 400, 500, 600, 700, 800])
      expect(bundledFontIdForStack(bundledFontStack(id)), id).toBe(id)
    }
    expect(BUNDLED_FONTS['mona-sans'].label).toBe('Mona Sans')
    expect(BUNDLED_FONTS['hanken-grotesk'].label).toBe('Hanken Grotesk')
  })

  it('resolves a stack back to its id', () => {
    expect(bundledFontIdForStack(bundledFontStack('fraunces'))).toBe('fraunces')
    expect(bundledFontIdForStack('"Comic Sans MS", cursive')).toBeNull()
  })
})

describe('the weights an exact value can take', () => {
  it('are the weights of the face that draws it', () => {
    const doc = defaultDesign()
    doc.brand.fonts.heading = { kind: 'bundled', id: 'lato' }
    doc.brand.fonts.body = { kind: 'bundled', id: 'quicksand' }
    expect(tunedWeights(doc, 'heading')).toEqual([300, 400, 700])
    expect(tunedWeights(doc, 'card')).toEqual([300, 400, 700])
    // Headlines are in the heading face until they have their own.
    expect(tunedWeights(doc, 'headline')).toEqual([300, 400, 700])
    doc.brand.fonts.display = { kind: 'bundled', id: 'bodoni-moda' }
    expect(tunedWeights(doc, 'headline')).toEqual([400, 500, 600, 700, 800, 900])
    expect(tunedWeights(doc, 'link')).toEqual([300, 400, 500, 600, 700])
    expect(tunedWeights(doc, 'button')).toEqual([300, 400, 500, 600, 700])
  })

  it('are an uploaded family’s upright files', () => {
    expect(
      fontWeights({
        kind: 'uploaded',
        family: 'Acme',
        fallback: 'inter',
        files: [
          { key: 'fonts/a.woff2', weight: 700, style: 'normal' },
          { key: 'fonts/b.woff2', weight: 300, style: 'normal' },
          { key: 'fonts/c.woff2', weight: 900, style: 'italic' },
        ],
      })
    ).toEqual([300, 700])
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
    for (const key of [
      'fonts/2026/10/abc-brand_bold.woff2',
      'fonts/kiln/unbounded-700.woff2',
      'fonts/2026/10/abc-brand.woff',
      'fonts/2026/10/abc-brand.ttf',
      'fonts/2026/10/abc-brand.otf',
    ])
      expect(key).toMatch(UPLOADED_FONT_KEY)
    for (const key of [
      'logos/2026/10/abc-brand.woff2',
      'fonts/2026/10/abc-brand.eot',
      'fonts/2026/10/abc-brand.svg',
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
    const other = defaultDesign()
    other.brand.fonts.body = {
      ...unbounded,
      family: 'Kiln Text',
      files: [
        { key: 'fonts/2026/10/d-kiln-400.ttf', weight: 400, style: 'normal' },
        { key: 'fonts/2026/10/e-kiln-700.otf', weight: 700, style: 'normal' },
        { key: 'fonts/2026/10/f-kiln-300.woff', weight: 300, style: 'normal' },
      ],
    }
    const mixed = uploadedFontFaces(other)
    expect(mixed).toContain('d-kiln-400.ttf") format("truetype")')
    expect(mixed).toContain('e-kiln-700.otf") format("opentype")')
    expect(mixed).toContain('f-kiln-300.woff") format("woff")')
    expect(designView(doc, null).themeStyles.startsWith(faces)).toBe(true)
    expect(designView(doc, null).fontSans).toBe(`"Unbounded", ${bundledFontStack('space-grotesk')}`)
  })

  it('pick the upright file nearest a weight', () => {
    expect(uploadedFontFile(unbounded, 600).weight).toBe(700)
    expect(uploadedFontFile(unbounded, 900).weight).toBe(700)
    expect(uploadedFontFile(unbounded, 300).weight).toBe(400)
  })
})

describe('closestWeight', () => {
  const lora = { kind: 'bundled', id: 'lora' } as const
  it('keeps the weight when the new face loads it', () => {
    expect(closestWeight(lora, 500)).toBe(500)
  })

  it('takes the nearest weight the new face loads, so a light headline stays light', () => {
    // Lora loads 400 to 700: a 300 headline had jumped to 600, an 800 one down to 600.
    expect(closestWeight(lora, 300)).toBe(400)
    expect(closestWeight(lora, 800)).toBe(700)
  })
})
