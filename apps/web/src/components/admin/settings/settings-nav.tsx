import { memo, useEffect, useMemo, useState, type ComponentType } from 'react'
import { Link, useNavigate, useRouterState } from '@tanstack/react-router'
import { ChevronDownIcon } from '@heroicons/react/24/solid'
import { cn } from '@/lib/shared/utils'
import { NAV_ICON_CLASS, NAV_ITEM_CLASS } from '@/components/shared/nav-tokens'
import { FilterSection } from '@/components/shared/filter-section'
import { usePermissions } from '@/lib/client/use-permissions'
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'
import { isProductEnabled, type FeatureFlags } from '@/lib/shared/types'
import {
  AUTOMATION_PAGES,
  SETTINGS_PAGES,
  type AutomationPagePath,
  type SettingsPagePath,
} from './settings-pages'
import { AUTOMATION_PAGE_ICONS, SETTINGS_PAGE_ICONS } from './settings-page-icons'
import { buildSettingsModules } from './settings-modules'
import {
  useBillingEnabled,
  useCloudEnabled,
  useFeatureFlags,
} from '@/lib/client/hooks/use-root-context'

interface NavItem {
  label: string
  to: string
  icon: ComponentType<{ className?: string }>
  /** Highlight only on this path, not nested child pages. */
  exact?: boolean
  /** The permission the page checks when it opens; the nav offers it only to holders. */
  permission?: PermissionKey
}

/**
 * A module with several pages. It has no page of its own: its pages are the
 * rows under it, the module of the current page is open, and opening a closed
 * one goes to its first page.
 */
interface NavGroup {
  label: string
  icon: ComponentType<{ className?: string }>
  kids: NavEntry[]
}

type NavEntry = NavItem | NavGroup

interface NavSection {
  label: string
  items: NavEntry[]
}

/** A nav row whose label and icon come from the page registry. */
function navPage(to: SettingsPagePath) {
  const { label } = SETTINGS_PAGES[to]
  return { label, to, icon: SETTINGS_PAGE_ICONS[to] }
}

