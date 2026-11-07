/**
 * What a brand's site adds to a match: the faces its CSS names (a bundled one
 * as itself, any other as a hint), its logo file only where it is the logo
 * the screenshot shows, its favicon and share picture where the design has
 * none, its exact colours for measured ones a hair off, and its name.
 */
import { describe, expect, it } from 'vitest'
import { defaultDesign } from '@/lib/shared/design/schema'
import { encodePng, type Image } from '../../extract/png'
import type { ColourRoles } from '../../extract/roles'
import type { FontFact, SiteAsset, SiteFacts } from '../../site/types'
import type { FoundLogo } from '../brand-measure'
import {
  bundledFace,
  faceHints,
  logoAgreement,
  rasterInk,
  resolveSiteFont,
  siteAssetChanges,
  siteFontChanges,
  siteFontPlan,
  siteLogoBytes,
  siteName,
  svgAspect,
  svgColours,
  unmatchedSiteFont,
  withSiteColours,
} from '../brand-site'

const fact = (stack: string[], generic: FontFact['generic'] = 'sans'): FontFact => ({
  family: stack[0]!,
  stack,
  generic,
  from: 'h1',
})

function facts(over: Partial<SiteFacts> = {}): SiteFacts {
  return {
    url: 'https://www.acme.test/',
    name: 'Acme Parcel',
    nameFrom: 'og:site_name',
    language: 'en-gb',
    description: 'Parcels delivered the same day, across the city.',
    themeColour: null,
    favicons: [],
    logos: [],
    shareImage: null,
    fonts: { heading: null, body: null, faces: [], hosted: [] },
    colours: [],
    stylesheets: [],
    manifest: null,
    ...over,
  } as SiteFacts
}

describe('bundledFace', () => {
  it('knows a bundled face by its name, a build suffix, a version or a brand prefix', () => {
    expect(bundledFace('Inter')).toBe('inter')
    expect(bundledFace('Inter Variable')).toBe('inter')
    expect(bundledFace('Inter Tight')).toBe('inter-tight')
    expect(bundledFace('GeistSans')).toBe('geist')
    expect(bundledFace('Source Serif 4')).toBe('source-serif')
    expect(bundledFace('Plus Jakarta Sans')).toBe('jakarta')
    expect(bundledFace('AcmeInter')).toBe('inter')
  })

  it('never takes a different face that starts with a bundled name', () => {
    expect(bundledFace('Interstate')).toBeNull()
    expect(bundledFace('Roboto Mono')).toBeNull()
    expect(bundledFace('Acme Grotesk')).toBeNull()
    expect(bundledFace('')).toBeNull()
  })
})

