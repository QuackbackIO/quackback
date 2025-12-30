'use client'

import { Link, useRouterState } from '@tanstack/react-router'
import { User, Settings } from 'lucide-react'
import { cn } from '@/lib/utils'

const navItems = [
  { label: 'Profile', to: '/settings/profile', icon: User },
  { label: 'Preferences', to: '/settings/preferences', icon: Settings },
]

export function SettingsNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  return (
    <nav className="w-56 shrink-0">
      <div className="sticky top-6 bg-card border border-border/50 rounded-lg p-4 shadow-sm">
        <h3 className="font-semibold text-xs uppercase tracking-wider text-muted-foreground mb-2 px-3">
          Personal
        </h3>
        <ul className="space-y-0.5">
          {navItems.map((item) => {
            const isActive = pathname === item.to || pathname.startsWith(item.to + '/')
            const Icon = item.icon

            return (
              <li key={item.to}>
                <Link
                  to={item.to}
                  className={cn(
                    'flex items-center gap-2 px-3 py-1.5 rounded-full text-sm transition-colors',
                    isActive
                      ? 'bg-muted text-foreground font-medium'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                  )}
                >
                  <Icon className={cn('h-4 w-4 shrink-0', isActive && 'text-primary')} />
                  <span className="truncate">{item.label}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      </div>
    </nav>
  )
}
