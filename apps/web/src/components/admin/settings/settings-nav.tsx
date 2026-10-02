import { memo, useContext, useMemo, type ComponentType, type ReactNode } from 'react'
import { Link, useRouterState } from '@tanstack/react-router'
import { cn } from '@/lib/shared/utils'
import { NAV_ICON_CLASS, NAV_ITEM_CLASS } from '@/components/shared/nav-tokens'
import { FilterSection } from '@/components/shared/filter-section'
import { usePermissions } from '@/lib/client/use-permissions'
import { AUTOMATION_PAGE_ICONS, SETTINGS_PAGE_ICONS } from './settings-page-icons'
import {
  buildNavSections,
  isNavModule,
  navSectionsFor,
  pathIsUnder,
  type NavItem,
  type NavModule,
} from './settings-nav-sections'
import { SettingsNavContext } from './settings-page'
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
 * Builds the settings nav for the current viewer once, for the nav and for the
 * module tabs on the page. It selects the context parts the nav is made from,
 * so a navigation that leaves them alone renders neither it nor the nav.
 */
export function SettingsNavProvider({ children }: { children: ReactNode }) {
  const flags = useFeatureFlags()
  const billingEnabled = useBillingEnabled()
  const cloudEnabled = useCloudEnabled()
  const permissions = usePermissions()

  const navSections = useMemo(
    () => navSectionsFor(buildNavSections(flags, billingEnabled, cloudEnabled), permissions),
    [flags, billingEnabled, cloudEnabled, permissions]
  )

  return <SettingsNavContext.Provider value={navSections}>{children}</SettingsNavContext.Provider>
}

/**
 * The nav stays mounted across settings pages. Each row follows the location
 * on its own, so a navigation renders only the rows whose highlight moved.
 */
export function SettingsNav() {
  const navSections = useContext(SettingsNavContext)
  if (!navSections) throw new Error('SettingsNav renders inside SettingsNavProvider')

  return (
    <div>
      {navSections.map((section) => (
        <FilterSection key={section.label} title={section.label}>
          <div className="space-y-0.5">
            {section.items.map((entry) =>
              isNavModule(entry) ? (
                <ModuleNavLink key={entry.id} module={entry} />
              ) : (
                <NavLink key={entry.to} item={entry} />
              )
            )}
          </div>
        </FilterSection>
      ))}
    </div>
  )
}

const PREFIX_ACTIVE = { includeSearch: false }
const EXACT_ACTIVE = { exact: true, includeSearch: false }

const rowStateProps = {
  activeProps: { className: settingsRowClass(true), 'data-active': 'true' },
  inactiveProps: { className: settingsRowClass(false) },
}

function rowContent(label: string, iconPath: string) {
  const Icon = iconFor(iconPath)
  return (
    <>
      <Icon className={NAV_ICON_CLASS} />
      <span className="truncate flex-1">{label}</span>
    </>
  )
}

/**
 * One nav row. The Link tracks whether its page is the current one and renders
 * again only when that changes, and then only itself. Its contents are the same
 * in either state and made once, so a navigation renders no row contents.
 */
const NavLink = memo(
  function NavLink({ item }: { item: NavItem }) {
    const content = useMemo(() => rowContent(item.label, item.to), [item.label, item.to])
    return (
      <Link
        to={item.to}
        activeOptions={item.exact ? EXACT_ACTIVE : PREFIX_ACTIVE}
        {...rowStateProps}
      >
        {content}
      </Link>
    )
  },
  (prev, next) =>
    prev.item.to === next.item.to &&
    prev.item.label === next.item.label &&
    prev.item.exact === next.item.exact
)

/**
 * A module's row. It opens the module's first page and stays highlighted on
 * every page of the module and the pages under them, rendering again only
 * when the location moves into or out of the module.
 */
const ModuleNavLink = memo(function ModuleNavLink({ module }: { module: NavModule }) {
  const active = useRouterState({
    select: (s) => module.pages.some((page) => pathIsUnder(s.location.pathname, page.to)),
  })
  const content = useMemo(() => rowContent(module.label, module.id), [module.label, module.id])
  return (
    <Link
      to={module.pages[0]!.to}
      className={settingsRowClass(active)}
      data-active={active ? 'true' : undefined}
      aria-current={active ? 'page' : undefined}
    >
      {content}
    </Link>
  )
})
