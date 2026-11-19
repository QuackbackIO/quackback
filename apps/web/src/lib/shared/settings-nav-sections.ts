import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'
import {
  SETTINGS_PAGE_ACCESS,
  holdsPageGate,
  type GatedSettingsPage,
  type PageGate,
} from '@/lib/shared/settings-page-access'
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
  /**
   * Who the page opens to (SETTINGS_PAGE_ACCESS); the nav offers it only to
   * them. Absent for a page open to every teammate (Notifications).
   */
  gate?: PageGate
  /**
   * A page that summarises others (Domains). It is offered in the nav, but chosen
   * as the page Settings opens on only for a holder of `owner`, the one permission
   * whose setup lives on the page itself; every other viewer owns a page of their own.
   */
  overview?: { owner: PermissionKey }
}

/**
 * A product with several pages. It is one row in the nav that opens its first
 * page, and its pages are tabs under the module title on each of them. `id` is
 * the module's own page path, which keys its icon.
 */
export interface NavModule {
  label: string
  id: SettingsPagePath
  pages: NavItem[]
}

export type NavEntry = NavItem | NavModule

export interface NavSection {
  label: string
  items: NavEntry[]
}

export interface SettingsModuleRowPage {
  label: string
  to: SettingsPagePath
  /** Who the page's route opens to; the nav and module landing offer it only to them. */
  gate: PageGate
}

export interface SettingsModuleRow {
  id: string
  label: string
  /** The module's own page path; its icon is keyed by it. */
  to: SettingsPagePath
  pages: SettingsModuleRowPage[]
}

type ModulePagePath = SettingsPagePath & GatedSettingsPage

/** A module page whose label comes from the page registry. */
function modulePage(to: ModulePagePath): SettingsModuleRowPage {
  const { label } = SETTINGS_PAGES[to]
  return { label, to, gate: SETTINGS_PAGE_ACCESS[to] }
}

function moduleHead(to: SettingsPagePath) {
  const { label } = SETTINGS_PAGES[to]
  return { label, to }
}

/**
 * The breadcrumb a page under a module's page shows for the module. It links
 * to the module, which opens the first of its pages the viewer can open.
 */
export function moduleCrumb(to: '/admin/settings/feedback' | '/admin/settings/support') {
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
function navPage(to: SettingsPagePath & GatedSettingsPage): NavItem {
  return { label: SETTINGS_PAGES[to].label, to, gate: SETTINGS_PAGE_ACCESS[to] }
}

/** A nav row for an AI & Automation page; its label is the message's default text. */
function navAutomationPage(to: AutomationPagePath): NavItem {
  return { label: AUTOMATION_PAGES[to].defaultMessage, to, gate: SETTINGS_PAGE_ACCESS[to] }
}

export function isNavModule(entry: NavEntry): entry is NavModule {
  return 'pages' in entry
}

/**
 * The settings IA (SETTINGS-IA-SPEC Option B): four stable sections (Modules,
 * AI & Automation, Workspace, Data). Flags hide ITEMS (or whole product
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
  billingEnabled = false
): NavSection[] {
  const products: NavEntry[] = buildSettingsModuleRows(flags).map((module): NavEntry => {
    const [only, ...rest] = module.pages
    if (only && rest.length === 0) {
      return { label: only.label, to: only.to, gate: only.gate }
    }
    return {
      label: module.label,
      id: module.to,
      pages: module.pages.map(({ label, to, gate }) => ({ label, to, gate })),
    }
  })

  return [
    { label: 'Modules', items: products },
    {
      label: 'AI & Automation',
      items: [
        navAutomationPage('/admin/settings/agent'),
        navAutomationPage('/admin/settings/copilot'),
        navAutomationPage('/admin/settings/skills'),
        navAutomationPage('/admin/settings/connectors'),
        ...(flags?.supportInbox ? [navAutomationPage('/admin/settings/workflows')] : []),
      ],
    },
    {
      label: 'Workspace',
      items: [
        navPage('/admin/settings/general'),
        {
          ...navPage('/admin/settings/domains'),
          // Adding a domain is the setup on the page itself; custom domains are on Portal.
          overview: { owner: PERMISSIONS.SETTINGS_MANAGE },
        },
        navPage('/admin/settings/email'),
        {
          label: SETTINGS_PAGES['/admin/settings/notifications'].label,
          to: '/admin/settings/notifications',
        },
        // Its Design tab opens to settings.branding with settings.manage, its Custom domains tab to settings.custom_domain.
        navPage('/admin/settings/portal'),
        navPage('/admin/settings/widget'),
        navPage('/admin/settings/members'),
        navPage('/admin/settings/security/authentication'),
        navPage('/admin/settings/developers'),
        navPage('/admin/settings/labs'),
        navPage('/admin/settings/integrations'),
        ...(billingEnabled ? [navPage('/admin/settings/billing')] : []),
      ],
    },
    {
      label: 'Data',
      items: [
        navPage('/admin/settings/people'),
        navPage('/admin/settings/companies'),
        ...(isProductEnabled(flags, 'support')
          ? [navPage('/admin/settings/conversation-data')]
          : []),
        navPage('/admin/settings/imports'),
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
  const canOpen = (item: NavItem) => !item.gate || holdsPageGate(permissions, item.gate)
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
  const gated = (item: NavItem) => item.gate !== undefined
  const anyGated = (entry: NavEntry) =>
    isNavModule(entry) ? entry.pages.some(gated) : gated(entry)
  return navSectionsFor(sections, permissions).some((section) => section.items.some(anyGated))
}

const GENERAL_PATH = '/admin/settings/general'
const NOTIFICATIONS_PATH = '/admin/settings/notifications'

/**
 * The page the Settings entry opens for a viewer: General when they may open
 * it, otherwise the first page in nav order they hold the permission for, and
 * the personal Notifications page when they hold none. An overview page is
 * chosen only for a holder of its owner permission. It never names a page
 * whose route would answer Access denied.
 */
export function firstSettingsPath(
  sections: NavSection[],
  permissions: ReadonlySet<PermissionKey>
): string {
  const gatedPaths = navSectionsFor(sections, permissions)
    .flatMap((section) => section.items)
    .flatMap((entry) => (isNavModule(entry) ? entry.pages : [entry]))
    .filter((item) => !item.overview || permissions.has(item.overview.owner))
    .filter((item) => item.gate !== undefined)
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
