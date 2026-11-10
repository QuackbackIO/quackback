/**
 * Where the portal asks for its own share card and favicon. The card is
 * drawn on the server (domains/design/share-card) from its facts
 * (share-card-facts.ts); its address carries a version of everything it
 * shows, so a link preview or browser can keep it for good and a changed
 * brand is a new address. Every portal page's head reads these addresses.
 */

/** The pages that have their own card: the page's name under the title. The portal's own has none. */
export const SHARE_CARD_PAGES = ['feedback', 'roadmap', 'changelog', 'help', 'status'] as const
export type ShareCardPage = (typeof SHARE_CARD_PAGES)[number]

export const isShareCardPage = (value: unknown): value is ShareCardPage =>
  (SHARE_CARD_PAGES as readonly unknown[]).includes(value)

/**
 * What the card's bundled faces draw: their files are Latin only, so this
 * is the part of that range every face has (the fallback's cmap pins it),
 * and spaces. A title or page name with anything else would be left blank
 * on the card. One character class rather than a table of ranges, as every
 * portal page's head reads it from the entry chunk.
 */
const CARD_TEXT =
  /^[\s\x20-\x7e\xa0-\xac\xae-\xff\u0131\u0152\u0153\u2013\u2014\u2018-\u201a\u201c-\u201e\u2022\u2026\u20ac\u2122]*$/

/** Whether the card's faces can draw every visible character of the text. */
export const cardCanDraw = (text: string): boolean => CARD_TEXT.test(text)

/** Where the portal serves its drawn brand images. */
export const BRAND_IMAGE_PATH = '/brand.png'

/** A short, stable hash (FNV-1a, base 36) of the text. */
export function shortHash(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

/**
 * The version an address names: what the card shows, its title, and the
 * page name under it, which follows the main language and the page's words.
 */
export const shareCardAddressVersion = (
  version: string,
  title: string,
  pageName?: string | null
): string => `${version}${shortHash(title)}${pageName ? shortHash(pageName) : ''}`

/** The card's address: its version and title, and the page whose name it shows. */
export function shareCardPath(
  version: string,
  title: string,
  page?: ShareCardPage,
  pageName?: string | null
): string {
  const v = shareCardAddressVersion(version, title, page ? pageName : null)
  return `${BRAND_IMAGE_PATH}?v=${v}${page ? `&page=${page}` : ''}`
}

/** The favicon's address: the brand icon fitted into a square. */
export const squareIconPath = (version: string): string =>
  `${BRAND_IMAGE_PATH}?v=${version}&kind=icon`

/**
 * The initial tile's address, for a brand with no icon a browser tab or
 * mail client can show: drawn from the card's colours and the title's
 * initial, so it carries the card's version and the title.
 */
export const initialTilePath = (cardVersion: string, title: string): string =>
  `${BRAND_IMAGE_PATH}?v=${cardVersion}${shortHash(title)}&kind=icon`

/** The full logo as a PNG mail can show, fitted into the square email headers keep. */
export const logoImagePath = (key: string): string =>
  `${BRAND_IMAGE_PATH}?v=${shortHash(key)}&kind=logo`
