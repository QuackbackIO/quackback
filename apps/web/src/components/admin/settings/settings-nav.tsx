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
  CreditCardIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  ArrowTopRightOnSquareIcon,
  KeyIcon,
  BoltIcon,
} from '@heroicons/react/24/solid'
import { cn } from '@/lib/shared/utils'

interface NavItem {
  label: string
  to: string
  icon: typeof Cog6ToothIcon
  /** Show only for cloud deployments */
  cloudOnly?: boolean
  /** Show only for self-hosted deployments */
  selfHostedOnly?: boolean
  /** If true, opens in new tab as external link */
  external?: boolean
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
      // Domains is now managed on the website
      {
        label: 'Domains',
        to: '__DOMAINS_EXTERNAL__',
        icon: GlobeAltIcon,
        cloudOnly: true,
        external: true,
      },
      // Billing is now managed on the website
      {
        label: 'Billing',
        to: '__BILLING_EXTERNAL__',
        icon: CreditCardIcon,
        cloudOnly: true,
        external: true,
      },
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

interface SettingsNavProps {
  isCloud: boolean
  workspaceId?: string
}

export function SettingsNav({ isCloud, workspaceId }: SettingsNavProps) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  // Filter sections based on deployment type (cloud vs self-hosted)
  const filteredSections = navSections.map((section) => ({
    ...section,
    items: section.items.filter(
      (item) => !(item.cloudOnly && !isCloud) && !(item.selfHostedOnly && isCloud)
    ),
  }))

  // Build external URLs with workspaceId
  const domainsUrl = workspaceId
    ? `https://www.quackback.io/workspaces/${workspaceId}/domains`
    : 'https://www.quackback.io/workspaces'
  const billingUrl = workspaceId
    ? `https://www.quackback.io/workspaces/${workspaceId}/billing`
    : 'https://www.quackback.io/workspaces'

  return (
    <div className="space-y-1">
      {filteredSections.map((section) => (
        <NavSection key={section.label} label={section.label}>
          {section.items.map((item) => {
            const isActive = pathname === item.to || pathname.startsWith(item.to + '/')
            const Icon = item.icon

            // Handle external links (domains, billing)
            if (item.external) {
              let href = item.to
              if (item.to === '__DOMAINS_EXTERNAL__') href = domainsUrl
              else if (item.to === '__BILLING_EXTERNAL__') href = billingUrl
              return (
                <a
                  key={item.to}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(
                    'flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors',
                    'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                  )}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate flex-1">{item.label}</span>
                  <ArrowTopRightOnSquareIcon className="h-3 w-3 shrink-0 opacity-50" />
                </a>
              )
            }

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
