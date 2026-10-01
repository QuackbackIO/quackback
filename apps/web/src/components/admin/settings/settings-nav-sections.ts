import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'
import { isProductEnabled, type FeatureFlags } from '@/lib/shared/types'
import {
  AUTOMATION_PAGES,
  SETTINGS_PAGES,
  type AutomationPagePath,
  type SettingsPagePath,
} from './settings-pages'

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
}

/**
 * A module with several pages. It has no page of its own: its pages are the
 * rows under it, the module of the current page is open, and opening a closed
 * one goes to its first page. `id` is the module's own page path, which keys
 * its icon.
 */
export interface NavGroup {
  label: string
  id: SettingsPagePath
  kids: NavEntry[]
}

export type NavEntry = NavItem | NavGroup

export interface NavSection {
  label: string
  items: NavEntry[]
}

export interface SettingsModuleRowPage {
  label: string
  to: SettingsPagePath
  /** The permission the page's route checks; the nav and module landing offer it only to holders. */
  permission: PermissionKey
}

export interface SettingsModuleRow {
  id: string
  label: string
  /** The module's own page path; its icon is keyed by it. */
  to: SettingsPagePath
  pages: SettingsModuleRowPage[]
}

/** The permission each module page's route checks when it opens. */
const MODULE_PAGE_PERMISSIONS = {
  '/admin/settings/boards': PERMISSIONS.BOARD_MANAGE,
  '/admin/settings/statuses': PERMISSIONS.STATUS_MANAGE,
  '/admin/settings/tags': PERMISSIONS.TAG_MANAGE,
  '/admin/settings/moderation': PERMISSIONS.SETTINGS_MODERATION,
  '/admin/settings/channels': PERMISSIONS.SETTINGS_MANAGE,
  '/admin/settings/channels/email': PERMISSIONS.CHANNEL_ACCOUNT_MANAGE,
  '/admin/settings/channels/github': PERMISSIONS.CHANNEL_ACCOUNT_MANAGE,
  '/admin/settings/macros': PERMISSIONS.CONVERSATION_MANAGE,
  '/admin/settings/office-hours': PERMISSIONS.OFFICE_HOURS_MANAGE,
  '/admin/settings/sla': PERMISSIONS.SLA_MANAGE,
  '/admin/settings/ticket-types': PERMISSIONS.TICKET_MANAGE_TYPES,
  '/admin/settings/ticket-statuses': PERMISSIONS.TICKET_MANAGE_TYPES,
  '/admin/settings/help-center': PERMISSIONS.HELP_CENTER_MANAGE,
  '/admin/settings/changelog': PERMISSIONS.CHANGELOG_MANAGE,
  '/admin/settings/status': PERMISSIONS.STATUS_PAGE_MANAGE,
} as const satisfies Partial<Record<SettingsPagePath, PermissionKey>>

type ModulePagePath = keyof typeof MODULE_PAGE_PERMISSIONS

/** A module page whose label comes from the page registry. */
function modulePage(to: ModulePagePath): SettingsModuleRowPage {
  const { label } = SETTINGS_PAGES[to]
  return { label, to, permission: MODULE_PAGE_PERMISSIONS[to] }
}

function moduleHead(to: SettingsPagePath) {
  const { label } = SETTINGS_PAGES[to]
  return { label, to }
}

/** Product modules shown under Settings, Modules. A module with several pages expands in the nav. */
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
  if (flags?.supportInbox) {
    supportPages.push(modulePage('/admin/settings/channels'))
  } else if (isProductEnabled(flags, 'support')) {
    supportPages.push(
      modulePage('/admin/settings/channels/email'),
      modulePage('/admin/settings/channels/github')
    )
  }
  if (isProductEnabled(flags, 'support')) {
    supportPages.push(
      modulePage('/admin/settings/macros'),
      modulePage('/admin/settings/office-hours'),
      modulePage('/admin/settings/sla')
    )
  }
  if (flags?.supportTickets) {
    supportPages.push(
      modulePage('/admin/settings/ticket-types'),
      modulePage('/admin/settings/ticket-statuses')
    )
  }
  if (supportPages.length > 0) {
    modules.push({
      id: 'support',
      ...moduleHead('/admin/settings/support'),
      pages: supportPages,
    })
  }

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

/** A nav row for an AI & Automation page; its label is the message's default text. */
function navAutomationPage(to: AutomationPagePath, permission: PermissionKey): NavItem {
  return { label: AUTOMATION_PAGES[to].defaultMessage, to, permission }
}

export function isNavGroup(entry: NavEntry): entry is NavGroup {
  return 'kids' in entry
}

/**
 * The settings IA (SETTINGS-IA-SPEC Option B): four stable sections (Modules,
 * AI & Automation, Workspace, Data). Flags hide ITEMS (or whole product
 * accordions), never sections, so the sidebar layout does not reflow when a
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
  cloudEnabled = false
): NavSection[] {
  const products: NavEntry[] = buildSettingsModuleRows(flags).map((module): NavEntry => {
    const [only, ...rest] = module.pages
    if (only && rest.length === 0) {
      return { label: only.label, to: only.to, permission: only.permission }
    }
    return {
      label: module.label,
      id: module.to,
      kids: module.pages.map(({ label, to, permission }) => ({ label, to, permission })),
    }
  })

  return [
    { label: 'Modules', items: products },
    {
      label: 'AI & Automation',
      items: [
        navAutomationPage('/admin/settings/agent', PERMISSIONS.ASSISTANT_MANAGE),
        navAutomationPage('/admin/settings/copilot', PERMISSIONS.ASSISTANT_MANAGE),
        navAutomationPage('/admin/settings/skills', PERMISSIONS.ASSISTANT_MANAGE),
        navAutomationPage('/admin/settings/connectors', PERMISSIONS.ASSISTANT_MANAGE),
        ...(flags?.supportInbox
          ? [navAutomationPage('/admin/settings/workflows', PERMISSIONS.WORKFLOW_MANAGE)]
          : []),
      ],
    },
    {
      label: 'Workspace',
      items: [
        {
          ...navPage('/admin/settings/general'),
          permission: PERMISSIONS.SETTINGS_MANAGE,
        },
        ...(cloudEnabled
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
          ...navPage('/admin/settings/developers'),
          permission: PERMISSIONS.API_KEY_MANAGE,
        },
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
        ...(isProductEnabled(flags, 'support')
          ? [
              {
                ...navPage('/admin/settings/conversation-data'),
                permission: PERMISSIONS.CONVERSATION_MANAGE,
              },
            ]
          : []),
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
  const visible = (entry: NavEntry): NavEntry | null => {
    if (!isNavGroup(entry)) {
      return !entry.permission || permissions.has(entry.permission) ? entry : null
    }
    const kids = entry.kids.map(visible).filter((kid): kid is NavEntry => kid !== null)
    return kids.length > 0 ? { ...entry, kids } : null
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
  const gated = (entry: NavEntry): boolean =>
    isNavGroup(entry) ? entry.kids.some(gated) : entry.permission !== undefined
  return navSectionsFor(sections, permissions).some((section) => section.items.some(gated))
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
  const gatedPaths: string[] = []
  const collect = (entry: NavEntry) => {
    if (isNavGroup(entry)) entry.kids.forEach(collect)
    else if (entry.permission !== undefined) gatedPaths.push(entry.to)
  }
  navSectionsFor(sections, permissions).forEach((section) => section.items.forEach(collect))
  if (gatedPaths.includes(GENERAL_PATH)) return GENERAL_PATH
  return gatedPaths[0] ?? NOTIFICATIONS_PATH
}
