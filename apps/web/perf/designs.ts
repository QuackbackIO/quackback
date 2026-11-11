/**
 * Designed portals for the bench. The bench's live portal has no design, so
 * the journeys that came before it keep measuring what they always have; each
 * fixture design below is drawn through a shared preview link of its own
 * (`/?share=<token>`), which renders the portal with that design exactly as
 * the design engine would once it is published.
 *
 * The fixtures are the design engine's fictional brands. Their stored files
 * (logos, hero photos, an uploaded font) are not in the bench's storage, so a
 * journey serves them itself: images as drawn stand-ins of the same size, and
 * the uploaded font as the bundled file of that family.
 */
import { readFileSync } from 'node:fs'
import type { Page, Route } from '@playwright/test'

/**
 * The designs measured, each for something a visitor's first paint must get
 * right: web fonts in the headings, a hero photo beside the words and Home's
 * blocks (juniper), an uploaded display font (kiln), a dark portal with Home
 * (orbit), and a hero photo behind the words (plume).
 */
export const BENCH_DESIGNS = ['juniper', 'kiln', 'orbit', 'plume'] as const

/** Designs with a preview link but no load journeys of their own: a feed that opens on Top (tandem). */
export const PREVIEW_ONLY_DESIGNS = ['tandem'] as const
export type BenchDesign = (typeof BENCH_DESIGNS)[number] | (typeof PREVIEW_ONLY_DESIGNS)[number]

const FIXTURES = new URL('../src/lib/shared/design/__tests__/fixtures/', import.meta.url)

/** The fixture's stored document, as the design engine keeps it. */
export function benchDesignDocument(design: BenchDesign): unknown {
  return JSON.parse(readFileSync(new URL(`${design}.json`, FIXTURES), 'utf8'))
}

/** The preview link token for a design: fixed, so journeys can name it. */
export function benchDesignToken(design: BenchDesign): string {
  return `qbp_${`bench-${design}`.padEnd(43, '0')}`
}

/** A page of the portal drawn with a design. */
export function designedPath(design: BenchDesign, path = '/'): string {
  const url = new URL(path, 'http://bench')
  url.searchParams.set('share', benchDesignToken(design))
  return `${url.pathname}${url.search}`
}

/** A stand-in image of a stored file's size: a logo square, a wordmark or a photo. */
function standInImage(key: string): string {
  const [width, height] = /wordmark/.test(key)
    ? [600, 150]
    : /^portal-images\//.test(key)
      ? [1600, 1000]
      : [256, 256]
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<defs><linearGradient id="g" x2="1" y2="1"><stop offset="0" stop-color="#2f5d3a"/><stop offset="1" stop-color="#c58b2b"/></linearGradient></defs>` +
    `<rect width="100%" height="100%" fill="url(#g)"/></svg>`
  )
}

const FONTSOURCE = new URL('../node_modules/@fontsource/', import.meta.url)

/** An uploaded font's stand-in: the bundled file of the same family and weight. */
function standInFont(key: string): Buffer | null {
  const match = /^fonts\/[^/]+\/([a-z-]+)-(\d{3})\.woff2$/.exec(key)
  if (!match) return null
  const [, family, weight] = match
  return readFileSync(new URL(`${family}/files/${family}-latin-${weight}-normal.woff2`, FONTSOURCE))
}

async function serveStoredFile(route: Route) {
  const key = decodeURIComponent(new URL(route.request().url()).pathname).replace(
    /^\/api\/storage\//,
    ''
  )
  const font = key.startsWith('fonts/') ? standInFont(key) : null
  if (font) return route.fulfill({ status: 200, contentType: 'font/woff2', body: font })
  return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: standInImage(key) })
}

/** Serves the designs' stored files for this page. */
export async function serveDesignFiles(page: Page): Promise<void> {
  await page.route('**/api/storage/**', serveStoredFile)
}