describe('resolveSiteFont', () => {
  it('uses a bundled face as itself', () => {
    expect(resolveSiteFont(fact(['Manrope', 'system-ui']))).toMatchObject({
      how: 'bundled',
      id: 'manrope',
    })
  })

  it('draws a family it cannot bundle in the nearest face, through its stack', () => {
    const r = resolveSiteFont(fact(['Acme Display', 'Inter', 'sans-serif']))
    expect(r).toMatchObject({ how: 'nearest', id: 'inter', open: false })
    expect(r!.why).toContain('licensed to your site')
  })

  it('marks an open-licence face the site loads from a font service', () => {
    const r = resolveSiteFont(fact(['EB Garamond', 'Georgia', 'serif'], 'serif'), ['EB Garamond'])
    expect(r).toMatchObject({ open: true, how: 'nearest', id: 'source-serif' })
  })

  it('keeps the kind when no near face is known', () => {
    expect(resolveSiteFont(fact(['Kilnface', 'serif'], 'serif'))).toMatchObject({
      how: 'unknown',
      id: null,
      generic: 'serif',
    })
    expect(resolveSiteFont(null)).toBeNull()
  })

  it('gives the fitting an exact hint for a bundled face, a soft one for the rest', () => {
    const plan = siteFontPlan(
      facts({
        fonts: {
          heading: fact(['Acme Display', 'Georgia', 'serif'], 'serif'),
          body: fact(['Inter', 'sans-serif']),
          faces: [],
          hosted: [],
        },
      })
    )
    const hints = faceHints(plan)
    expect(hints.body).toMatchObject({ id: 'inter', exact: true, kind: 'sans' })
    expect(hints.headline).toMatchObject({ exact: false, kind: 'serif' })
  })

  it('gives the headline no hint when its family is only the body’s, inherited', () => {
    const body = { ...fact(['Inter', 'sans-serif']), from: '--font-regular' }
    const plan = siteFontPlan(
      facts({ fonts: { heading: { ...body }, body, faces: [], hosted: [] } })
    )
    expect(plan.headingInherited).toBe(true)
    expect(faceHints(plan)).toMatchObject({ headline: null, body: { id: 'inter', exact: true } })
  })

  it('takes a system or generic stack for no face the brand chose', () => {
    expect(resolveSiteFont(fact(['system-ui', 'sans-serif']))).toMatchObject({
      how: 'unknown',
      id: null,
    })
    expect(resolveSiteFont(fact(['serif'], 'serif'))).toMatchObject({ id: null, generic: 'serif' })
  })

  it('a heading with no font of its own takes the body’s', () => {
    const plan = siteFontPlan(
      facts({ fonts: { heading: null, body: fact(['Figtree']), faces: [], hosted: [] } })
    )
    expect(plan.heading?.id).toBe('figtree')
  })
})

describe('siteFontChanges', () => {
  const plan = siteFontPlan(
    facts({
      fonts: {
        heading: fact(['Fraunces'], 'serif'),
        body: fact(['Inter Tight']),
        faces: [],
        hosted: [],
      },
    })
  )

  it('sets the site’s faces where the fitting set none, at a weight the face loads', () => {
    const changes = siteFontChanges(plan, defaultDesign(), { heading: false, body: false })
    expect(changes.find((c) => c.path === 'brand.fonts.heading')?.value).toEqual({
      kind: 'bundled',
      id: 'fraunces',
    })
    // Body text in Inter Tight is set in Inter, as the fitting does.
    expect(changes.find((c) => c.path === 'brand.fonts.body')?.value).toEqual({
      kind: 'bundled',
      id: 'inter',
    })
  })

  it('leaves the fitting’s faces alone', () => {
    expect(siteFontChanges(plan, defaultDesign(), { heading: true, body: true })).toEqual([])
  })
})

// ---------------------------------------------------------------- logo

const NAVY = [16, 32, 96] as const

function wordmark(width: number, height: number, ink: readonly number[] = NAVY): Image {
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4
      const inside = x >= 4 && x < width - 4 && y >= 4 && y < height - 4
      if (!inside) continue
      data[o] = ink[0]!
      data[o + 1] = ink[1]!
      data[o + 2] = ink[2]!
      data[o + 3] = 255
    }
  return { width, height, data }
}

function cut(w: number, h: number, ink: readonly number[] = NAVY): FoundLogo {
  const img = wordmark(w + 8, h + 8, ink)
  const hex = `#${ink.map((v) => v.toString(16).padStart(2, '0')).join('')}`
  return {
    index: 0,
    cut: {
      image: img,
      png: encodePng(img),
      bounds: [100, 20, 100 + w, 20 + h],
      origin: [96, 16],
      background: [255, 255, 255],
      palette: [{ hex, rgb: [...ink] as [number, number, number], share: 1 }],
      outline: [],
      readsOnLight: true,
      readsOnDark: false,
    },
    placement: { use: 'full_logo', kind: 'wordmark' },
    tone: 'dark',
    oneInk: true,
    box: { x: 0.07, y: 0.02, w: 0.08, h: 0.02 },
  } as unknown as FoundLogo
}

