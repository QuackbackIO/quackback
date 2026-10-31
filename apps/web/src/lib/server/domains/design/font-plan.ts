/**
 * What a design's fonts need in a portal page's head: each bundled family's
 * stylesheet, linked so the page does not wait for its script to ask, and at
 * most two Latin files preloaded, the body at 400 and the headings at their
 * weight, so text draws in its face from the first paint. Inter ships with
 * the app's own stylesheet and needs neither. An uploaded family's faces are
 * in the theme's CSS, so only its file is preloaded, from storage.
 */
import manifest from 'virtual:quackback-font-manifest'
import type { FontLink } from '@/lib/shared/design/view'
import type { PortalDesign } from '@/lib/shared/design/schema'
import { uploadedFontFile, uploadedFontUrl } from '@/lib/shared/design/fonts'

type FontManifest = typeof manifest

/** The family's Latin file at this weight, or at the nearest weight it has. */
function nearest(latin: Record<string, string>, weight: number): string | undefined {
  const weights = Object.keys(latin).map(Number)
  if (weights.length === 0) return undefined
  const best = weights.reduce((a, b) => (Math.abs(b - weight) < Math.abs(a - weight) ? b : a))
  return latin[String(best)]
}

export function fontLinks(doc: PortalDesign, files: FontManifest = manifest): FontLink[] {
  const { body, heading, headingWeight } = doc.brand.fonts
  const wanted: Array<[string, number]> = []
  const stylesheets = new Set<string>()
  const preloads = new Set<string>()
  for (const [font, weight] of [
    [body, 400],
    [heading, headingWeight],
  ] as const) {
    // An uploaded family's faces are in the theme's CSS; its file loads from storage.
    if (font.kind === 'uploaded') preloads.add(uploadedFontUrl(uploadedFontFile(font, weight).key))
    else wanted.push([font.id, weight])
  }
  for (const [id, weight] of wanted) {
    const family = files[id]
    if (!family) continue
    stylesheets.add(family.css)
    const file = nearest(family.latin, weight)
    if (file) preloads.add(file)
  }
  return [
    ...[...preloads].map((href): FontLink => ({
      rel: 'preload',
      href,
      as: 'font',
      type: 'font/woff2',
      crossOrigin: 'anonymous',
    })),
    ...[...stylesheets].map((href): FontLink => ({ rel: 'stylesheet', href })),
  ]
}
