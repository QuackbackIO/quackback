'use client'

import { Link, useRouterState } from '@tanstack/react-router'
import { Settings, Lock, Upload, Download } from 'lucide-react'
import { cn } from '@/lib/utils'

interface BoardSettingsNavProps {
  boardSlug: string
}

export function BoardSettingsNav({ boardSlug }: BoardSettingsNavProps) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const basePath = `/admin/settings/boards/${boardSlug}`

  const navItems = [
    { label: 'General', to: basePath, icon: Settings },
    { label: 'Access', to: `${basePath}/access`, icon: Lock },
    { label: 'Import Data', to: `${basePath}/import`, icon: Upload },
    { label: 'Export Data', to: `${basePath}/export`, icon: Download },
  ]

  return (
    <nav className="w-48 shrink-0">
      <div className="sticky top-6">
        <ul className="space-y-1">
          {navItems.map((item) => {
            const isActive = pathname === item.to
            const Icon = item.icon

            return (
              <li key={item.to}>
                <Link
                  to={item.to}
                  className={cn(
                    'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                    isActive
                      ? 'bg-secondary text-foreground font-medium'
                      : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Link>
              </li>
            )
          })}
        </ul>
      </div>
    </nav>
  )
}