const png = (img: Image): SiteAsset => ({
  url: 'https://www.acme.test/logo.png',
  mime: 'image/png',
  bytes: encodePng(img),
  width: img.width,
  height: img.height,
  from: 'header-img',
})
const svg = (markup: string): SiteAsset => ({
  url: 'https://www.acme.test/',
  mime: 'image/svg+xml',
  bytes: new TextEncoder().encode(markup),
  width: 120,
  height: 30,
  from: 'header-svg',
})

describe('logoAgreement', () => {
  it('takes a raster logo of the same shape and colours', () => {
    expect(logoAgreement(cut(120, 30), png(wordmark(248, 68))).agrees).toBe(true)
  })

  it('keeps the cut for a file of another shape: an icon for a wordmark', () => {
    const r = logoAgreement(cut(120, 30), png(wordmark(72, 72)))
    expect(r.agrees).toBe(false)
    expect(r.why).toMatch(/times as wide as tall/)
  })

  it('keeps the cut for a file in other colours', () => {
    const r = logoAgreement(cut(120, 30), png(wordmark(248, 68, [220, 40, 40])))
    expect(r).toMatchObject({ agrees: false })
    expect(r.why).toContain('#102060')
  })

  it('keeps the cut for a file smaller than the screenshot shows', () => {
    expect(logoAgreement(cut(120, 30), png(wordmark(60, 20))).agrees).toBe(false)
  })

  it('reads an SVG’s shape from its viewBox and its colours from its paint', () => {
    const markup =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 30"><path fill="#102060" d="M0 0h120v30H0z"/></svg>'
    expect(logoAgreement(cut(120, 30), svg(markup)).agrees).toBe(true)
    expect(logoAgreement(cut(120, 30), svg(markup.replace('0 0 120 30', '0 0 30 30'))).agrees).toBe(
      false
    )
  })

  it('an SVG drawn in the text colour is stored in the cut’s ink', () => {
    const markup =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 30"><path fill="currentColor" d="M0 0h120v30H0z"/></svg>'
    const out = new TextDecoder().decode(siteLogoBytes(svg(markup), '#102060')!)
    expect(out).toContain('#102060')
    expect(out).not.toMatch(/currentColor/i)
  })

  it('reads paint and shape helpers', () => {
    expect(svgAspect('<svg viewBox="0 0 200 50">')).toBe(4)
    expect(svgAspect('<svg>')).toBeNull()
    expect(svgColours('<path fill="#fff"/><stop stop-color="rgb(255,0,0)"/>')).toHaveLength(2)
    expect(svgColours('<svg><path d="M0 0"/></svg>')).toEqual([[0, 0, 0]])
    const ink = rasterInk(wordmark(100, 40))!
    expect(ink.w).toBe(92)
    expect(ink.h).toBe(32)
  })
})

describe('siteAssetChanges', () => {
  it('sets the favicon and share picture where the design has none', () => {
    const changes = siteAssetChanges(defaultDesign(), {
      favicon: 'logos/f.png',
      shareImage: 'logos/s.png',
    })
    expect(changes.map((c) => c.path)).toEqual(['brand.favicon', 'brand.shareImage'])
  })

  it('never replaces the person’s own', () => {
    const design = defaultDesign()
    design.brand.favicon = { key: 'logos/mine.png' }
    expect(siteAssetChanges(design, { favicon: 'logos/f.png', shareImage: null })).toEqual([])
  })
})

