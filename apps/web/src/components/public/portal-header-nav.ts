/**
 * Pure helpers for the portal header's top-level nav.
 * Kept in its own module so tests can import without dragging in React.
 *
 * The nav is admin-configurable via `portalConfig.nav` (ordered items,
 * per-item visibility, label overrides, custom links). Absent config
 * resolves to the default tab order, preserving pre-setting behavior.
 */
import type {
  PortalNavConfig,
  PortalNavItemConfig,
  PortalNavItemType,
} from '@/lib/shared/types/settings'
import type { PortalDesign } from '@/lib/shared/design/schema'
import { PORTAL_LANDING } from '@/lib/shared/design/paths'

/** Built-in pages a menu can list (everything except admin-defined links). */
type PortalPageNavType = Exclude<PortalNavItemType, 'link'>

/** Built-in tab types: the pages, and Home on the design engine. */
export type PortalBuiltInNavType = PortalPageNavType | 'home'

interface BuiltInNavDefinition {
  to: string
  messageId: string
  defaultMessage: string
}

const BUILT_IN_NAV_ITEMS: Record<PortalBuiltInNavType, BuiltInNavDefinition> = {
  home: { to: PORTAL_LANDING, messageId: 'portal.header.nav.home', defaultMessage: 'Home' },
  feedback: {
    to: PORTAL_LANDING,
    messageId: 'portal.header.nav.feedback',
    defaultMessage: 'Feedback',
  },
  roadmap: { to: '/roadmap', messageId: 'portal.header.nav.roadmap', defaultMessage: 'Roadmap' },
  changelog: {
    to: '/changelog',
    messageId: 'portal.header.nav.changelog',
    defaultMessage: 'Changelog',
  },
  help: { to: '/hc', messageId: 'portal.header.nav.help', defaultMessage: 'Help Center' },
  support: { to: '/support', messageId: 'portal.header.nav.support', defaultMessage: 'Support' },
  status: { to: '/status', messageId: 'portal.header.nav.status', defaultMessage: 'Status' },
}

/** Default order, matching the nav before it became configurable. */
export const DEFAULT_NAV_ORDER: readonly PortalPageNavType[] = [
  'feedback',
  'roadmap',
  'changelog',
  'help',
  'support',
  'status',
]

/**
 * Per-type availability. Each gate already folds in product flags,
 * publication toggles, and the viewer's audience where applicable — a tab
 * can only render for a viewer who can see the page behind it. Nav config
 * can hide a gated-on tab but never force-show a gated-off one.
 */
export interface PortalNavGates {
  feedback: boolean
  roadmap: boolean
  changelog: boolean
  help: boolean
  support: boolean
  status: boolean
}

/** A nav item resolved for rendering. */
export type PortalNavItem =
  | {
      kind: 'builtin'
      id: string
      type: PortalBuiltInNavType
      to: string
      messageId: string
      defaultMessage: string
      /** Admin label override — when set it wins over the i18n message. */
      label?: string
    }
  | {
      kind: 'link'
      id: string
      type: 'link'
      href: string
      label: string
      newTab: boolean
    }

function builtInItem(
  type: PortalBuiltInNavType,
  id?: string,
  label?: string,
  to?: string
): PortalNavItem {
  const def = BUILT_IN_NAV_ITEMS[type]
  return { kind: 'builtin', id: id ?? type, type, ...def, ...(to ? { to } : {}), label }
}

/** How the design engine's menu differs from the saved navigation. */
export interface PortalNavOptions {
  /** The feed's address; `/` unless Home or another page leads. */
  feedbackTo?: string
  /** The design's menu can hide Feedback; the saved navigation cannot. */
  feedbackHideable?: boolean
  /** A Home tab first, with its label override. */
  homeTab?: { label?: string } | null
}

/** The design's menu in the shape the saved navigation uses. */
export function designNavConfig(nav: PortalDesign['nav']): PortalNavConfig {
  return {
    items: nav.items.map((item) =>
      item.type === 'link'
        ? { id: item.id, type: 'link', label: item.label, url: item.url, newTab: item.newTab }
        : { id: item.type, type: item.type, enabled: item.shown, label: item.label }
    ),
  }
}

