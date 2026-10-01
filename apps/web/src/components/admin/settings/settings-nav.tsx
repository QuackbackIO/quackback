import { memo, useEffect, useMemo, useState, type ComponentType } from 'react'
import { Link, useNavigate, useRouterState } from '@tanstack/react-router'
import { ChevronDownIcon } from '@heroicons/react/24/solid'
import { cn } from '@/lib/shared/utils'
import { NAV_ICON_CLASS, NAV_ITEM_CLASS } from '@/components/shared/nav-tokens'
import { FilterSection } from '@/components/shared/filter-section'
import { usePermissions } from '@/lib/client/use-permissions'
import { AUTOMATION_PAGE_ICONS, SETTINGS_PAGE_ICONS } from './settings-page-icons'
import {
  buildNavSections,
  isNavGroup,
  navSectionsFor,
  type NavEntry,
  type NavGroup,
  type NavItem,
  type NavSection,
} from './settings-nav-sections'
import {
  useBillingEnabled,
  useCloudEnabled,
  useFeatureFlags,
} from '@/lib/client/hooks/use-root-context'

type IconComponent = ComponentType<{ className?: string }>

const ICONS: Record<string, IconComponent> = { ...SETTINGS_PAGE_ICONS, ...AUTOMATION_PAGE_ICONS }

/** The icon of a row or module, keyed by its page path. */
function iconFor(path: string): IconComponent {
  return ICONS[path]!
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
  const Icon = iconFor(group.id)

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
  const Icon = iconFor(item.to)
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
