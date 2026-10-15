import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'
import { AI_ANY_PERMISSIONS } from '@/lib/shared/ai-permissions'
import { isProductEnabled, type FeatureFlags } from '@/lib/shared/types'
import { AI_PAGES, SETTINGS_PAGES, type AiPagePath, type SettingsPagePath } from './settings-pages'

/** Every page path the nav and the module tabs can name. */
export type NavPagePath = SettingsPagePath | AiPagePath

/*
 * The settings nav as plain data: which pages exist, their labels, and the
 * permission and flag gates that decide who sees them. It imports no icons and
 * no React component, so the admin rail can ask whether to offer Settings
 * without loading the settings menu. The nav component and the module lists add
 * icons from settings-page-icons.ts, keyed by path.
 */

export interface NavItem {
  label: string
  to: string
  /** Highlight only on this path, not nested child pages. */
  exact?: boolean
  /** The permission the page checks when it opens; the nav offers it only to holders. */
  permission?: PermissionKey
  /** Pages that open to a holder of any one of these, instead of a single permission. */
  anyOf?: readonly PermissionKey[]
}

/**
 * A product with several pages. It is one row in the nav that opens its first
 * page, and its pages are tabs under the module title on each of them. `id` is
 * the module's own page path, which keys its icon.
 */
export interface NavModule {
  label: string
  id: NavPagePath
  pages: NavItem[]
}

export type NavEntry = NavItem | NavModule

export interface NavSection {
  label: string
  items: NavEntry[]
}

export interface SettingsModuleRowPage {
  label: string
  to: NavPagePath
  /** The permission the page's route checks; the nav and module landing offer it only to holders. */
  permission?: PermissionKey
  /** Pages that open to a holder of any one of these, instead of a single permission. */
  anyOf?: readonly PermissionKey[]
}

export interface SettingsModuleRow {
  id: string
  label: string
  /** The module's own page path; its icon is keyed by it. */
  to: NavPagePath
  pages: SettingsModuleRowPage[]
}

/** Who can open each module page: its route's permission, or any of several. */
const MODULE_PAGE_ACCESS = {
  '/admin/settings/boards': { permission: PERMISSIONS.BOARD_MANAGE },
  '/admin/settings/statuses': { permission: PERMISSIONS.STATUS_MANAGE },
  '/admin/settings/tags': { permission: PERMISSIONS.TAG_MANAGE },
  '/admin/settings/moderation': { permission: PERMISSIONS.SETTINGS_MODERATION },
  '/admin/settings/channels': { permission: PERMISSIONS.SETTINGS_MANAGE },
  '/admin/settings/channels/email': { permission: PERMISSIONS.CHANNEL_ACCOUNT_MANAGE },
  '/admin/settings/channels/github': { permission: PERMISSIONS.CHANNEL_ACCOUNT_MANAGE },
  '/admin/settings/who-answers': {
    anyOf: [
      PERMISSIONS.AI_CUSTOMER_MANAGE,
      PERMISSIONS.WORKFLOW_MANAGE,
      PERMISSIONS.SETTINGS_MANAGE,
    ],
  },
  '/admin/settings/workflows': { permission: PERMISSIONS.WORKFLOW_MANAGE },
  '/admin/settings/macros': { permission: PERMISSIONS.CONVERSATION_MANAGE },
  '/admin/settings/hours-sla': {
    anyOf: [PERMISSIONS.OFFICE_HOURS_MANAGE, PERMISSIONS.SLA_MANAGE],
  },
  '/admin/settings/tickets': { permission: PERMISSIONS.TICKET_MANAGE_TYPES },
  '/admin/settings/fields': { permission: PERMISSIONS.CONVERSATION_MANAGE },
  '/admin/settings/ai/customers': { permission: PERMISSIONS.AI_CUSTOMER_MANAGE },
  '/admin/settings/ai/teammates': { permission: PERMISSIONS.AI_TEAMMATE_MANAGE },
  '/admin/settings/ai/knowledge': { anyOf: AI_ANY_PERMISSIONS },
  '/admin/settings/ai/guidance': { anyOf: AI_ANY_PERMISSIONS },
  '/admin/settings/ai/actions': { anyOf: AI_ANY_PERMISSIONS },
  '/admin/settings/help-center': { permission: PERMISSIONS.HELP_CENTER_MANAGE },
  '/admin/settings/changelog': { permission: PERMISSIONS.CHANGELOG_MANAGE },
  '/admin/settings/status': { permission: PERMISSIONS.STATUS_PAGE_MANAGE },
  '/admin/settings/agents/assistants': { permission: PERMISSIONS.API_KEY_MANAGE },
  '/admin/settings/agents/keys': { permission: PERMISSIONS.API_KEY_MANAGE },
  '/admin/settings/agents/webhooks': { permission: PERMISSIONS.API_KEY_MANAGE },
} as const satisfies Partial<
  Record<NavPagePath, { permission: PermissionKey } | { anyOf: readonly PermissionKey[] }>
>

type ModulePagePath = keyof typeof MODULE_PAGE_ACCESS

