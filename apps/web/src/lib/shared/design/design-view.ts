/**
 * A design as a portal document applies it: the scoped CSS, the structural
 * attributes and the families to load. The server builds it for published
 * and converted designs; the Appearance preview builds it for the draft with
 * the same code, so the preview cannot drift from what visitors get.
 *
 * Kept apart from view.ts, which every portal page imports, so the resolver
 * ships only where a design is resolved.
 */
import { layoutAttributes, photoShade } from './components'
import { rewritePartAliases } from './parts'
import { designFontIds, fontStack, uploadedFontFaces } from './fonts'
import { renderDesignCss, resolveDesign, type ResolvedDesign } from './resolve'
import { readableStatusColours } from './status-colours'
import {
  shareCardFacts,
  shareCardVersion,
  shortHash,
  squareIconPath,
  themeColours,
} from './share-card'
import type { PortalDesign } from './schema'
import type { BandImage, DesignLogo, PortalCopy, PortalDesignView } from './view'
import { isEmptyTiptapDoc } from '@/lib/shared/utils/is-empty-tiptap-doc'
import type { TiptapContent } from '@/lib/shared/db-types'
import { layoutValue } from './defaults'

export function designView(
  doc: PortalDesign,
  revision: number | null
): Extract<PortalDesignView, { engine: 'v2' }> {
  const resolved = resolveDesign(doc)
  return {
    engine: 'v2',
    mode: doc.mode,
    revision,
    themeStyles: [uploadedFontFaces(doc), renderDesignCss(resolved)].filter(Boolean).join(' '),
    customCss: doc.css ? `@layer tenant {\n${rewritePartAliases(doc.css)}\n}` : '',
    fontSans: fontStack(doc.brand.fonts.body),
    fontIds: designFontIds(doc),
    attributes: layoutAttributes(doc),
    feedback: {
      welcome: feedbackWelcome(doc),
      headline: doc.pages.feedback.headline,
      defaultSort: doc.pages.feedback.defaultSort,
      openOn: doc.pages.feedback.openOn ?? null,
      copy: portalCopy(doc),
    },
    home: doc.pages.home,
    titles: doc.pages.titles ?? {},
    nav: doc.nav,
    logo: designLogo(doc),
    bandImage: bandImage(doc),
    icons: {
      favicon: doc.brand.favicon ? designAssetUrl(doc.brand.favicon.key) : null,
      shareImage: doc.brand.shareImage ? designAssetUrl(doc.brand.shareImage.key) : null,
      mark: markIcon(doc),
      card: shareCardVersion(shareCardFacts(doc, resolved)),
      themeColor: themeColours(resolved),
    },
    statusColours: statusColours(doc, resolved),
  }
}

/** The design's own words for the portal's controls: the feed's, and the New request button's. */
function portalCopy(doc: PortalDesign): PortalCopy {
  const request = doc.pages.support?.request
  return request ? { ...doc.pages.feedback.copy, request } : doc.pages.feedback.copy
}

/** The logo's colours for status markers, when the design asks for them, readable on the page and cards. */
function statusColours(doc: PortalDesign, resolved: ResolvedDesign): string[] | null {
  const colours = doc.brand.logoColours
  if (doc.layout.status !== 'brand' || !colours?.length) return null
  // A design that shows light is read on light first; a dark-only one on dark.
  const vars = resolved.light ?? resolved.dark
  const backgrounds = [vars?.background, vars?.card].filter((bg): bg is string => !!bg)
  return backgrounds.length ? readableStatusColours(colours, backgrounds) : [...colours]
}

/**
 * The brand icon as a favicon: an SVG as it is, since it scales; any other
 * image fitted into a square on the server, so a wide icon is not squashed.
 */
function markIcon(doc: PortalDesign): string | null {
  const { mark } = doc.brand.logo
  const key = (mark.light ?? mark.dark)?.key
  if (!key) return null
  return /\.svg$/i.test(key) ? designAssetUrl(key) : squareIconPath(shortHash(key))
}

/** Where the portal loads a stored brand file from: its own origin. */
export const designAssetUrl = (key: string) => `/api/storage/${key}`

/**
 * An uploaded image's srcset: its smaller copies, then the image itself, by
 * width. Only when the image's own width is known, so the browser can size
 * every candidate; an image stored as one file has none.
 */
export function imageSrcSet(image: {
  key: string
  width?: number
  variants?: ReadonlyArray<{ key: string; w: number }>
}): string | null {
  if (!image.width || !image.variants?.length) return null
  return [
    ...image.variants
      .filter((variant) => variant.w < image.width!)
      .sort((a, b) => a.w - b.w)
      .map((variant) => `${designAssetUrl(variant.key)} ${variant.w}w`),
    `${designAssetUrl(image.key)} ${image.width}w`,
  ].join(',')
}

function bandImage(doc: PortalDesign): BandImage | null {
  const image = doc.brand.heroImage
  if (!image) return null
  const srcSet = imageSrcSet(image)
  return {
    url: designAssetUrl(image.key),
    ...(srcSet ? { srcSet } : {}),
    place: layoutValue(doc.layout, 'imagePlace'),
    ...(image.alt && !image.decorative ? { alt: image.alt } : {}),
    ...(image.homeOnly ? { homeOnly: true } : {}),
    ...(photoShade(doc) ? { shaded: true } : {}),
  }
}

function designLogo(doc: PortalDesign): DesignLogo {
  const { display, name, wordmark, mark } = doc.brand.logo
  return {
    display,
    name: name ?? null,
    wordmark: {
      light: wordmark.light ? designAssetUrl(wordmark.light.key) : null,
      dark: wordmark.dark ? designAssetUrl(wordmark.dark.key) : null,
    },
    mark: {
      light: mark.light ? designAssetUrl(mark.light.key) : null,
      dark: mark.dark ? designAssetUrl(mark.dark.key) : null,
    },
  }
}

function feedbackWelcome(doc: PortalDesign): TiptapContent | null {
  const { show, body } = doc.pages.feedback.welcome
  return show && !isEmptyTiptapDoc(body as TiptapContent) ? (body as TiptapContent) : null
}

/**
 * The stylesheet a preview frame draws a view with: its theme, then its own
 * CSS, as the portal's head carries them. The builder matches the frame's
 * text against it to know a design has been drawn.
 */
export function previewStylesheet(
  view: Pick<Extract<PortalDesignView, { engine: 'v2' }>, 'themeStyles' | 'customCss'>
): string {
  return [view.themeStyles, view.customCss].filter(Boolean).join('\n')
}
