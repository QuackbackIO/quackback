/**
 * The admin preview's design channel: reading a draft design from a message
 * and setting its attributes on <html>. Only the preview frame needs it, so
 * the listener loads it when the first design arrives and no visitor
 * downloads it. It imports nothing from the app, so splitting it out moves no
 * shared code into a chunk of its own.
 */

import type { BandImage, DesignLogo, PortalWords } from '@/lib/shared/design/view'

type TextByLocale = Record<string, string>

/** A page headline by locale; the same shape the preview context carries. */
type Headline = {
  title: TextByLocale
  subtitle: TextByLocale
  accent?: { style: 'colour' | 'highlight'; text: TextByLocale }
} | null

/** A draft's Home: its headline and blocks, as the design stores them. */
type Home = { headline: Headline; blocks: Array<Record<string, unknown>> }

/** The pages whose titles a design can word. */
type TitledPage = 'roadmap' | 'changelog' | 'help' | 'support'
const TITLED_PAGES = new Set<string>(['roadmap', 'changelog', 'help', 'support'])

/** A draft's menu, as the design stores it. */
type Nav = {
  home: { on: boolean; tab: boolean; label?: string }
  items: Array<Record<string, unknown>>
}

/** A draft portal design, resolved by the admin with the code the server uses. */
export interface DesignPreview {
  css: string
  attributes: Record<string, string>
  fontIds: string[]
  headline: Headline
  home: Home | null
  /** The other pages' own titles, by page. */
  titles: Partial<Record<TitledPage, NonNullable<Headline>>>
  nav: Nav | null
  /** The words the draft's messages select on. */
  words: PortalWords | null
  /** The draft's own wording, by language. */
  copy: Partial<Record<'prompt' | 'submit' | 'emptyTitle', Record<string, string>>> | null
  logo: DesignLogo | null
  /** The logo's colours status markers take, when the draft asks for them. */
  statusColours: string[] | null
  bandImage: BandImage | null
}

const IMAGE_PLACES = new Set(['side', 'edge', 'cover', 'pattern'])

function readBandImage(value: unknown): BandImage | null {
  if (!value || typeof value !== 'object') return null
  const { url, place } = value as Record<string, unknown>
  return typeof url === 'string' && STORED_FILE.test(url) && IMAGE_PLACES.has(place as string)
    ? { url, place: place as BandImage['place'] }
    : null
}

