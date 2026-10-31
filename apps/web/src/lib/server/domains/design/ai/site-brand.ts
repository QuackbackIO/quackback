/**
 * A website's brand, read from what it serves: its page head, its CSS and its
 * web app manifest. Nothing here fetches; site-signals.ts does, and this
 * reads what it got.
 *
 * Colours are weighed by where they appear. A colour the site names as its
 * theme, in its manifest or in a custom property called primary, brand or
 * accent counts most; one on buttons and links next; any other a little. The
 * brand colour is the heaviest colourful one, and the page background is what
 * the body or html is painted.
 */
import { normaliseColor } from '@/lib/shared/design/color'
import { isBrandColour } from '@/lib/shared/design/palette'
import { oklchToHex } from '@/lib/shared/theme/colors'

export interface SiteBrand {
  title: string | null
  description: string | null
  /** The brand colour: the heaviest colourful colour the site uses. */
  colour: string | null
  /** Up to five vivid colours, heaviest first, none close to another. */
  palette: string[]
  /** The page background, when the site paints one. */
  background: string | null
  /** The families its text is set in, headings first when they differ. */
  fonts: { heading: string | null; body: string | null }
  /** The page is dark. */
  dark: boolean
  /** The colour its buttons are filled with, neutrals included: black buttons mark a monochrome brand. */
  button: string | null
  /** It fills large areas, such as a hero, with its brand colour. */
  bold: boolean
  /** Its buttons are black or near-black: a monochrome brand that uses colour sparingly. */
  monochrome: boolean
}

/** Pages that answer a visit with a block rather than the site. */
const BLOCK_PAGE =
  /just a moment|attention required|access denied|are you a robot|unsupported client|client challenge|captcha|bot verification|request blocked|security check|please enable (javascript|js)|pardon our interruption|verify you are human/i

/** Whether a page is a bot check or a refusal rather than the site itself. */
export function isBlockPage(html: string): boolean {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? ''
  return (
    BLOCK_PAGE.test(title) ||
    (html.length < 20_000 &&
      /cf-chl|challenge-platform|_Incapsula_|px-captcha|datadome/i.test(html))
  )
}

const ENTITIES: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' }

const decode = (text: string) =>
  // One pass, so an entity a decoded one spells out is never decoded again.
  text
    .replace(/&(?:(amp|quot|apos|lt|gt)|#39|#x([\da-f]+)|#(\d+));/gi, (match, name, hex, dec) =>
      name
        ? ENTITIES[name.toLowerCase()]!
        : hex
          ? String.fromCodePoint(parseInt(hex, 16))
          : dec
            ? String.fromCodePoint(Number(dec))
            : "'"
    )
    .replace(/\s+/g, ' ')
    .trim()

/** Each `<meta>` and `<link>` tag's attributes. */
function tags(html: string, name: 'meta' | 'link'): Array<Record<string, string>> {
  return [...html.matchAll(new RegExp(`<${name}\\b([^>]*)>`, 'gi'))].map((match) => {
    const attrs: Record<string, string> = {}
    for (const [, key, , , double, single, bare] of match[1]!.matchAll(
      /([\w:-]+)\s*=\s*(("([^"]*)")|'([^']*)'|([^\s"'>]+))/g
    ))
      attrs[key!.toLowerCase()] = decode(double ?? single ?? bare ?? '')
    return attrs
  })
}

/** What the page's head and markup point to: its stylesheets, manifest and inline CSS. */
export function pageLinks(html: string, base: string) {
  const resolve = (href: string) => {
    try {
      return new URL(href, base).href
    } catch {
      return null
    }
  }
  const links = tags(html, 'link')
  const stylesheets = links
    .filter(
      (link) =>
        /\bstylesheet\b/i.test(link.rel ?? '') ||
        (/\bpreload\b/i.test(link.rel ?? '') && link.as === 'style')
    )
    .map((link) => link.href && resolve(link.href))
    .filter((href): href is string => !!href && /^https?:/.test(href))
  const manifest = links.find((link) => /\bmanifest\b/i.test(link.rel ?? ''))?.href
  const inlineCss = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)]
    .map((match) => match[1]!)
    .join('\n')
  return {
    stylesheets: [...new Set(stylesheets)],
    manifest: manifest ? resolve(manifest) : null,
    inlineCss,
  }
}

