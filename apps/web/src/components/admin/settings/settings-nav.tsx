import { useMemo, useState, type ComponentType } from 'react'
import { Link, useRouterState, useRouteContext } from '@tanstack/react-router'
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
import { useRefinedTheme } from '@/lib/client/hooks/use-visual-theme'
import { isProductEnabled, type FeatureFlags } from '@/lib/shared/types'
import {
  buildSettingsModules,
  settingsModuleActivePaths,
  settingsModuleLandingPath,
} from './settings-modules'

interface NavItem {
  label: string
  to: string
  icon: ComponentType<{ className?: string }>
  /** Highlight only on this path, not nested child pages. */
  exact?: boolean
  /** Extra prefixes that also count as active (a module covering several pages). */
  activeFor?: string[]
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
        { label: 'General', to: '/admin/settings/general', icon: Cog6ToothIcon },
        ...(cloudEnabled
          ? [{ label: 'Domains', to: '/admin/settings/domains', icon: GlobeAltIcon }]
          : []),
        { label: 'Notifications', to: '/admin/settings/notifications', icon: BellIcon },
        { label: 'Portal', to: '/admin/settings/portal', icon: GlobeAltIcon },
        { label: 'Widget', to: '/admin/settings/widget', icon: ChatBubbleLeftRightIcon },
        { label: 'Members & Teams', to: '/admin/settings/members', icon: UsersIcon },
        {
          label: 'Access & Security',
          to: '/admin/settings/security/authentication',
          icon: ShieldCheckIcon,
        },
        { label: 'Developers', to: '/admin/settings/developers', icon: CommandLineIcon },
        { label: 'Labs', to: '/admin/settings/labs', icon: BeakerIcon },
        { label: 'Integrations', to: '/admin/settings/integrations', icon: PuzzlePieceIcon },
        ...(billingEnabled
          ? [{ label: 'Plan & billing', to: '/admin/settings/billing', icon: CreditCardIcon }]
          : []),
      ],
    },
    {
      label: 'Data',
      items: [
        { label: 'People', to: '/admin/settings/people', icon: UserGroupIcon },
        { label: 'Companies', to: '/admin/settings/companies', icon: BuildingOfficeIcon },
        ...(isProductEnabled(flags, 'support')
          ? [
              {
                label: 'Conversations',
                to: '/admin/settings/conversation-data',
                icon: ChatBubbleLeftIcon,
              },
            ]
          : []),
        { label: 'Imports & exports', to: '/admin/settings/imports', icon: ArrowDownTrayIcon },
      ],
    },
  ]
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

export function SettingsNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const { settings, billingEnabled, cloudEnabled } = useRouteContext({ from: '__root__' })
  const flags = settings?.featureFlags as FeatureFlags | undefined
  const refined = useRefinedTheme()

  const navSections = useMemo(
    () => buildNavSections(flags, billingEnabled, cloudEnabled),
    [flags, billingEnabled, cloudEnabled]
  )

  return (
    <div className={refined ? undefined : 'space-y-2'}>
      {navSections.map((section) => (
        <NavCard key={section.label} section={section} pathname={pathname} refined={refined} />
      ))}
    </div>
  )
}

function NavEntries({
  entries,
  pathname,
  refined,
  parentOpen = true,
}: {
  entries: NavEntry[]
  pathname: string
  refined: boolean
  parentOpen?: boolean
}) {
  return entries.map((entry) =>
    isNavGroup(entry) ? (
      <NavGroupRows
        key={entry.label}
        group={entry}
        pathname={pathname}
        parentOpen={parentOpen}
        refined={refined}
      />
    ) : (
      <NavLink
        key={entry.to}
        item={entry}
        pathname={pathname}
        tabbable={parentOpen}
        refined={refined}
      />
    )
  )
}

function NavCard({
  section,
  pathname,
  refined,
}: {
  section: NavSection
  pathname: string
  refined: boolean
}) {
  if (refined) {
    return (
      <FilterSection title={section.label}>
        <div className="space-y-0.5">
          <NavEntries entries={section.items} pathname={pathname} refined />
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
        <NavEntries entries={section.items} pathname={pathname} refined={false} />
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
  pathname,
  parentOpen,
  refined,
}: {
  group: NavGroup
  pathname: string
  parentOpen: boolean
  refined: boolean
}) {
  const hasActiveKid = group.kids.some((kid) => entryIsInPath(kid, pathname))
  const groupPageActive = !!group.to && pathname === group.to
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
          pathname={pathname}
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
          <NavEntries
            entries={group.kids}
            pathname={pathname}
            parentOpen={parentOpen}
            refined={refined}
          />
        </div>
      )}
    </div>
  )
}

function pathIsUnder(pathname: string, to: string): boolean {
  return pathname === to || pathname.startsWith(`${to}/`)
}

function NavLink({
  item,
  pathname,
  tabbable,
  refined,
}: {
  item: NavItem
  pathname: string
  tabbable: boolean
  refined: boolean
}) {
  const targets = item.activeFor ?? [item.to]
  const isActive = item.exact
    ? targets.some((to) => pathname === to)
    : targets.some((to) => pathIsUnder(pathname, to))
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
}
