'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { User, Settings, Users, CreditCard, Layout } from 'lucide-react'
import { cn } from '@/lib/utils'

const navSections = [
  {
    label: 'Personal',
    items: [
      { label: 'Profile', href: '/admin/settings/profile', icon: User },
      { label: 'Preferences', href: '/admin/settings/preferences', icon: Settings },
    ],
  },
  {
    label: 'Organization',
    items: [
      { label: 'Team Members', href: '/admin/settings/team', icon: Users },
      { label: 'Billing', href: '/admin/settings/billing', icon: CreditCard },
    ],
  },
  {
    label: 'Portal',
    items: [
      { label: 'Boards', href: '/admin/settings/boards', icon: Layout },
    ],
  },
]

export function SettingsNav() {
  const pathname = usePathname()

  return (
    <nav className="w-56 shrink-0">
      <div className="sticky top-6 space-y-6">
        {navSections.map((section) => (
          <div key={section.label}>
            <h3 className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {section.label}
            </h3>
            <ul className="space-y-1">
              {section.items.map((item) => {
                const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
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
        ))}
      </div>
    </nav>
  )
}
