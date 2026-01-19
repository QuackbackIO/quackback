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
  SparklesIcon,
} from '@heroicons/react/24/solid'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

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
      { label: 'Billing', to: '/admin/settings/billing', icon: CreditCardIcon, cloudOnly: true },
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
  hasEnterprise: boolean
}

export function SettingsNav({ isCloud, hasEnterprise }: SettingsNavProps) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  // Filter sections based on edition (enterprise items always shown with upgrade indicator)
  const filteredSections = navSections.map((section) => ({
    ...section,
    items: section.items.filter(
      (item) => !(item.cloudOnly && !isCloud) && !(item.selfHostedOnly && isCloud)
    ),
  }))

  return (
    <TooltipProvider>
      <div className="space-y-1">
        {filteredSections.map((section) => (
          <NavSection key={section.label} label={section.label}>
            {section.items.map((item) => {
              const isActive = pathname === item.to || pathname.startsWith(item.to + '/')
              const Icon = item.icon
              const isGated = item.enterpriseOnly && !hasEnterprise

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
                  {isGated && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <SparklesIcon className="h-3 w-3 text-amber-500 shrink-0" />
                      </TooltipTrigger>
                      <TooltipContent side="right">
                        <p>Enterprise feature</p>
                      </TooltipContent>
                    </Tooltip>
                  )}
                </Link>
              )
            })}
          </NavSection>
        ))}
      </div>
    </TooltipProvider>
  )
}
