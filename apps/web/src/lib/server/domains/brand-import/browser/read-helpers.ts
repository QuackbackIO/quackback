/**
 * Small pieces of a page read (read-page.ts) that need no browser of their
 * own to be tested: the status the page answered with, the logo as a picture
 * the page can draw again, and whether the dark logo is another logo.
 */
import { measureLogoInk, type LogoInk } from './page-logo-ink'
import type { PageLogo, PageMeasure } from './page-measure.types'

/** Where the latest answer of the page's own frame is kept, beside the answers by address. */
export const MAIN_DOCUMENT = ':main-document'

/**
 * The HTTP status the page itself answered with: the document at the address
 * the visit ended on, else at the address asked for (a hash or a script may
 * have changed the address since), else the latest document of the page's
 * own frame. Null when none was seen.
 */
export function documentStatus(
  documents: ReadonlyMap<string, number>,
  pageUrl: string,
  asked: string
): number | null {
  const bare = (address: string) => address.replace(/#.*$/, '')
  for (const address of [pageUrl, asked]) {
    const status = documents.get(address) ?? documents.get(bare(address))
    if (status !== undefined) return status
  }
  return documents.get(MAIN_DOCUMENT) ?? null
}

type SchemeLook = Pick<PageMeasure, 'bg' | 'text'> & { textColor?: string }

/**
 * Whether the page answered a dark system as it stood: its fill or its
 * words changed colour. One that looks the same may still have a dark mode
 * it takes only as it loads, which a page loaded dark then shows.
 */
export function answersScheme(light: SchemeLook, dark: SchemeLook): boolean {
  return (
    dark.bg !== light.bg ||
    dark.text !== light.text ||
    (dark.textColor ?? dark.text) !== (light.textColor ?? light.text)
  )
}

/**
 * Whether the page loaded a second time is the page that was read: the same
 * title, answered with a success. A check or an error shown in its place
 * (often drawn dark for a dark system) is never read as the site's dark mode.
 */
export function samePageAgain(
  first: { title: string; status: number | null },
  again: { title: string; status: number | null }
): boolean {
  const title = first.title.trim()
  if (!title || again.title.trim() !== title) return false
  if (again.status === null || again.status < 200 || again.status >= 300) return false
  return first.status === null || (first.status >= 200 && first.status < 300)
}

/** The most a logo's picture may weigh to be drawn again for its inks. */
const LOGO_INK_MAX_CHARS = 600_000
const LOGO_INK_MS = 2_500

/**
 * The logo as a picture the page can draw without asking the network again:
 * its inline markup, the bytes the browser loaded, or the data address it
 * already was. Null when it has none of them, or it is too large.
 */
export function logoImageSource(
  logo: PageLogo,
  assets: NonNullable<PageMeasure['assets']>
): string | null {
  let src: string | null = null
  if (logo.svg !== undefined) {
    const markup = /<svg\b[^>]*\sxmlns=/i.test(logo.svg)
      ? logo.svg
      : logo.svg.replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"')
    // `currentColor` draws in the colour the page gave the logo.
    const inked = logo.color
      ? markup.replace(/<svg\b/i, `<svg color="${logo.color.replace(/"/g, '')}"`)
      : markup
    src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(inked)}`
  } else if (logo.src?.startsWith('data:image/')) src = logo.src
  else {
    const loaded = assets.find((asset) => asset.url === logo.src)
    if (loaded && /^image\//i.test(loaded.mime)) src = `data:${loaded.mime};base64,${loaded.data}`
  }
  return src && src.length <= LOGO_INK_MAX_CHARS ? src : null
}

/**
 * The logo the page shows a visitor whose system is dark, when it is another
 * one than it shows in light: another picture, or the same drawing in other
 * colours. The same logo twice is no dark-mode logo.
 */
export function schemeDarkLogo(light: PageLogo | null, dark: PageLogo | null): PageLogo | null {
  if (!light || !dark) return null
  // The same logo in the same place is drawn the same size: another size is another picture.
  const near = (a: number, b: number) => Math.abs(a - b) <= 0.2 * Math.max(a, b, 1)
  if (!near(light.w, dark.w) || !near(light.h, dark.h)) return null
  const same =
    dark.svg !== undefined || light.svg !== undefined
      ? dark.svg === light.svg && dark.color === light.color
      : dark.src === light.src
  return same ? null : dark
}

/** The inks `logo` is drawn in, counted in the page, or null when it cannot be drawn there. */
export async function logoInks(
  view: { evaluate(script: string): Promise<unknown> },
  logo: PageLogo,
  assets: NonNullable<PageMeasure['assets']>
): Promise<LogoInk[] | null> {
  const src = logoImageSource(logo, assets)
  if (!src) return null
  const inks = (await Promise.race([
    view
      .evaluate(`(${measureLogoInk.toString()})(${JSON.stringify(src)}, ${logo.w}, ${logo.h})`)
      .catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), LOGO_INK_MS)),
  ])) as LogoInk[] | null
  return Array.isArray(inks) && inks.length > 0 ? inks.slice(0, 8) : null
}

/** A `use` of a symbol kept in another file: the file's address, then the symbol's id. */
const SPRITE_USE = /(<use\b[^>]*?\s(?:xlink:)?href=)(["'])([^"'#\s]+)#([\w.:-]+)\2/gi

/** A sprite file's full address, as the page at `pageUrl` names it, or null. */
function spriteAddress(file: string, pageUrl: string): string | null {
  try {
    const address = new URL(file, pageUrl)
    return /^https?:$/.test(address.protocol) ? address.href : null
  } catch {
    return null
  }
}

/** The files an inline logo's symbols are kept in, when it draws from another file's sprite. */
export function spriteFiles(svg: string, pageUrl: string): string[] {
  const files = [...svg.matchAll(SPRITE_USE)].map((match) => spriteAddress(match[3]!, pageUrl))
  return [...new Set(files.filter((file): file is string => file !== null))]
}

/**
 * An inline logo with the symbols it uses from other files brought into it:
 * each `use` then points at the symbol's own id, as one from the page's own
 * sprite does. `files` holds the sprite files by address. A use whose file or
 * symbol is missing is left as it was.
 */
export function inlineSprites(
  svg: string,
  files: ReadonlyMap<string, string>,
  pageUrl: string
): string {
  const symbols = new Map<string, string>()
  const drawn = svg.replace(
    SPRITE_USE,
    (whole, lead: string, quote: string, file: string, id: string) => {
      const sprite = files.get(spriteAddress(file, pageUrl) ?? '')
      const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const symbol = sprite
        ? new RegExp(
            `<symbol\\b[^>]*\\sid=["']${escaped}["'][^>]*>[\\s\\S]*?<\\/symbol\\s*>`,
            'i'
          ).exec(sprite)?.[0]
        : undefined
      if (!symbol) return whole
      symbols.set(id, symbol)
      return `${lead}${quote}#${id}${quote}`
    }
  )
  if (symbols.size === 0) return svg
  return drawn.replace(/<\/svg>\s*$/i, `<defs>${[...symbols.values()].join('')}</defs></svg>`)
}