/** A colour as a design stores it: hex, or oklch(). */
const STORED_COLOUR = /^(#[\da-f]{6}|oklch\([\d.\s%]+\))$/i

function readStatusColours(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  const colours = value.filter((c): c is string => typeof c === 'string' && STORED_COLOUR.test(c))
  return colours.length > 0 ? colours.slice(0, 6) : null
}

const LOGO_DISPLAYS = new Set(['mark_and_name', 'mark', 'wordmark', 'name'])
/** A wordmark comes from the workspace's own storage. */
const STORED_FILE = /^\/api\/storage\/[\w./-]+$/

function readLogo(value: unknown): DesignLogo | null {
  if (!value || typeof value !== 'object') return null
  const { display, name, wordmark, nameAccent } = value as Record<string, unknown>
  if (!LOGO_DISPLAYS.has(display as string)) return null
  const file = (url: unknown) => (typeof url === 'string' && STORED_FILE.test(url) ? url : null)
  const marks = (wordmark ?? {}) as Record<string, unknown>
  return {
    display: display as DesignLogo['display'],
    name: typeof name === 'string' ? name.slice(0, 60) : null,
    nameAccent: typeof nameAccent === 'string' ? nameAccent.slice(0, 30) : null,
    wordmark: { light: file(marks.light), dark: file(marks.dark) },
  }
}

const COPY_FIELDS = ['prompt', 'submit', 'emptyTitle'] as const

function readCopy(value: unknown): DesignPreview['copy'] {
  if (!value || typeof value !== 'object') return null
  const copy: NonNullable<DesignPreview['copy']> = {}
  for (const field of COPY_FIELDS) {
    const byLocale = (value as Record<string, unknown>)[field]
    if (byLocale && typeof byLocale === 'object' && isTextByLocale(byLocale)) copy[field] = byLocale
  }
  return copy
}

/** The design's word choices (its options' postWord and boardWord). */
const POST_WORDS = new Set(['idea', 'post', 'feature_request', 'suggestion'])
const BOARD_WORDS = new Set(['board', 'category'])

function readWords(value: unknown): PortalWords | null {
  if (!value || typeof value !== 'object') return null
  const { post, board } = value as Record<string, unknown>
  if (!POST_WORDS.has(post as string) || !BOARD_WORDS.has(board as string)) return null
  return { postWord: post, boardWord: board } as PortalWords
}

const BLOCK_TYPES = new Set([
  'welcome',
  'composer',
  'ideas',
  'roadmap',
  'updates',
  'help_search',
  'help_topics',
  'status',
  'contact',
  'links',
])

function readHome(value: unknown): Home | null {
  if (!value || typeof value !== 'object') return null
  const { headline, blocks } = value as Record<string, unknown>
  if (!Array.isArray(blocks)) return null
  return {
    headline: readHeadline(headline),
    blocks: blocks.filter(
      (block): block is Record<string, unknown> =>
        !!block &&
        typeof block === 'object' &&
        BLOCK_TYPES.has((block as Record<string, unknown>).type as string) &&
        typeof (block as Record<string, unknown>).width === 'string'
    ),
  }
}

function readTitles(value: unknown): DesignPreview['titles'] {
  if (!value || typeof value !== 'object') return {}
  const titles: DesignPreview['titles'] = {}
  for (const [page, headline] of Object.entries(value)) {
    const read = TITLED_PAGES.has(page) ? readHeadline(headline) : null
    if (read) titles[page as TitledPage] = read
  }
  return titles
}

function readNav(value: unknown): Nav | null {
  if (!value || typeof value !== 'object') return null
  const { home, items } = value as Record<string, unknown>
  if (!home || typeof home !== 'object' || !Array.isArray(items)) return null
  const { on, tab, label } = home as Record<string, unknown>
  if (typeof on !== 'boolean' || typeof tab !== 'boolean') return null
  return {
    home: { on, tab, ...(typeof label === 'string' ? { label } : {}) },
    items: items.filter(
      (item): item is Record<string, unknown> =>
        !!item &&
        typeof item === 'object' &&
        typeof (item as Record<string, unknown>).type === 'string'
    ),
  }
}

const isTextByLocale = (value: unknown): value is Record<string, string> =>
  !!value && typeof value === 'object' && Object.values(value).every((v) => typeof v === 'string')

function readHeadline(value: unknown): Headline {
  if (!value || typeof value !== 'object') return null
  const { title, subtitle, accent } = value as Record<string, unknown>
  if (!isTextByLocale(title) || !isTextByLocale(subtitle)) return null
  const { style, text } = (accent ?? {}) as Record<string, unknown>
  return (style === 'colour' || style === 'highlight') && isTextByLocale(text)
    ? { title, subtitle, accent: { style, text } }
    : { title, subtitle }
}

const DESIGN_ATTRIBUTE = /^data-qb-[a-z]+(?:-[a-z]+)*$/
const DESIGN_VALUE = /^[a-z_]+$/

/** The message's design, keeping only the structural attributes a design sets. */
export function readDesignPreview(value: unknown): DesignPreview | null {
  if (!value || typeof value !== 'object') return null
  const {
    css,
    attributes,
    fontIds,
    headline,
    home,
    titles,
    nav,
    vocabulary,
    copy,
    logo,
    statusColours,
    bandImage,
  } = value as Record<string, unknown>
  if (typeof css !== 'string') return null
  const safe = Object.fromEntries(
    Object.entries((attributes as Record<string, unknown>) ?? {}).filter(
      ([name, v]) => DESIGN_ATTRIBUTE.test(name) && typeof v === 'string' && DESIGN_VALUE.test(v)
    )
  ) as Record<string, string>
  const fonts = Array.isArray(fontIds) ? fontIds.filter((id) => typeof id === 'string') : []
  return {
    css,
    attributes: safe,
    fontIds: fonts,
    headline: readHeadline(headline),
    home: readHome(home),
    titles: readTitles(titles),
    nav: readNav(nav),
    words: readWords(vocabulary),
    copy: readCopy(copy),
    logo: readLogo(logo),
    statusColours: readStatusColours(statusColours),
    bandImage: readBandImage(bandImage),
  }
}

/** Sets the attributes on <html> and returns what puts each one's saved value back. */
export function applyDesignAttributes(attributes: Record<string, string>): () => void {
  const root = document.documentElement
  const saved = Object.keys(attributes).map((name) => [name, root.getAttribute(name)] as const)
  for (const [name, value] of Object.entries(attributes)) root.setAttribute(name, value)
  return () => {
    for (const [name, value] of saved) {
      if (value === null) root.removeAttribute(name)
      else root.setAttribute(name, value)
    }
  }
}

/** Outlines the innermost section under the pointer, so it reads as clickable. */
export const SECTION_OUTLINE_CSS =
  '[data-qb-section]{cursor:pointer}' +
  '[data-qb-section]:hover:not(:has([data-qb-section]:hover)){outline:2px dashed oklch(0.55 0 0 / 0.7);outline-offset:4px}'

/**
 * A click on a section (not on one of its links, buttons or fields) tells
 * Appearance which section to open. Returns what stops listening.
 */
export function startSectionPicking(): () => void {
  function onClick(event: MouseEvent) {
    const target = event.target as Element | null
    if (!target || target.closest('a, button, input, textarea, select, [role="button"]')) return
    const section = target.closest('[data-qb-section]')?.getAttribute('data-qb-section')
    if (!section) return
    event.preventDefault()
    window.parent.postMessage(
      { type: 'quackback:preview-section', section },
      window.location.origin
    )
  }
  document.addEventListener('click', onClick, true)
  return () => document.removeEventListener('click', onClick, true)
}
