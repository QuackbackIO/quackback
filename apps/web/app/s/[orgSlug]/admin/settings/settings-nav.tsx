'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Settings,
  Users,
  CreditCard,
  Layout,
  Shield,
  Lock,
  Brush,
  Plug2,
  Globe,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { toExternalPath } from '@/lib/tenant-paths'

const navSections = [
  {
    label: 'Organization',
    items: [
      { label: 'Team Members', href: '/admin/settings/team', icon: Users },
      { label: 'Integrations', href: '/admin/settings/integrations', icon: Plug2 },
      { label: 'Security', href: '/admin/settings/security', icon: Shield },
      { label: 'Domains', href: '/admin/settings/domains', icon: Globe },
      { label: 'Billing', href: '/admin/settings/billing', icon: CreditCard },
    ],
  },
  {
    label: 'Portal',
    items: [
      { label: 'Boards', href: '/admin/settings/boards', icon: Layout },
      { label: 'Branding', href: '/admin/settings/branding', icon: Brush },
      { label: 'Public Statuses', href: '/admin/settings/statuses', icon: Settings },
      { label: 'Authentication', href: '/admin/settings/portal-auth', icon: Lock },
    ],
  },
]

export function SettingsNav() {
  const rawPathname = usePathname()
  const pathname = toExternalPath(rawPathname)

  return (
    <nav className="w-56 shrink-0">
      <div className="sticky top-6 bg-card border border-border/50 rounded-lg p-4 shadow-sm space-y-5">
        {navSections.map((section) => (
          <div key={section.label}>
            <h3 className="font-semibold text-xs uppercase tracking-wider text-muted-foreground mb-2 px-3">
              {section.label}
            </h3>
            <ul className="space-y-0.5">
              {section.items.map((item) => {
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
        ))}
      </div>
    </nav>
  )
}
