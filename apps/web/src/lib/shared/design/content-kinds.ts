/**
 * The three kinds of content on a portal, and how the builder treats each.
 * The design owns static words, typed where they sit; the workspace's data
 * owns dynamic content, which is styled and configured but never retyped;
 * the product owns its interface, which is styled only and stays
 * translated. Every pickable thing has one of them, said here and in the
 * parts registry, never guessed by the canvas.
 *
 * Live values (a status line, vote counts) are data too: each says where it
 * comes from and where in the settings it is changed.
 */
import type { CanvasLocation } from './outline'
import type { StyleElement } from './style-tokens'

export type ContentKind = 'static' | 'dynamic' | 'system'
export const CONTENT_KINDS: readonly ContentKind[] = ['static', 'dynamic', 'system']

/** What an element kind is when no part says otherwise. */
export const ELEMENT_KINDS: Record<StyleElement, ContentKind> = {
  button: 'system',
  secondary: 'system',
  ghost: 'system',
  link: 'static',
  navItem: 'static',
  card: 'system',
  block: 'system',
  input: 'system',
  badge: 'dynamic',
  chip: 'dynamic',
  vote: 'system',
  headline: 'static',
  subtitle: 'static',
  heading: 'static',
  body: 'static',
  hero: 'static',
  header: 'static',
  footer: 'static',
  divider: 'system',
  image: 'static',
}

/**
 * The portal's marks for what its data draws, whatever element kind it is
 * styled as: a listed item, a post's own words, its status and its tags.
 */
export const DATA_MARKS =
  ':is([data-qb-item], [data-qb-part=post-excerpt], [data-qb-part=post-body], [data-qb-part=status-badge], [data-qb-part=tag])'

/** A listed item a data block draws, by its `data-qb-item` mark. */
export const ITEM_NAMES = {
  'post-title': 'Post title',
  'entry-title': 'Update title',
  'article-title': 'Article',
  'incident-title': 'Incident',
} as const
export type ItemMark = keyof typeof ITEM_NAMES

/** The items each data block lists. */
export const ITEMS_OF: Partial<Record<string, readonly ItemMark[]>> = {
  ideas: ['post-title'],
  roadmap: ['post-title'],
  updates: ['entry-title'],
  help_search: ['article-title'],
  status: ['incident-title'],
}

/** Where a live value comes from, and the settings page it is changed on. */
export interface LiveSource {
  /** Said after "From your": "status page". */
  source: string
  /** The admin settings page it is changed on. */
  settings: string
}

/** Live values, by their `data-qb-live` mark. */
export const LIVE_SOURCES = {
  status: { source: 'status page', settings: '/admin/settings/status' },
  votes: { source: 'feedback votes', settings: '/admin/settings/feedback' },
} as const satisfies Record<string, LiveSource>
export type LiveMark = keyof typeof LIVE_SOURCES

/** Values the product draws live without a mark of their own, by the part they are. */
const LIVE_PARTS: Array<[selector: string, mark: LiveMark]> = [
  ['[data-qb-part=vote-button]', 'votes'],
]

/** The live value a node is, if any. */
export function liveOf(node: Element): LiveMark | null {
  const mark = node.getAttribute('data-qb-live')
  if (mark && mark in LIVE_SOURCES) return mark as LiveMark
  for (const [selector, live] of LIVE_PARTS) if (node.matches(selector)) return live
  return null
}

/** Every live value a section draws, the first of each source only, in reading order. */
export function livesIn(scope: ParentNode): Array<{ node: Element; mark: LiveMark }> {
  const seen = new Set<LiveMark>()
  const out: Array<{ node: Element; mark: LiveMark }> = []
  const selector = ['[data-qb-live]', ...LIVE_PARTS.map(([s]) => s)].join(', ')
  for (const node of scope.querySelectorAll(selector)) {
    if (node.closest('[hidden], [aria-hidden=true]')) continue
    const mark = liveOf(node)
    if (!mark || seen.has(mark)) continue
    seen.add(mark)
    out.push({ node, mark })
  }
  return out
}

/** What a place on the portal is called after "Open": "post", "status page". */
export function destinationName(at: CanvasLocation): string {
  switch (at.page) {
    case 'post':
      return 'post'
    case 'status':
      return at.item ? 'incident' : 'status page'
    case 'changelog':
      return at.item ? 'update' : 'changelog'
    case 'help':
      return at.item ? 'article' : 'Help Center'
    case 'roadmap':
      return 'roadmap'
    case 'support':
      return 'support'
    case 'feedback':
      return 'feedback'
    case 'home':
      return 'Home'
  }
}

/**
 * How each kind is drawn on the canvas: its outline, its chip and the words
 * the chip says. The outline colours sit between light and dark in
 * lightness, so each reads at 3:1 or more on a white portal and a black one,
 * and they differ in lightness as well as hue; the chip colours take white
 * words at 4.5:1 or more.
 */
export const KIND_LOOK: Record<
  ContentKind,
  { outline: string; dash: 'dashed' | 'solid' | 'dotted'; chip: string; name: string }
> = {
  static: { outline: '#3b7cf0', dash: 'dashed', chip: '#1d4ed8', name: 'Static' },
  dynamic: { outline: '#0e9f8f', dash: 'solid', chip: '#0f766e', name: 'Dynamic' },
  system: { outline: '#5b6b82', dash: 'dotted', chip: '#475569', name: 'System' },
}