function isSafeLinkUrl(url: string | undefined): url is string {
  return !!url && /^https?:\/\//i.test(url)
}

/**
 * Resolves the nav items shown in the portal header.
 *
 * - Absent/empty config: default order filtered by gates (legacy behavior,
 *   byte-for-byte).
 * - With config: configured order; built-ins render iff their gate passes
 *   AND they are not disabled; links render unless disabled (http(s) only).
 * - Built-in types missing from the config are appended in default order
 *   when their gate passes, so a product enabled after the admin saved nav
 *   config still gets its tab.
 */
export function resolvePortalNavItems(
  gates: PortalNavGates,
  nav?: PortalNavConfig | null,
  options: PortalNavOptions = {}
): PortalNavItem[] {
  const page = (type: PortalPageNavType, id?: string, label?: string) =>
    builtInItem(type, id, label, type === 'feedback' ? options.feedbackTo : undefined)
  const items: PortalNavItem[] = options.homeTab
    ? [builtInItem('home', 'home', options.homeTab.label)]
    : []
  const configured = nav?.items
  if (!configured || configured.length === 0) {
    return [...items, ...DEFAULT_NAV_ORDER.filter((type) => gates[type]).map((type) => page(type))]
  }

  const seenTypes = new Set<PortalPageNavType>()

  for (const item of configured) {
    if (item.type === 'link') {
      if (item.enabled === false || !isSafeLinkUrl(item.url)) continue
      items.push({
        kind: 'link',
        id: item.id,
        type: 'link',
        href: item.url,
        label: item.label?.trim() || item.url,
        newTab: item.newTab !== false,
      })
      continue
    }

    seenTypes.add(item.type)
    // In the saved navigation Feedback is always on: a stored enabled:false is
    // ignored. The design's menu can hide it. Every built-in still needs its gate.
    const hidden =
      item.enabled === false && (item.type !== 'feedback' || options.feedbackHideable === true)
    if (hidden || !gates[item.type]) continue
    items.push(page(item.type, item.id, item.label?.trim() || undefined))
  }

  for (const type of DEFAULT_NAV_ORDER) {
    if (!seenTypes.has(type) && gates[type]) items.push(page(type))
  }

  return items
}

/**
 * Seeds the admin nav editor's rows: the saved config order first, then any
 * built-in types the config doesn't mention (appended in default order, shown
 * as enabled). The editor shows every built-in — including currently
 * gated-off products, rendered disabled — so admins can pre-order tabs.
 */
export function seedNavEditorItems(nav?: PortalNavConfig | null): PortalNavItemConfig[] {
  const items: PortalNavItemConfig[] = nav?.items?.length
    ? nav.items.map((item) => ({ ...item }))
    : []
  const seenTypes = new Set<string>(items.filter((i) => i.type !== 'link').map((i) => i.type))
  for (const type of DEFAULT_NAV_ORDER) {
    if (!seenTypes.has(type)) items.push({ id: type, type })
  }
  return items
}

/** Default label/message metadata for the editor's built-in rows. */
export function builtInNavDefinition(type: PortalBuiltInNavType): BuiltInNavDefinition {
  return BUILT_IN_NAV_ITEMS[type]
}

export const isHelpPath = (pathname: string) => pathname === '/hc' || pathname.startsWith('/hc/')

/**
 * Whether a built-in tab is the current page. A post (/b/<board>/posts/<id>)
 * belongs to Feedback, so its tab stays lit while one is open; Home is lit
 * only at the root.
 */
export function isTabActive(
  item: { type: PortalBuiltInNavType; to: string },
  pathname: string
): boolean {
  if (item.type === 'home') return pathname === '/'
  if (item.type === 'feedback') return pathname === item.to || /^\/b\/[^/]+\/posts\//.test(pathname)
  if (item.type === 'help') return isHelpPath(pathname)
  return pathname.startsWith(item.to)
}
