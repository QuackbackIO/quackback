import { memo, useMemo, useState, type ComponentType } from 'react'
import { Link, useRouterState } from '@tanstack/react-router'
import {
  Cog6ToothIcon,
  UsersIcon,
  UserGroupIcon,
  PuzzlePieceIcon,
  ChatBubbleLeftRightIcon,
  ChatBubbleLeftIcon,
  CommandLineIcon,
  ShieldCheckIcon,
  ArrowDownTrayIcon,
  ChevronDownIcon,
  BellIcon,
  BuildingOfficeIcon,
  CreditCardIcon,
  GlobeAltIcon,
  BeakerIcon,
} from '@heroicons/react/24/solid'
import { cn } from '@/lib/shared/utils'
import { NAV_ICON_CLASS, NAV_ITEM_CLASS, NAV_SECTION_CLASS } from '@/components/shared/nav-tokens'
import { FilterSection } from '@/components/shared/filter-section'
import { usePermissions } from '@/lib/client/use-permissions'
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'
import { isProductEnabled, type FeatureFlags } from '@/lib/shared/types'
import {
  buildSettingsModules,
  settingsModuleActivePaths,
  settingsModuleLandingPath,
} from './settings-modules'
import {
  useBillingEnabled,
  useCloudEnabled,
  useRefinedTheme,
  useWorkspaceSettings,
} from '@/lib/client/hooks/use-root-context'

interface NavItem {
  label: string
  to: string
  icon: ComponentType<{ className?: string }>
  /** Highlight only on this path, not nested child pages. */
  exact?: boolean
  /** Extra prefixes that also count as active (a module covering several pages). */
  activeFor?: string[]
  /** The permission the page checks when it opens; the nav offers it only to holders. */
  permission?: PermissionKey
}

/** Nested nav group. Modules no longer use this; kept for other sections. */
interface NavGroup {
  label: string
  icon: ComponentType<{ className?: string }>
  /** When set, the group label is also a page (Channels hub). */
  to?: string
  kids: NavEntry[]
}

type NavEntry = NavItem | NavGroup

interface NavSection {
  label: string
  items: NavEntry[]
}

export function isNavGroup(entry: NavEntry): entry is NavGroup {
  return 'kids' in entry
}

