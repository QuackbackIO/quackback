/**
 * A website's own logo and share image, read from its page: the logo in its
 * header as a site draws it, and the image it gives link previews. Pure, so
 * the rules run on any page; site-assets.ts fetches and stores what they find.
 *
 * The header logo is the first element a page marks as its logo (by class,
 * id or test hook, or a label naming home), or its first link home, taken as
 * the inline SVG or the image inside it. A dark-on-light image is preferred
 * to its light twin, and the sharpest source in a srcset to the plain one.
 */
import { normaliseColor } from '@/lib/shared/design/color'
import { parseOklch } from '@/lib/shared/theme/expand'
import { hexToOklch } from '@/lib/shared/theme/colors'

export type LogoCandidate = { svg: string } | { url: string }

const MAX_SVG = 200_000
/** Marked as a logo by class, id or a test hook; logo walls of customers are not the site's own. */
const LOGO_MARK = /\b(?:class|id|data-qa|data-testid)\s*=\s*["'][^"']*logo[^"']*["']/i
const NOT_OWN = /logo[-_]?wall|customers?\/|partners?\/|clients?\//i
const HOME_LABEL = /\baria-label\s*=\s*["'][^"']*\bhome\b[^"']*["']/i

const attr = (tag: string, name: string) =>
  new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(tag)?.slice(1).find(Boolean)

function absolute(href: string, base: string): string | null {
  try {
    const url = new URL(href.trim(), base)
    return /^https?:$/.test(url.protocol) ? url.href : null
  } catch {
    return null
  }
}

/** A link to the site's home: its root, a locale's root, or its own address. */
function linksHome(tag: string, base: string): boolean {
  const href = attr(tag, 'href')
  if (!href) return false
  const url = absolute(href, base)
  if (!url) return false
  const { host, pathname } = new URL(url)
  return host === new URL(base).host && /^\/(?:[a-z]{2}(?:-[a-z]{2,4})?\/?)?$/i.test(pathname)
}

/** An image tag's best source: the largest density in its srcset, else its src. */
function imageSource(tag: string, base: string): string | null {
  const srcset = attr(tag, 'srcset')
  if (srcset) {
    const best = srcset
      .split(',')
      .map((entry) => entry.trim().split(/\s+/))
      .map(([url, size]) => ({ url: url!, scale: parseFloat(size ?? '1') || 1 }))
      .sort((a, b) => b.scale - a.scale)[0]
    if (best?.url) return absolute(best.url, base)
  }
  const src = attr(tag, 'src')
  return src && !src.startsWith('data:') ? absolute(src, base) : null
}

/** The logo inside an element's markup: its inline SVG, else its dark-on-light image. */
function logoWithin(markup: string, base: string): LogoCandidate | null {
  const svg = /<svg\b[\s\S]*?<\/svg>/i.exec(markup)?.[0]
  if (svg && svg.length <= MAX_SVG) return { svg }
  const images = [...markup.matchAll(/<img\b[^>]*>/gi)].map((match) => match[0])
  const preferred = images.find((tag) => /black|dark/i.test(attr(tag, 'src') ?? '')) ?? images[0]
  const url = preferred ? imageSource(preferred, base) : null
  return url ? { url } : null
}

/** The page's header logo, or null when it marks none. */
export function findHeaderLogo(html: string, base: string): LogoCandidate | null {
  const header = /<header\b[\s\S]*?<\/header>/i.exec(html)?.[0]
  for (const scope of [header, html.slice(0, 400_000)]) {
    if (!scope) continue
    for (const match of scope.matchAll(/<(a|div|span|img)\b[^>]*>/gi)) {
      const tag = match[0]
      const name = match[1]!.toLowerCase()
      if (NOT_OWN.test(tag)) continue
      const marked = LOGO_MARK.test(tag) || HOME_LABEL.test(tag)
      if (!marked && !(name === 'a' && linksHome(tag, base))) continue
      if (name === 'img') {
        const url = imageSource(tag, base)
        if (url) return { url }
        continue
      }
      const rest = scope.slice(match.index! + tag.length, match.index! + tag.length + 60_000)
      const close = rest.search(new RegExp(`</${name}>`, 'i'))
      const found = logoWithin(close >= 0 ? rest.slice(0, close) : rest.slice(0, 20_000), base)
      if (found) return found
    }
  }
  return null
}

/** The image a page gives link previews, as an absolute address. */
export function findShareImage(html: string, base: string): string | null {
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0]
    const key = attr(tag, 'property') ?? attr(tag, 'name')
    if (!key || !/^(og:image(:secure_url)?|twitter:image)$/i.test(key)) continue
    const content = attr(tag, 'content')
    const url = content ? absolute(content, base) : null
    if (url) return url
  }
  return null
}

