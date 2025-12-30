'use client'

import { Link, useRouterState } from '@tanstack/react-router'
import { Settings, Users, Layout, Shield, Lock, Brush, Plug2, Globe } from 'lucide-react'
import { cn } from '@/lib/utils'

interface NavItem {
  label: string
  to: string
  icon: typeof Settings
  cloudOnly?: boolean
}

interface NavSection {
  label: string
  items: NavItem[]
}

const navSections: NavSection[] = [
  {
    label: 'Workspace',
    items: [
      { label: 'Team Members', to: '/admin/settings/team', icon: Users },
      { label: 'Integrations', to: '/admin/settings/integrations', icon: Plug2 },
      { label: 'Security', to: '/admin/settings/security', icon: Shield, cloudOnly: true },
      { label: 'Domains', to: '/admin/settings/domains', icon: Globe, cloudOnly: true },
    ],
  },
  {
    label: 'Portal',
    items: [
      { label: 'Boards', to: '/admin/settings/boards', icon: Layout },
      { label: 'Branding', to: '/admin/settings/branding', icon: Brush },
      { label: 'Public Statuses', to: '/admin/settings/statuses', icon: Settings },
      { label: 'Authentication', to: '/admin/settings/portal-auth', icon: Lock },
    ],
  },
]

interface SettingsNavProps {
  isCloud: boolean
}

export function SettingsNav({ isCloud }: SettingsNavProps) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  // Filter sections to remove cloud-only items when not in cloud mode
  const filteredSections = navSections.map((section) => ({
    ...section,
    items: section.items.filter((item) => !item.cloudOnly || isCloud),
  }))

  return (
    <nav className="w-56 shrink-0">
      <div className="sticky top-6 bg-card border border-border/50 rounded-lg p-4 shadow-sm space-y-5">
        {filteredSections.map((section) => (
          <div key={section.label}>
            <h3 className="font-semibold text-xs uppercase tracking-wider text-muted-foreground mb-2 px-3">
              {section.label}
            </h3>
            <ul className="space-y-0.5">
              {section.items.map((item) => {
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
        ))}
      </div>
    </nav>
  )
}
