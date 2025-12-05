'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { User, Settings } from 'lucide-react'
import { cn } from '@/lib/utils'

const navItems = [
  { label: 'Profile', href: '/settings/profile', icon: User },
  { label: 'Preferences', href: '/settings/preferences', icon: Settings },
]

export function SettingsNav() {
  const pathname = usePathname()

  return (
    <nav className="w-56 shrink-0">
      <div className="sticky top-6 bg-card border border-border/50 rounded-lg p-4 shadow-sm">
        <h3 className="font-semibold text-xs uppercase tracking-wider text-muted-foreground mb-2 px-3">
          Personal
        </h3>
        <ul className="space-y-0.5">
          {navItems.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
            const Icon = item.icon

            return (
              <li key={item.href}>
                <Link
                  href={item.href}
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