/** Custom properties as the page first sets them, outside dark mode. */
function customProperties(css: readonly string[]): Map<string, string> {
  const found = new Map<string, string>()
  for (const sheet of css) {
    const light = sheet.replace(
      /@media[^{]*prefers-color-scheme\s*:\s*dark[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/gi,
      ''
    )
    for (const [, name, value] of light.matchAll(/(--[\w-]+)\s*:\s*([^;}]+)/g))
      if (!found.has(name!)) found.set(name!, value!.trim())
  }
  return found
}

/**
 * An inline SVG with the colours it takes from its page written in: custom
 * properties from the site's CSS, and `currentColor` as the brand colour.
 * Copied out of the page, it would otherwise draw in black.
 */
export function resolveSvgColours(svg: string, css: readonly string[], fallback: string): string {
  const properties = customProperties(css)
  const resolve = (value: string, depth = 0): string =>
    depth > 4
      ? fallback
      : value.replace(
          /var\(\s*(--[\w-]+)\s*(?:,\s*((?:[^()]|\([^()]*\))*))?\)/g,
          (_, name: string, alternative?: string) => {
            const set = properties.get(name)
            if (set) return resolve(set, depth + 1)
            return alternative ? resolve(alternative.trim(), depth + 1) : fallback
          }
        )
  return resolve(svg).replace(/currentColor/gi, fallback)
}

/** What an SVG may not hold to be stored: anything that runs, embeds a page or reaches out. */
const UNSAFE_SVG =
  /<script|<foreignObject|<iframe|<object|<embed|<!ENTITY|<!DOCTYPE|\son[a-z]+\s*=|javascript:|data:text\/html|(?:xlink:)?href\s*=\s*["']\s*(?:https?:|\/\/)/i

/** The SVG ready to store, with its namespace, or null when it holds something unsafe. */
export function safeSvg(svg: string): string | null {
  if (svg.length > MAX_SVG || UNSAFE_SVG.test(svg) || !/^\s*<svg\b/i.test(svg)) return null
  return /\sxmlns\s*=/.test(svg.slice(0, svg.indexOf('>')))
    ? svg
    : svg.replace(/^\s*<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"')
}

/** How wide an SVG draws for its height, from its viewBox or its size. */
export function svgAspect(svg: string): number | null {
  const open = /<svg\b[^>]*>/i.exec(svg)?.[0] ?? ''
  const box = attr(open, 'viewBox')
    ?.trim()
    .split(/[\s,]+/)
    .map(Number)
  if (box?.length === 4 && box[2]! > 0 && box[3]! > 0) return box[2]! / box[3]!
  const width = parseFloat(attr(open, 'width') ?? '')
  const height = parseFloat(attr(open, 'height') ?? '')
  return width > 0 && height > 0 ? width / height : null
}

/** Below this chroma a colour reads as grey, black or white. */
const GREY = 0.03

/** A logo's own colours, the greys, black and white left out. */
export function svgColours(svg: string): string[] {
  const colours = new Set<string>()
  for (const [, value] of svg.matchAll(
    /(?:fill|stroke|stop-color)\s*[=:]\s*["']?\s*(#[\da-f]{3,6}\b|rgb\([^)]*\))/gi
  )) {
    const colour = normaliseColor(value!)
    if (!colour || !colour.startsWith('#')) continue
    const oklch = parseOklch(hexToOklch(colour))
    if (oklch && oklch.c >= GREY) colours.add(colour)
  }
  return [...colours].slice(0, 6)
}

/** An image file's width and height, read from its header: PNG, JPEG, GIF or WebP. */
export function imageSize(bytes: Uint8Array): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const ascii = (at: number, length: number) =>
    String.fromCharCode(...bytes.subarray(at, at + length))
  if (bytes.length >= 24 && ascii(1, 3) === 'PNG')
    return { width: view.getUint32(16), height: view.getUint32(20) }
  if (bytes.length >= 10 && ascii(0, 3) === 'GIF')
    return { width: view.getUint16(6, true), height: view.getUint16(8, true) }
  if (bytes.length >= 30 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    const kind = ascii(12, 4)
    if (kind === 'VP8 ')
      return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff }
    if (kind === 'VP8L') {
      const bits = view.getUint32(21, true)
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
    }
    if (kind === 'VP8X')
      return {
        width: 1 + (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16)),
        height: 1 + (bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16)),
      }
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let at = 2
    while (at + 8 < bytes.length) {
      if (bytes[at] !== 0xff) return null
      const marker = bytes[at + 1]!
      const length = view.getUint16(at + 2)
      // Start-of-frame markers carry the size; 0xc4, 0xc8 and 0xcc are not frames.
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker))
        return { height: view.getUint16(at + 5), width: view.getUint16(at + 7) }
      at += 2 + length
    }
  }
  return null
}