/** The label of a page, from whichever registry holds it. */
function pageLabel(to: NavPagePath): string {
  return to in AI_PAGES
    ? AI_PAGES[to as AiPagePath].defaultMessage
    : SETTINGS_PAGES[to as SettingsPagePath].label
}

/** A module page whose label comes from the page registry. */
function modulePage(to: ModulePagePath): SettingsModuleRowPage {
  return { label: pageLabel(to), to, ...MODULE_PAGE_ACCESS[to] }
}

function moduleHead(to: NavPagePath) {
  return { label: pageLabel(to), to }
}

/**
 * The breadcrumb a page under a module's page shows for the module. It links
 * to the module, which opens the first of its pages the viewer can open.
 */
export function moduleCrumb(
  to: '/admin/settings/feedback' | '/admin/settings/support' | '/admin/settings/ai'
) {
  return moduleHead(to)
}

/** Product modules shown under Settings, Modules. A module with several pages shows them as tabs. */
export function buildSettingsModuleRows(flags?: Partial<FeatureFlags>): SettingsModuleRow[] {
  const modules: SettingsModuleRow[] = [
    {
      id: 'feedback',
      ...moduleHead('/admin/settings/feedback'),
      pages: [
        modulePage('/admin/settings/boards'),
        modulePage('/admin/settings/statuses'),
        modulePage('/admin/settings/tags'),
        modulePage('/admin/settings/moderation'),
      ],
    },
  ]

  const supportPages: SettingsModuleRowPage[] = []
  if (isProductEnabled(flags, 'support')) supportPages.push(modulePage('/admin/settings/channels'))
  if (flags?.supportInbox) {
    supportPages.push(modulePage('/admin/settings/who-answers'))
  }
  if (isProductEnabled(flags, 'support')) {
    supportPages.push(
      modulePage('/admin/settings/workflows'),
      modulePage('/admin/settings/macros'),
      modulePage('/admin/settings/hours-sla')
    )
  }
  if (flags?.supportTickets) {
    supportPages.push(modulePage('/admin/settings/tickets'))
  }
  if (isProductEnabled(flags, 'support')) {
    supportPages.push(modulePage('/admin/settings/fields'))
  }
  if (supportPages.length > 0) {
    modules.push({
      id: 'support',
      ...moduleHead('/admin/settings/support'),
      pages: supportPages,
    })
  }

  modules.push({
    id: 'ai',
    ...moduleHead('/admin/settings/ai'),
    pages: [
      modulePage('/admin/settings/ai/customers'),
      modulePage('/admin/settings/ai/teammates'),
      modulePage('/admin/settings/ai/knowledge'),
      modulePage('/admin/settings/ai/guidance'),
      modulePage('/admin/settings/ai/actions'),
    ],
  })

  if (isProductEnabled(flags, 'helpCenter')) {
    modules.push({
      id: 'helpCenter',
      ...moduleHead('/admin/settings/help-center'),
      pages: [modulePage('/admin/settings/help-center')],
    })
  }

  if (isProductEnabled(flags, 'changelog')) {
    modules.push({
      id: 'changelog',
      ...moduleHead('/admin/settings/changelog'),
      pages: [modulePage('/admin/settings/changelog')],
    })
  }

  if (isProductEnabled(flags, 'status')) {
    modules.push({
      id: 'status',
      ...moduleHead('/admin/settings/status'),
      pages: [modulePage('/admin/settings/status')],
    })
  }

  return modules
}

/** A nav row for a workspace or data page; its label comes from the page registry. */
function navPage(to: SettingsPagePath): NavItem {
  return { label: SETTINGS_PAGES[to].label, to }
}

export function isNavModule(entry: NavEntry): entry is NavModule {
  return 'pages' in entry
}

/**
 * The settings IA: three stable sections (Modules, Workspace, Data). Flags hide ITEMS (or whole product
 * modules), never sections, so the sidebar layout does not reflow when a
 * flag flips. A section a viewer holds no permission for is left out.
 *
 * @param billingEnabled Whether this workspace has a valid billing projection
 *   configured. Not a feature flag: a flag answers "has the admin turned it
 *   on", and this answers "does this deployment sell anything". False on
 *   every self-hosted install, which is why the Billing row is absent there.
 */
