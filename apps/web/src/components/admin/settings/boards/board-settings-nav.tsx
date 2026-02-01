import {
  Cog6ToothIcon,
  LockClosedIcon,
  ArrowUpTrayIcon,
  ArrowDownTrayIcon,
} from '@heroicons/react/24/solid'
import { cn } from '@/lib/shared/utils'
import { useBoardSelection, type BoardTab } from './use-board-selection'

const navItems: { label: string; tab: BoardTab; icon: typeof Cog6ToothIcon }[] = [
  { label: 'General', tab: 'general', icon: Cog6ToothIcon },
  { label: 'Access', tab: 'access', icon: LockClosedIcon },
  { label: 'Import Data', tab: 'import', icon: ArrowUpTrayIcon },
  { label: 'Export Data', tab: 'export', icon: ArrowDownTrayIcon },
]

export function BoardSettingsNav() {
  const { selectedTab, setSelectedTab } = useBoardSelection()

  return (
    <nav className="w-48 shrink-0">
      <div className="sticky top-6">
        <ul className="space-y-1">
          {navItems.map((item) => {
            const isActive = selectedTab === item.tab
            const Icon = item.icon

            return (
              <li key={item.tab}>
                <button
                  type="button"
                  onClick={() => setSelectedTab(item.tab)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                    isActive
                      ? 'bg-secondary text-foreground font-medium'
                      : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </nav>
  )
}