describe('withSiteColours', () => {
  const roles = {
    identity: { value: '#5a3cfb', why: '', by: 'rule' },
    action: { value: { role: 'accent', hex: '#5a3cfb' }, why: '', by: 'rule' },
    links: { value: { role: 'ink', hex: '#111111' }, why: '', by: 'rule' },
    highlight: { value: null, why: '', by: 'rule' },
    open: ['identity', 'highlight'],
  } as unknown as ColourRoles

  it('takes the site’s exact value for a measured colour a hair off it', () => {
    const { roles: out, snapped } = withSiteColours(roles, [
      { hex: '#533afd', from: '--brand-primary', weight: 3 },
    ])
    expect(out.identity.value).toBe('#533afd')
    expect(out.action.value.hex).toBe('#533afd')
    expect(out.links.value.hex).toBe('#111111')
    expect(snapped).toHaveLength(2)
    // The brand colour, named by the site, is no longer an open question.
    expect(out.open).toEqual(['highlight'])
  })

  it('never moves a colour to a different one', () => {
    const { roles: out } = withSiteColours(roles, [{ hex: '#e0301e', from: '--accent', weight: 2 }])
    expect(out.identity.value).toBe('#5a3cfb')
    expect(out.open).toEqual(['identity', 'highlight'])
  })
})

describe('siteName', () => {
  it('trusts a plain site name, and of a title only the part that is the site’s host', () => {
    expect(siteName(facts())).toBe('Acme Parcel')
    expect(siteName(facts({ nameFrom: 'title', name: 'The parcel workspace' }))).toBeNull()
    expect(siteName(facts({ nameFrom: 'title', name: 'A farewell to Acme' }))).toBeNull()
    expect(siteName(facts({ nameFrom: 'title', name: 'Acme | Parcels across town' }))).toBe('Acme')
    expect(siteName(facts({ name: 'Acme – Parcels | Acme UK' }))).toBe('Acme')
    expect(siteName(facts({ name: 'Acme.com' }))).toBe('Acme')
    expect(
      siteName(facts({ url: 'https://www.acme.co.uk/', nameFrom: 'title', name: 'acme' }))
    ).toBe('acme')
    expect(siteName(null)).toBeNull()
  })
})

describe('unmatchedSiteFont', () => {
  const planOf = (heading: FontFact | null, body: FontFact | null) =>
    siteFontPlan(facts({ fonts: { heading, body, faces: [], hosted: [] } }))

  it('names a heading face the portal does not bundle, for its upload', () => {
    const plan = planOf(fact(['Acme Display', 'Georgia', 'serif'], 'serif'), fact(['Inter']))
    expect(unmatchedSiteFont(plan, defaultDesign())).toEqual({
      family: 'Acme Display',
      slot: 'heading',
    })
  })

  it('names a body face alone when the headings are bundled', () => {
    const plan = planOf(fact(['Fraunces'], 'serif'), fact(['Acme Text', 'sans-serif']))
    expect(unmatchedSiteFont(plan, defaultDesign())).toEqual({ family: 'Acme Text', slot: 'body' })
  })

  it('uses one face for both when the site does', () => {
    const plan = planOf(null, fact(['Acme Sans', 'sans-serif']))
    expect(unmatchedSiteFont(plan, defaultDesign())).toEqual({ family: 'Acme Sans', slot: 'both' })
  })

  it('names nothing when every face is bundled, or none was named', () => {
    expect(
      unmatchedSiteFont(planOf(fact(['Fraunces']), fact(['Inter'])), defaultDesign())
    ).toBeNull()
    expect(unmatchedSiteFont(planOf(null, null), defaultDesign())).toBeNull()
    expect(
      unmatchedSiteFont(planOf(fact(['system-ui', 'sans-serif']), null), defaultDesign())
    ).toBeNull()
  })

  it('names nothing once that family is uploaded', () => {
    const design = defaultDesign()
    design.brand.fonts.heading = {
      kind: 'uploaded',
      family: 'Acme Display',
      files: [{ key: 'fonts/acme.woff2', weight: 400, style: 'normal' }],
      fallback: 'inter',
    }
    const plan = planOf(fact(['Acme Display', 'serif'], 'serif'), fact(['Inter']))
    expect(unmatchedSiteFont(plan, design)).toBeNull()
  })
})