/** A nav row for an AI & Automation page; its label is the message's default text. */
function navAutomationPage(to: AutomationPagePath, permission: PermissionKey) {
  return {
    label: AUTOMATION_PAGES[to].defaultMessage,
    to,
    icon: AUTOMATION_PAGE_ICONS[to],
    permission,
  }
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
 *   configured. Not a feature flag — a flag answers "has the admin turned it
 *   on", and this answers "does this deployment sell anything". False on
 *   every self-hosted install, which is why the Billing row is absent there.
 */
export function buildNavSections(
  flags?: Partial<FeatureFlags>,
  billingEnabled = false,
  cloudEnabled = false
): NavSection[] {
  const products: NavEntry[] = buildSettingsModules(flags).map((module): NavEntry => {
    const [only, ...rest] = module.pages
    if (only && rest.length === 0) {
      return { label: only.label, to: only.to, icon: only.icon, permission: only.permission }
    }
    return {
      label: module.label,
      icon: module.icon,
      kids: module.pages.map(({ label, to, icon, permission }) => ({
        label,
        to,
        icon,
        permission,
      })),
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

function settingsRowClass(active: boolean) {
  return cn(
    NAV_ITEM_CLASS,
    'w-full',
    active
      ? 'bg-muted text-foreground font-medium'
      : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
  )
}

/**
 * The nav stays mounted across settings pages. Each row follows the location
 * on its own, and the nav selects the context parts it builds the rows from,
 * so a navigation renders only the rows whose highlight moved.
 */
export function SettingsNav() {
  const flags = useFeatureFlags()
  const billingEnabled = useBillingEnabled()
  const cloudEnabled = useCloudEnabled()
  const permissions = usePermissions()

  const navSections = useMemo(
    () => navSectionsFor(buildNavSections(flags, billingEnabled, cloudEnabled), permissions),
    [flags, billingEnabled, cloudEnabled, permissions]
  )

  return (
    <div>
      {navSections.map((section) => (
        <NavCard key={section.label} section={section} />
      ))}
    </div>
  )
}

function NavEntries({ entries, parentOpen = true }: { entries: NavEntry[]; parentOpen?: boolean }) {
  return entries.map((entry) => {
    if (isNavGroup(entry)) {
      return <NavGroupRows key={entry.label} group={entry} parentOpen={parentOpen} />
    }
    return <NavLink key={entry.to} item={entry} tabbable={parentOpen} />
  })
}

function NavCard({ section }: { section: NavSection }) {
  return (
    <FilterSection title={section.label}>
      <div className="space-y-0.5">
        <NavEntries entries={section.items} />
      </div>
    </FilterSection>
  )
}

function entryIsInPath(entry: NavEntry, pathname: string): boolean {
  if (isNavGroup(entry)) return entry.kids.some((kid) => entryIsInPath(kid, pathname))
  return pathname === entry.to || pathname.startsWith(`${entry.to}/`)
}

function firstPageOf(entry: NavEntry): string | undefined {
  if (!isNavGroup(entry)) return entry.to
  for (const kid of entry.kids) {
    const to = firstPageOf(kid)
    if (to) return to
  }
  return undefined
}

/** A module: a toggle row plus its indented page rows. */
function NavGroupRows({ group, parentOpen }: { group: NavGroup; parentOpen: boolean }) {
  const navigate = useNavigate()
  const inGroup = useRouterState({
    select: (s) => group.kids.some((kid) => entryIsInPath(kid, s.location.pathname)),
  })
  // The module of the current page is open. A click overrides that until the
  // location moves into or out of the module again.
  const [override, setOverride] = useState<boolean | null>(null)
  useEffect(() => setOverride(null), [inGroup])
  const open = override ?? inGroup
  const Icon = group.icon

  const toggle = () => {
    if (open || inGroup) {
      setOverride(!open)
      return
    }
    setOverride(true)
    const first = firstPageOf(group)
    if (first) void navigate({ to: first })
  }

  return (
    <div>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        tabIndex={parentOpen ? undefined : -1}
        className={cn(settingsRowClass(false), inGroup && 'text-foreground font-medium')}
      >
        <Icon className={NAV_ICON_CLASS} />
        <span className="truncate flex-1 text-left">{group.label}</span>
        <ChevronDownIcon
          className={cn(
            'h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200 ease-out',
            !open && '-rotate-90'
          )}
        />
      </button>
      {open && (
        <div className="space-y-0.5 pl-3">
          <NavEntries entries={group.kids} parentOpen={parentOpen} />
        </div>
      )}
    </div>
  )
}

interface NavLinkProps {
  item: NavItem
  tabbable: boolean
}

const PREFIX_ACTIVE = { includeSearch: false }
const EXACT_ACTIVE = { exact: true, includeSearch: false }

const rowStateProps = {
  activeProps: { className: settingsRowClass(true), 'data-active': 'true' },
  inactiveProps: { className: settingsRowClass(false) },
}

function rowContent(item: NavItem) {
  const Icon = item.icon
  return (
    <>
      <Icon className={NAV_ICON_CLASS} />
      <span className="truncate flex-1">{item.label}</span>
    </>
  )
}

/** Rows are memoized on what they show. */
const sameRow = (prev: NavLinkProps, next: NavLinkProps) =>
  prev.tabbable === next.tabbable &&
  prev.item.to === next.item.to &&
  prev.item.label === next.item.label &&
  prev.item.icon === next.item.icon &&
  prev.item.exact === next.item.exact

/**
 * One nav row. The Link tracks whether its page is the current one and renders
 * again only when that changes, and then only itself. Its contents are the same
 * in either state and made once, so a navigation renders no row contents.
 */
const NavLink = memo(function NavLink({ item, tabbable }: NavLinkProps) {
  const content = useMemo(() => rowContent(item), [item])
  return (
    <Link
      to={item.to}
      tabIndex={tabbable ? undefined : -1}
      activeOptions={item.exact ? EXACT_ACTIVE : PREFIX_ACTIVE}
      {...rowStateProps}
    >
      {content}
    </Link>
  )
}, sameRow)