/** A CSS colour as hex, or null for one that is transparent or not a colour. */
function hex(value: string): string | null {
  const colour = normaliseColor(value.trim().replace(/\s*!important$/, ''))
  if (!colour) return null
  return colour.startsWith('#') ? colour : oklchToHex(colour)
}

const COLOUR = /#[\da-f]{3}\b|#[\da-f]{6}\b|rgba?\([^)]*\)|hsla?\([^)]*\)|oklch\([^)]*\)/gi
const GENERIC_FONTS =
  /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-\w+|-apple-system|blinkmacsystemfont|segoe ui|helvetica( neue)?|arial|roboto|noto \w+|apple color emoji|segoe ui (emoji|symbol)|inherit|initial|unset|var\(.*|font awesome.*|fontawesome|material (icons|symbols).*|icons?|emoji)$/i

/** Weighs each colour by where the CSS uses it, and finds the page background and fonts. */
/** The CSS with its dark-mode blocks taken out: the brand is read from the page as it first loads. */
function withoutDarkMode(css: string): string {
  let out = ''
  let at = 0
  const dark = /@media[^{]*prefers-color-scheme\s*:\s*dark[^{]*\{/gi
  for (let match = dark.exec(css); match; match = dark.exec(css)) {
    out += css.slice(at, match.index)
    let depth = 1
    let i = match.index + match[0].length
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth++
      else if (css[i] === '}') depth--
      i++
    }
    at = i
    dark.lastIndex = i
  }
  return out + css.slice(at)
}

/** A rule for a dark theme, such as `.dark body` or `[data-theme=dark]`. */
const DARK_THEME = /(^|[\s.[#:-])(dark|night)([\s\]"'=_-]|$)/

function readCss(css: string, weigh: (colour: string, weight: number) => void) {
  css = withoutDarkMode(css)
  let background: string | null = null
  const buttons = new Map<string, number>()
  const fields = new Set<string>()
  const fonts = {
    heading: new Map<string, number>(),
    body: new Map<string, number>(),
    any: new Map<string, number>(),
  }
  const count = (map: Map<string, number>, font: string) => map.set(font, (map.get(font) ?? 0) + 1)
  for (const [, selector, body] of css.matchAll(/([^{}@;]+)\{([^{}]*)\}/g)) {
    const sel = selector!.trim().toLowerCase()
    if (DARK_THEME.test(sel)) continue
    // Focus rings and messages about state are not the brand.
    if (/:focus|:invalid|\b(error|danger|warning|success|alert|toast|valid)\b/.test(sel)) continue
    const onButton = /\b(btn|button|cta|primary)\b/.test(sel)
    const onLink = /(^|[\s,>])a(:|[\s,{.[]|$)/.test(sel)
    const onPage = /(^|,)\s*(html|body|:root)\s*($|,)/.test(sel)
    for (const [, property, value] of body!.matchAll(/(--[\w-]+|[a-z-]+)\s*:\s*([^;]+)/gi)) {
      const prop = property!.toLowerCase()
      if (prop === 'font-family' || prop === 'font') {
        const family = /(?:^|,)\s*["']?([^,"']+?)["']?\s*(?:,|$)/.exec(
          prop === 'font'
            ? value!.replace(/^.*?[\d.]+(px|rem|em|%|pt|vw|vh)(\/\S+)?\s+/, '')
            : value!
        )?.[1]
        if (family && !GENERIC_FONTS.test(family.trim())) {
          const name = family.trim()
          count(
            /(^|[\s,])h[1-3]\b|heading|title|display/.test(sel)
              ? fonts.heading
              : onPage
                ? fonts.body
                : fonts.any,
            name
          )
        }
        continue
      }
      for (const raw of value!.match(COLOUR) ?? []) {
        const colour = hex(raw)
        if (!colour) continue
        if (onPage && /^background(-color)?$/.test(prop)) background ??= colour
        if (/^background/.test(prop)) {
          if (onButton) buttons.set(colour, (buttons.get(colour) ?? 0) + 1)
          if (/\b(hero|banner|jumbotron|masthead|splash|promo|band|section)\b/.test(sel))
            fields.add(colour)
        }
        if (/outline|shadow|caret|selection/.test(prop)) continue
        if (
          prop.startsWith('--') &&
          /(error|danger|warning|success|info|focus|ring|shadow)/.test(prop)
        )
          continue
        const brandVar = prop.startsWith('--') && /(primary|brand|accent|theme|main|cta)/.test(prop)
        weigh(
          colour,
          brandVar
            ? 5
            : onButton && /^background/.test(prop)
              ? 4
              : onButton || (onLink && prop === 'color')
                ? 2
                : 1
        )
      }
    }
  }
  const top = (map: Map<string, number>) => [...map].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  return {
    background,
    heading: top(fonts.heading),
    body: top(fonts.body) ?? top(fonts.any),
    button: top(buttons),
    fields: [...fields],
  }
}

const distance = (a: string, b: string) => {
  const [r1, g1, b1] = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16))
  const [r2, g2, b2] = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16))
  return Math.hypot(r1! - r2!, g1! - g2!, b1! - b2!)
}

const luminance = (colour: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(colour.slice(i, i + 2), 16) / 255)
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

/** The brand a page shows, from its HTML, the CSS it uses and its manifest. */
export function readSiteBrand(input: {
  html: string
  css: string[]
  manifest: { theme_color?: unknown; background_color?: unknown; name?: unknown } | null
}): SiteBrand {
  const metas = tags(input.html, 'meta')
  const meta = (...names: string[]) =>
    metas.find((tag) => names.includes((tag.name ?? tag.property ?? '').toLowerCase()))?.content ??
    null
  const weights = new Map<string, number>()
  const weigh = (colour: string, weight: number) =>
    weights.set(colour, (weights.get(colour) ?? 0) + weight)
  const named = (value: unknown, weight: number) => {
    const colour = typeof value === 'string' ? hex(value) : null
    if (colour) weigh(colour, weight)
  }

  for (const tag of metas.filter((tag) => (tag.name ?? '').toLowerCase() === 'theme-color'))
    named(tag.content, 12)
  named(meta('msapplication-tilecolor'), 6)
  named(tags(input.html, 'link').find((link) => /mask-icon/i.test(link.rel ?? ''))?.color, 8)
  named(input.manifest?.theme_color, 10)

  const css = readCss(input.css.join('\n'), weigh)
  const background =
    css.background ??
    (typeof input.manifest?.background_color === 'string'
      ? hex(input.manifest.background_color)
      : null)

  const vivid = [...weights]
    .filter(([colour]) => isBrandColour(colour))
    .sort((a, b) => b[1] - a[1])
    .map(([colour]) => colour)
  // A colourful button fill is the brand's own call to action, so it leads.
  if (css.button && isBrandColour(css.button)) vivid.unshift(css.button)
  const palette: string[] = []
  for (const colour of vivid) {
    if (palette.length === 5) break
    if (palette.every((kept) => distance(kept, colour) > 48)) palette.push(colour)
  }

  const title =
    /<title[^>]*>([\s\S]*?)<\/title>/i.exec(input.html)?.[1] ??
    meta('og:title', 'og:site_name', 'application-name') ??
    (typeof input.manifest?.name === 'string' ? input.manifest.name : null)
  const description = meta('description', 'og:description', 'twitter:description')
  const dark =
    (background ? luminance(background) < 0.25 : false) ||
    /<html[^>]*class="[^"]*\bdark\b/i.test(input.html)
  return {
    title: title ? decode(title).slice(0, 120) : null,
    description: description ? decode(description).slice(0, 300) : null,
    colour: palette[0] ?? null,
    palette,
    background,
    fonts: { heading: css.heading, body: css.body },
    dark,
    button: css.button,
    bold: !!palette[0] && css.fields.some((field) => distance(field, palette[0]!) < 48),
    monochrome: !!css.button && !isBrandColour(css.button) && luminance(css.button) < 0.2,
  }
}
