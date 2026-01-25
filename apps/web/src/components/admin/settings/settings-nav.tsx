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
  CreditCardIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  ArrowTopRightOnSquareIcon,
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
      { label: 'License', to: '/admin/settings/license', icon: KeyIcon, selfHostedOnly: true },
      {
        label: 'Security',
        to: '/admin/settings/security',
        icon: ShieldCheckIcon,
        enterpriseOnly: true,
      },
      { label: 'Domains', to: '/admin/settings/domains', icon: GlobeAltIcon, cloudOnly: true },
      // Billing is now managed on the website - link will be replaced with external URL
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

  // Filter sections based on edition (enterprise items always shown with upgrade indicator)
  const filteredSections = navSections.map((section) => ({
    ...section,
    items: section.items.filter(
      (item) => !(item.cloudOnly && !isCloud) && !(item.selfHostedOnly && isCloud)
    ),
  }))

  // Build external billing URL with workspaceId
  const billingUrl = workspaceId
    ? `https://quackback.io/billing?workspace=${workspaceId}`
    : 'https://quackback.io/billing'

  return (
    <div className="space-y-1">
      {filteredSections.map((section) => (
        <NavSection key={section.label} label={section.label}>
          {section.items.map((item) => {
            const isActive = pathname === item.to || pathname.startsWith(item.to + '/')
            const Icon = item.icon

            // Handle external billing link
            if (item.external) {
              const href = item.to === '__BILLING_EXTERNAL__' ? billingUrl : item.to
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