export function buildNavSections(
  flags?: Partial<FeatureFlags>,
  billingEnabled = false,
  operatorEnabled = false
): NavSection[] {
  const products: NavEntry[] = buildSettingsModuleRows(flags).map((module): NavEntry => {
    const [only, ...rest] = module.pages
    if (only && rest.length === 0) {
      return { label: only.label, to: only.to, permission: only.permission, anyOf: only.anyOf }
    }
    return {
      label: module.label,
      id: module.to,
      pages: module.pages.map(({ label, to, permission, anyOf }) => ({
        label,
        to,
        permission,
        anyOf,
      })),
    }
  })

  return [
    { label: 'Modules', items: products },
    {
      label: 'Workspace',
      items: [
        {
          ...navPage('/admin/settings/general'),
          permission: PERMISSIONS.SETTINGS_MANAGE,
        },
        ...(operatorEnabled
          ? [
              {
                ...navPage('/admin/settings/domains'),
                permission: PERMISSIONS.SETTINGS_CUSTOM_DOMAIN,
              },
            ]
          : []),
        { ...navPage('/admin/settings/notifications') },
        {
          ...navPage('/admin/settings/portal'),
          permission: PERMISSIONS.SETTINGS_BRANDING,
        },
        {
          ...navPage('/admin/settings/widget'),
          permission: PERMISSIONS.SETTINGS_MANAGE,
        },
        {
          ...navPage('/admin/settings/members'),
          permission: PERMISSIONS.MEMBER_VIEW,
        },
        {
          ...navPage('/admin/settings/security/authentication'),
          permission: PERMISSIONS.AUTH_MANAGE,
        },
        {
          ...moduleHead('/admin/settings/agents'),
          id: '/admin/settings/agents',
          pages: [
            modulePage('/admin/settings/agents/assistants'),
            modulePage('/admin/settings/agents/keys'),
            modulePage('/admin/settings/agents/webhooks'),
          ],
        } satisfies NavModule,
        {
          ...navPage('/admin/settings/labs'),
          permission: PERMISSIONS.SETTINGS_MANAGE,
        },
        {
          ...navPage('/admin/settings/integrations'),
          permission: PERMISSIONS.INTEGRATION_VIEW,
        },
        ...(billingEnabled
          ? [
              {
                ...navPage('/admin/settings/billing'),
                permission: PERMISSIONS.BILLING_MANAGE,
              },
            ]
          : []),
      ],
    },
    {
      label: 'Data',
      items: [
        {
          ...navPage('/admin/settings/people'),
          permission: PERMISSIONS.USER_ATTRIBUTE_VIEW,
        },
        {
          ...navPage('/admin/settings/companies'),
          permission: PERMISSIONS.COMPANY_VIEW,
        },
        {
          ...navPage('/admin/settings/imports'),
          permission: PERMISSIONS.SETTINGS_MANAGE,
        },
      ],
    },
  ]
}

/**
 * The sections as a viewer with these permissions sees them: a page whose
 * route would answer Access denied is left out, and a section left with no
 * pages goes with it.
 */
export function navSectionsFor(
  sections: NavSection[],
  permissions: ReadonlySet<PermissionKey>
): NavSection[] {
  const canOpen = (item: NavItem) =>
    item.anyOf
      ? item.anyOf.some((permission) => permissions.has(permission))
      : !item.permission || permissions.has(item.permission)
  const visible = (entry: NavEntry): NavEntry | null => {
    if (!isNavModule(entry)) return canOpen(entry) ? entry : null
    const pages = entry.pages.filter(canOpen)
    return pages.length > 0 ? { ...entry, pages } : null
  }
  return sections
    .map((section) => ({
      ...section,
      items: section.items.map(visible).filter((entry): entry is NavEntry => entry !== null),
    }))
    .filter((section) => section.items.length > 0)
}

/**
 * Whether a viewer can open at least one settings page, which is what the rail's
 * Settings entry needs. Notifications has no permission and is reached from the
 * bell, so it does not count.
 */
export function canOpenSettings(
  sections: NavSection[],
  permissions: ReadonlySet<PermissionKey>
): boolean {
  const gated = (item: NavItem) => item.permission !== undefined || item.anyOf !== undefined
  const anyGated = (entry: NavEntry) =>
    isNavModule(entry) ? entry.pages.some(gated) : gated(entry)
  return navSectionsFor(sections, permissions).some((section) => section.items.some(anyGated))
}

const GENERAL_PATH = '/admin/settings/general'
const NOTIFICATIONS_PATH = '/admin/settings/notifications'

/**
 * The page the Settings entry opens for a viewer: General when they may open
 * it, otherwise the first page in nav order they hold the permission for, and
 * the personal Notifications page when they hold none. It never names a page
 * whose route would answer Access denied.
 */
export function firstSettingsPath(
  sections: NavSection[],
  permissions: ReadonlySet<PermissionKey>
): string {
  const gatedPaths = navSectionsFor(sections, permissions)
    .flatMap((section) => section.items)
    .flatMap((entry) => (isNavModule(entry) ? entry.pages : [entry]))
    .filter((item) => item.permission !== undefined || item.anyOf !== undefined)
    .map((item) => item.to)
  if (gatedPaths.includes(GENERAL_PATH)) return GENERAL_PATH
  return gatedPaths[0] ?? NOTIFICATIONS_PATH
}

/**
 * The module whose tabs a settings page shows: the module that lists the page
 * itself. A page under one of them (a board, a channel) is a child page with
 * breadcrumbs instead, and a single-page product is a row of its own.
 */
export function moduleOfPage(
  sections: NavSection[],
  page: string | undefined
): NavModule | undefined {
  if (page === undefined) return undefined
  return sections
    .flatMap((section) => section.items)
    .filter(isNavModule)
    .find((module) => module.pages.some((item) => item.to === page))
}

/** Whether a path is the page itself or a page under it. */
export function pathIsUnder(pathname: string, to: string): boolean {
  return pathname === to || pathname.startsWith(`${to}/`)
}
