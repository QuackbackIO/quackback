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
  GlobeAltIcon,
  KeyIcon,
  ChevronUpIcon,
  ChevronDownIcon,
} from '@heroicons/react/24/solid'
import { cn } from '@/lib/utils'

interface NavItem {
  label: string
  to: string
  icon: typeof Cog6ToothIcon
  /** Show only for cloud deployments */
  cloudOnly?: boolean
  /** Show only for self-hosted deployments */
  selfHostedOnly?: boolean
  /** Show only for enterprise tier (cloud subscription or self-hosted with license) */
  enterpriseOnly?: boolean
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
      { label: 'License', to: '/admin/settings/license', icon: KeyIcon, selfHostedOnly: true },
      {
        label: 'Security',
        to: '/admin/settings/security',
        icon: ShieldCheckIcon,
        enterpriseOnly: true,
      },
      { label: 'Domains', to: '/admin/settings/domains', icon: GlobeAltIcon, cloudOnly: true },
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
    <div className="pb-5 last:pb-0">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
      >
        {label}
        {isOpen ? <ChevronUpIcon className="h-4 w-4" /> : <ChevronDownIcon className="h-4 w-4" />}
      </button>
      {isOpen && <div className="mt-2 space-y-1">{children}</div>}
    </div>
  )
}

interface SettingsNavProps {
  isCloud: boolean
  hasEnterprise: boolean
}

export function SettingsNav({ isCloud, hasEnterprise }: SettingsNavProps) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  // Filter sections based on edition and tier
  const filteredSections = navSections.map((section) => ({
    ...section,
    items: section.items.filter((item) => {
      // Cloud-only items hidden for self-hosted
      if (item.cloudOnly && !isCloud) return false
      // Self-hosted-only items hidden for cloud
      if (item.selfHostedOnly && isCloud) return false
      // Enterprise-only items hidden without enterprise access
      if (item.enterpriseOnly && !hasEnterprise) return false
      return true
    }),
  }))

  return (
    <div className="space-y-1">
      {filteredSections.map((section) => (
        <NavSection key={section.label} label={section.label}>
          {section.items.map((item) => {
            const isActive = pathname === item.to || pathname.startsWith(item.to + '/')
            const Icon = item.icon

            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors',
                  isActive
                    ? 'bg-muted text-foreground font-medium'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                )}
              >
                <Icon className={cn('h-4 w-4 shrink-0', isActive && 'text-primary')} />
                <span className="truncate">{item.label}</span>
              </Link>
            )
          })}
        </NavSection>
      ))}
    </div>
  )
}
