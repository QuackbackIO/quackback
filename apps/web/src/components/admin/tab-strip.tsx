import { Link, useRouterState } from '@tanstack/react-router'
import { cn } from '@/lib/shared/utils'

export interface TabStripItem {
  label: string
  to: string
  icon: React.ComponentType<{ className?: string }>
  exact?: boolean
  /** Explicit search params to set when clicking this tab. Clears all others. */
  search?: Record<string, unknown>
  /** Optional badge count shown next to the label. */
  badge?: number
}

interface TabStripProps {
  tabs: TabStripItem[]
}

export function TabStrip({ tabs }: TabStripProps) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  return (
    <div className="flex items-center gap-1 border-b border-border/50 px-4 bg-card/30">
      {tabs.map((tab) => {
        const isActive = tab.exact
          ? pathname === tab.to || pathname === tab.to + '/'
          : pathname.startsWith(tab.to)
        const Icon = tab.icon

        return (
          <Link
            key={tab.to}
            to={tab.to}
            search={tab.search ?? {}}
            className={cn(
              'flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium transition-colors',
              isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {tab.label}
            {tab.badge != null && tab.badge > 0 && (
              <span className="ml-0.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-semibold rounded-full bg-primary/10 text-primary">
                {tab.badge}
              </span>
            )}
          </Link>
        )
      })}
    </div>
  )
}
