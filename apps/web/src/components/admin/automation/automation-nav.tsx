import { Link, useRouterState, useRouteContext } from '@tanstack/react-router'
import { SparklesIcon, BoltIcon, BeakerIcon, CircleStackIcon } from '@heroicons/react/24/solid'
import { cn } from '@/lib/shared/utils'
import type { FeatureFlags } from '@/lib/shared/types/settings'

interface NavItem {
  label: string
  to: string
  icon: typeof SparklesIcon
}

const BASE_NAV_ITEMS: NavItem[] = [
  { label: 'Assistant', to: '/admin/automation/assistant', icon: SparklesIcon },
  { label: 'Workflows', to: '/admin/automation/workflows', icon: BoltIcon },
  { label: 'Sandbox', to: '/admin/automation/sandbox', icon: BeakerIcon },
]

/** Data connectors only appears once its flag is on, mirroring the flag-gated
 *  items in settings-nav.tsx's buildNavSections. */
export function buildAutomationNavItems(flags?: { dataConnectors?: boolean }): NavItem[] {
  const items = [...BASE_NAV_ITEMS]
  if (flags?.dataConnectors) {
    items.push({
      label: 'Data connectors',
      to: '/admin/automation/connectors',
      icon: CircleStackIcon,
    })
  }
  return items
}

/**
 * Left sub-nav for the AI & Automation area. Flat (no accordions, unlike
 * SettingsNav's Products group) since the area only has a few pages today;
 * Knowledge joins later per SUPPORT-PLATFORM-SPEC §4.7 Track Q. Reuses the
 * SettingsNav card/link styling idioms so the area feels native.
 */
export function AutomationNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const { settings } = useRouteContext({ from: '__root__' })
  const flags = settings?.featureFlags as FeatureFlags | undefined
  const navItems = buildAutomationNavItems(flags)

  return (
    <div className="overflow-hidden rounded-xl border border-border/50 bg-muted/20 bg-gradient-to-b from-foreground/[0.04] to-transparent">
      <div className="space-y-0.5 px-1.5 py-2">
        {navItems.map((item) => {
          const isActive = pathname === item.to || pathname.startsWith(item.to + '/')
          const Icon = item.icon
          return (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                'flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
                isActive
                  ? 'bg-primary/10 text-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04]'
              )}
            >
              <Icon className={cn('h-3.5 w-3.5 shrink-0', isActive && 'text-primary')} />
              <span className="truncate flex-1">{item.label}</span>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
