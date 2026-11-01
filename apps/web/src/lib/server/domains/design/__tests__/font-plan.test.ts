/**
 * The fonts a portal page's head carries: each bundled family's stylesheet,
 * and at most two Latin files, the body at 400 and the headings at their
 * weight or the nearest one the family has.
 */
import { describe, expect, it } from 'vitest'
import { defaultDesign, type PortalDesign } from '@/lib/shared/design/schema'
import { fontLinks } from '../font-plan'

/** The links as stylesheets and preloads, for reading. */
function fontPlan(doc: PortalDesign, files: typeof FILES) {
  const links = fontLinks(doc, files)
  return {
    stylesheets: links.filter((l) => l.rel === 'stylesheet').map((l) => l.href),
    preloads: links.filter((l) => l.rel === 'preload').map((l) => l.href),
  }
}

const FILES = {
  fraunces: {
    css: '/assets/fraunces.css',
    latin: { '400': '/assets/fraunces-400.woff2', '700': '/assets/fraunces-700.woff2' },
  },
  'ibm-plex-sans': {
    css: '/assets/plex.css',
    latin: { '400': '/assets/plex-400.woff2', '600': '/assets/plex-600.woff2' },
  },
}

function design(fonts: Partial<PortalDesign['brand']['fonts']>) {
  const doc = defaultDesign()
  doc.brand.fonts = { ...doc.brand.fonts, ...fonts }
  return doc
}

describe('fontLinks', () => {
  it('preloads as crossorigin woff2, before the stylesheets', () => {
    const doc = design({ heading: { kind: 'bundled', id: 'fraunces' }, headingWeight: 700 })
    expect(fontLinks(doc, FILES)).toEqual([
      {
        rel: 'preload',
        href: '/assets/fraunces-700.woff2',
        as: 'font',
        type: 'font/woff2',
        crossOrigin: 'anonymous',
      },
      { rel: 'stylesheet', href: '/assets/fraunces.css' },
    ])
  })

  it('links both families and preloads the body at 400 and the headings at their weight', () => {
    const doc = design({
      body: { kind: 'bundled', id: 'ibm-plex-sans' },
      heading: { kind: 'bundled', id: 'fraunces' },
      headingWeight: 700,
    })
    expect(fontPlan(doc, FILES)).toEqual({
      stylesheets: ['/assets/plex.css', '/assets/fraunces.css'],
      preloads: ['/assets/plex-400.woff2', '/assets/fraunces-700.woff2'],
    })
  })

  it('takes the nearest weight a family has, and one file for one family at one weight', () => {
    expect(
      fontPlan(
        design({
          body: { kind: 'bundled', id: 'fraunces' },
          heading: { kind: 'bundled', id: 'fraunces' },
          headingWeight: 600,
        }),
        FILES
      )
    ).toEqual({
      stylesheets: ['/assets/fraunces.css'],
      preloads: ['/assets/fraunces-400.woff2', '/assets/fraunces-700.woff2'],
    })
    expect(
      fontPlan(
        design({
          body: { kind: 'bundled', id: 'fraunces' },
          heading: { kind: 'bundled', id: 'fraunces' },
          headingWeight: 500,
        }),
        FILES
      ).preloads
    ).toEqual(['/assets/fraunces-400.woff2'])
  })

  it('needs nothing for Inter, which ships with the app', () => {
    expect(fontPlan(defaultDesign(), FILES)).toEqual({ stylesheets: [], preloads: [] })
  })
})

describe('fontLinks for an uploaded family', () => {
  it('preloads its file nearest the weight from storage, with no stylesheet', () => {
    const doc = design({
      heading: {
        kind: 'uploaded',
        family: 'Unbounded',
        files: [
          { key: 'fonts/2026/10/a-unbounded-400.woff2', weight: 400, style: 'normal' },
          { key: 'fonts/2026/10/b-unbounded-700.woff2', weight: 700, style: 'normal' },
        ],
        fallback: 'inter',
      },
      headingWeight: 800,
    })
    expect(fontPlan(doc, FILES)).toEqual({
      stylesheets: [],
      preloads: ['/api/storage/fonts/2026/10/b-unbounded-700.woff2'],
    })
  })
})