/**
 * The settings IA (SETTINGS-IA-SPEC Option B): three stable sections. Flags hide
 * ITEMS (or whole product accordions), never sections, so the sidebar layout
 * does not reflow when a flag flips. AI & Automation lives outside settings
 * entirely, as its own main-nav area at /admin/automation (M5).
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
  const products: NavEntry[] = buildSettingsModules(flags).map((module) => ({
    label: module.label,
    to: settingsModuleLandingPath(module),
    icon: module.icon,
    activeFor: settingsModuleActivePaths(module),
  }))

  return [
    { label: 'Modules', items: products },
    {
      label: 'Workspace',
      items: [
        {
          label: 'General',
          to: '/admin/settings/general',
          icon: Cog6ToothIcon,
          permission: PERMISSIONS.SETTINGS_MANAGE,
        },
        ...(cloudEnabled
          ? [
              {
                label: 'Domains',
                to: '/admin/settings/domains',
                icon: GlobeAltIcon,
                permission: PERMISSIONS.SETTINGS_CUSTOM_DOMAIN,
              },
            ]
          : []),
        { label: 'Notifications', to: '/admin/settings/notifications', icon: BellIcon },
        {
          label: 'Portal',
          to: '/admin/settings/portal',
          icon: GlobeAltIcon,
          permission: PERMISSIONS.SETTINGS_BRANDING,
        },
        {
          label: 'Widget',
          to: '/admin/settings/widget',
          icon: ChatBubbleLeftRightIcon,
          permission: PERMISSIONS.SETTINGS_MANAGE,
        },
        {
          label: 'Members & Teams',
          to: '/admin/settings/members',
          icon: UsersIcon,
          permission: PERMISSIONS.MEMBER_VIEW,
        },
        {
          label: 'Access & Security',
          to: '/admin/settings/security/authentication',
          icon: ShieldCheckIcon,
          permission: PERMISSIONS.AUTH_MANAGE,
        },
        {
          label: 'Developers',
          to: '/admin/settings/developers',
          icon: CommandLineIcon,
          permission: PERMISSIONS.API_KEY_MANAGE,
        },
        {
          label: 'Labs',
          to: '/admin/settings/labs',
          icon: BeakerIcon,
          permission: PERMISSIONS.SETTINGS_MANAGE,
        },
        {
          label: 'Integrations',
          to: '/admin/settings/integrations',
          icon: PuzzlePieceIcon,
          permission: PERMISSIONS.INTEGRATION_VIEW,
        },
        ...(billingEnabled
          ? [
              {
                label: 'Plan & billing',
                to: '/admin/settings/billing',
                icon: CreditCardIcon,
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
          label: 'People',
          to: '/admin/settings/people',
          icon: UserGroupIcon,
          permission: PERMISSIONS.USER_ATTRIBUTE_VIEW,
        },
        {
          label: 'Companies',
          to: '/admin/settings/companies',
          icon: BuildingOfficeIcon,
          permission: PERMISSIONS.COMPANY_VIEW,
        },
        ...(isProductEnabled(flags, 'support')
          ? [
              {
                label: 'Conversations',
                to: '/admin/settings/conversation-data',
                icon: ChatBubbleLeftIcon,
                permission: PERMISSIONS.CONVERSATION_MANAGE,
              },
            ]
          : []),
        {
          label: 'Imports & exports',
          to: '/admin/settings/imports',
          icon: ArrowDownTrayIcon,
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
    return entry.to || kids.length > 0 ? { ...entry, kids } : null
  }
  return sections
    .map((section) => ({
      ...section,
      items: section.items.map(visible).filter((entry): entry is NavEntry => entry !== null),
    }))
    .filter((section) => section.items.length > 0)
}

function settingsRowClass(active: boolean, refined: boolean) {
  return cn(
    NAV_ITEM_CLASS,
    refined && 'w-full',
    active
      ? refined
        ? 'bg-muted text-foreground font-medium'
        : 'bg-primary/10 text-foreground font-medium'
      : refined
        ? 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
        : 'text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04]'
  )
}

/**
 * The nav stays mounted across settings pages. Each row follows the location
 * on its own, and the nav selects the context parts it builds the rows from,
 * so a navigation renders only the rows whose highlight moved.
 */
export function SettingsNav() {
  const settings = useWorkspaceSettings()
  const billingEnabled = useBillingEnabled()
  const cloudEnabled = useCloudEnabled()
  const flags = settings?.featureFlags as FeatureFlags | undefined
  const permissions = usePermissions()
  const refined = useRefinedTheme()

  const navSections = useMemo(
    () => navSectionsFor(buildNavSections(flags, billingEnabled, cloudEnabled), permissions),
    [flags, billingEnabled, cloudEnabled, permissions]
  )

  return (
    <div className={refined ? undefined : 'space-y-2'}>
      {navSections.map((section) => (
        <NavCard key={section.label} section={section} refined={refined} />
      ))}
    </div>
  )
}

function NavEntries({
  entries,
  refined,
  parentOpen = true,
}: {
  entries: NavEntry[]
  refined: boolean
  parentOpen?: boolean
}) {
  return entries.map((entry) =>
    isNavGroup(entry) ? (
      <NavGroupRows key={entry.label} group={entry} parentOpen={parentOpen} refined={refined} />
    ) : (
      <NavLink key={entry.to} item={entry} tabbable={parentOpen} refined={refined} />
    )
  )
}

function NavCard({ section, refined }: { section: NavSection; refined: boolean }) {
  if (refined) {
    return (
      <FilterSection title={section.label}>
        <div className="space-y-0.5">
          <NavEntries entries={section.items} refined />
        </div>
      </FilterSection>
    )
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border/50 bg-muted/20 bg-gradient-to-b from-foreground/[0.04] to-transparent">
      <div className="px-3 py-2.5">
        <span className={NAV_SECTION_CLASS}>{section.label}</span>
      </div>
      <div className="space-y-0.5 px-1.5 pb-2">
        <NavEntries entries={section.items} refined={false} />
      </div>
    </div>
  )
}

