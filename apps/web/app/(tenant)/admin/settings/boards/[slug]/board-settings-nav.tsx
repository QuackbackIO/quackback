'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Settings, Globe, Upload, Download } from 'lucide-react'
import { cn } from '@/lib/utils'

interface BoardSettingsNavProps {
  boardSlug: string
}

export function BoardSettingsNav({ boardSlug }: BoardSettingsNavProps) {
  const pathname = usePathname()
  const basePath = `/admin/settings/boards/${boardSlug}`

  const navItems = [
    { label: 'General', href: basePath, icon: Settings },
    { label: 'Public Portal', href: `${basePath}/public`, icon: Globe },
    { label: 'Import Data', href: `${basePath}/import`, icon: Upload },
    { label: 'Export Data', href: `${basePath}/export`, icon: Download },
  ]

  return (
    <nav className="w-48 shrink-0">
      <div className="sticky top-6">
        <ul className="space-y-1">
          {navItems.map((item) => {
            const isActive = pathname === item.href
            const Icon = item.icon

            return (
              <li key={item.href}>
                <Link
                  href={item.href}
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