/**
 * The declared icons that are drawings: a browser can draw one at any size.
 * A file in `keep` (the logo's own) is left out: it must stay a drawing.
 */
export function svgIconUrls(
  icons: NonNullable<PageMeasure['icons']>,
  keep: readonly (string | null | undefined)[] = []
): string[] {
  return icons
    .filter((icon) => icon.type === 'image/svg+xml' || /\.svg(?:$|[?#])/i.test(icon.url))
    .map((icon) => icon.url)
    .filter((url) => !keep.includes(url))
}

/**
 * Runs in the page: a drawing as a square PNG of `side` pixels, base64, or
 * null when it will not draw or is not square.
 */
export async function drawSquareIcon(source: string, side: number): Promise<string | null> {
  const image = new Image()
  const loaded = await new Promise<boolean>((resolve) => {
    image.onload = () => resolve(true)
    image.onerror = () => resolve(false)
    image.src = source
  })
  if (!loaded) return null
  const [w, h] = [image.naturalWidth || side, image.naturalHeight || side]
  if (Math.abs(w - h) > 0.05 * Math.max(w, h)) return null
  const canvas = document.createElement('canvas')
  canvas.width = side
  canvas.height = side
  const pen = canvas.getContext('2d')
  if (!pen) return null
  try {
    pen.drawImage(image, 0, 0, side, side)
    return canvas.toDataURL('image/png').split(',')[1] ?? null
  } catch {
    return null
  }
}