function entryIsInPath(entry: NavEntry, pathname: string): boolean {
  if (isNavGroup(entry)) {
    if (entry.to && (pathname === entry.to || pathname.startsWith(`${entry.to}/`))) return true
    return entry.kids.some((kid) => entryIsInPath(kid, pathname))
  }
  return pathname === entry.to || pathname.startsWith(`${entry.to}/`)
}

/** A product accordion: a toggle row plus its indented child links. */
function NavGroupRows({
  group,
  parentOpen,
  refined,
}: {
  group: NavGroup
  parentOpen: boolean
  refined: boolean
}) {
  const hasActiveKid = useRouterState({
    select: (s) => group.kids.some((kid) => entryIsInPath(kid, s.location.pathname)),
  })
  const groupPageActive = useRouterState({
    select: (s) => !!group.to && s.location.pathname === group.to,
  })
  const inGroup = groupPageActive || hasActiveKid
  // Groups with the active page start open; others start collapsed to keep
  // the Modules section scannable. A linked group (Channels) always shows
  // its child pages — those are breadcrumb children, not a second accordion.
  const [open, setOpen] = useState(inGroup)
  const showKids = !!group.to || open
  const Icon = group.icon

  return (
    <div>
      {group.to ? (
        <NavLink
          item={{ label: group.label, to: group.to, icon: group.icon, exact: true }}
          tabbable={parentOpen}
          refined={refined}
        />
      ) : (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          tabIndex={parentOpen ? undefined : -1}
          data-active={inGroup || undefined}
          className={
            refined
              ? settingsRowClass(inGroup, true)
              : cn(
                  NAV_ITEM_CLASS,
                  'w-full font-medium',
                  inGroup ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
                )
          }
        >
          <Icon className={cn(NAV_ICON_CLASS, inGroup && !refined && 'text-primary')} />
          <span className="truncate flex-1 text-left">{group.label}</span>
          <ChevronDownIcon
            className={cn(
              'h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200 ease-out',
              !open && '-rotate-90'
            )}
          />
        </button>
      )}
      {showKids && (
        <div
          className={
            refined ? 'space-y-0.5 pl-3' : 'ml-4 space-y-0.5 border-l border-border/50 pl-1.5'
          }
        >
          <NavEntries entries={group.kids} parentOpen={parentOpen} refined={refined} />
        </div>
      )}
    </div>
  )
}

function pathIsUnder(pathname: string, to: string): boolean {
  return pathname === to || pathname.startsWith(`${to}/`)
}

function navLinkIsActive(item: NavItem, pathname: string): boolean {
  const targets = item.activeFor ?? [item.to]
  return item.exact
    ? targets.some((to) => pathname === to)
    : targets.some((to) => pathIsUnder(pathname, to))
}

interface NavLinkProps {
  item: NavItem
  tabbable: boolean
  refined: boolean
}

const sameTargets = (a: string[] | undefined, b: string[] | undefined) =>
  a === b || (!!a && !!b && a.length === b.length && a.every((to, i) => to === b[i]))

/**
 * One nav row. It follows the location itself, selecting only whether it is
 * active, and is memoized on what it shows, so a navigation re-renders the
 * rows it activates or deactivates instead of every row in the nav.
 */
const NavLink = memo(
  function NavLink({ item, tabbable, refined }: NavLinkProps) {
    const isActive = useRouterState({ select: (s) => navLinkIsActive(item, s.location.pathname) })
    const Icon = item.icon

    return (
      <Link
        to={item.to}
        tabIndex={tabbable ? undefined : -1}
        data-active={isActive || undefined}
        className={settingsRowClass(isActive, refined)}
      >
        <Icon className={cn(NAV_ICON_CLASS, isActive && !refined && 'text-primary')} />
        <span className="truncate flex-1">{item.label}</span>
      </Link>
    )
  },
  (prev, next) =>
    prev.tabbable === next.tabbable &&
    prev.refined === next.refined &&
    prev.item.to === next.item.to &&
    prev.item.label === next.item.label &&
    prev.item.icon === next.item.icon &&
    prev.item.exact === next.item.exact &&
    sameTargets(prev.item.activeFor, next.item.activeFor)
)
