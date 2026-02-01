import { useState } from 'react'
import { Link, useRouterState } from '@tanstack/react-router'
import {
  Cog6ToothIcon,
  UsersIcon,
  Squares2X2Icon,
  ShieldCheckIcon,
  LockClosedIcon,
  PaintBrushIcon,
  PuzzlePieceIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  KeyIcon,
  BoltIcon,
} from '@heroicons/react/24/solid'
import { cn } from '@/lib/shared/utils'

interface NavItem {
  label: string
  to: string
  icon: typeof Cog6ToothIcon
}

interface NavSection {
  label: string
  items: NavItem[]
}

const navSections: NavSection[] = [
  {
    label: 'Workspace',
    items: [
      { label: 'Team Members', to: '/admin/settings/team', icon: UsersIcon },
      { label: 'Integrations', to: '/admin/settings/integrations', icon: PuzzlePieceIcon },
      { label: 'Security', to: '/admin/settings/security', icon: ShieldCheckIcon },
    ],
  },
  {
    label: 'Portal',
    items: [
      { label: 'Boards', to: '/admin/settings/boards', icon: Squares2X2Icon },
      { label: 'Branding', to: '/admin/settings/branding', icon: PaintBrushIcon },
      { label: 'Statuses', to: '/admin/settings/statuses', icon: Cog6ToothIcon },
      { label: 'Authentication', to: '/admin/settings/portal-auth', icon: LockClosedIcon },
    ],
  },
  {
    label: 'Developers',
    items: [
      { label: 'API Keys', to: '/admin/settings/api-keys', icon: KeyIcon },
      { label: 'Webhooks', to: '/admin/settings/webhooks', icon: BoltIcon },
    ],
  },
]

function NavSection({
  label,
  children,
  defaultOpen = true,
}: {
  label: string
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen)

  return (
    <div className="pb-4 last:pb-0">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
      >
        {label}
        {isOpen ? <ChevronUpIcon className="h-3 w-3" /> : <ChevronDownIcon className="h-3 w-3" />}
      </button>
      {isOpen && <div className="mt-2 space-y-1">{children}</div>}
    </div>
  )
}

export function SettingsNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  return (
    <div className="space-y-1">
      {navSections.map((section) => (
        <NavSection key={section.label} label={section.label}>
          {section.items.map((item) => {
            const isActive = pathname === item.to || pathname.startsWith(item.to + '/')
            const Icon = item.icon

            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  'flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors',
                  isActive
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                )}
              >
                <Icon className={cn('h-3.5 w-3.5 shrink-0', isActive && 'text-primary')} />
                <span className="truncate flex-1">{item.label}</span>
              </Link>
            )
          })}
        </NavSection>
      ))}
    </div>
  )
}
