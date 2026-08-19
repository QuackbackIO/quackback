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

/** Built-in tab types (everything except admin-defined links). */
export type PortalBuiltInNavType = Exclude<PortalNavItemType, 'link'>

interface BuiltInNavDefinition {
  to: string
  messageId: string
  defaultMessage: string
}

const BUILT_IN_NAV_ITEMS: Record<PortalBuiltInNavType, BuiltInNavDefinition> = {
  feedback: { to: '/', messageId: 'portal.header.nav.feedback', defaultMessage: 'Feedback' },
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
export const DEFAULT_NAV_ORDER: readonly PortalBuiltInNavType[] = [
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

function builtInItem(type: PortalBuiltInNavType, id?: string, label?: string): PortalNavItem {
  const def = BUILT_IN_NAV_ITEMS[type]
  return { kind: 'builtin', id: id ?? type, type, ...def, label }
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
  nav?: PortalNavConfig | null
): PortalNavItem[] {
  const configured = nav?.items
  if (!configured || configured.length === 0) {
    return DEFAULT_NAV_ORDER.filter((type) => gates[type]).map((type) => builtInItem(type))
  }

  const items: PortalNavItem[] = []
  const seenTypes = new Set<PortalBuiltInNavType>()

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
    if (item.enabled === false || !gates[item.type]) continue
    items.push(builtInItem(item.type, item.id, item.label?.trim() || undefined))
  }

  for (const type of DEFAULT_NAV_ORDER) {
    if (!seenTypes.has(type) && gates[type]) items.push(builtInItem(type))
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
  const seenTypes = new Set(items.filter((i) => i.type !== 'link').map((i) => i.type))
  for (const type of DEFAULT_NAV_ORDER) {
    if (!seenTypes.has(type)) items.push({ id: type, type })
  }
  return items
}

/** Default label/message metadata for the editor's built-in rows. */
export function builtInNavDefinition(type: PortalBuiltInNavType): BuiltInNavDefinition {
  return BUILT_IN_NAV_ITEMS[type]
}
