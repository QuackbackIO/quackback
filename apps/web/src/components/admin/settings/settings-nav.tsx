import { useState, useMemo } from 'react'
import { Link, useRouterState, useRouteContext } from '@tanstack/react-router'
import {
  Cog6ToothIcon,
  UsersIcon,
  Squares2X2Icon,
  LockClosedIcon,
  PaintBrushIcon,
  PuzzlePieceIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  KeyIcon,
  BoltIcon,
  CommandLineIcon,
  ChatBubbleLeftRightIcon,
  AdjustmentsHorizontalIcon,
  ShieldCheckIcon,
  BeakerIcon,
  BookOpenIcon,
  TagIcon,
} from '@heroicons/react/24/solid'
import { cn } from '@/lib/shared/utils'
import type { FeatureFlags } from '@/lib/server/domains/settings/settings.types'

interface NavItem {
  label: string
  to: string
  icon: typeof Cog6ToothIcon
}

interface NavSection {
  label: string
  items: NavItem[]
}

export function buildNavSections(flags?: { helpCenter?: boolean }): NavSection[] {
  const sections: NavSection[] = [
    {
      label: 'General',
      items: [
        { label: 'Team Members', to: '/admin/settings/team', icon: UsersIcon },
        { label: 'Integrations', to: '/admin/settings/integrations', icon: PuzzlePieceIcon },
      ],
    },
    {
      label: 'Customization',
      items: [
        { label: 'Branding', to: '/admin/settings/branding', icon: PaintBrushIcon },
        { label: 'Widget', to: '/admin/settings/portal-widget', icon: ChatBubbleLeftRightIcon },
      ],
    },
    {
      label: 'Feedback',
      items: [
        { label: 'Boards', to: '/admin/settings/boards', icon: Squares2X2Icon },
        { label: 'Statuses', to: '/admin/settings/statuses', icon: Cog6ToothIcon },
        { label: 'Tags', to: '/admin/settings/tags', icon: TagIcon },
        { label: 'Permissions', to: '/admin/settings/permissions', icon: ShieldCheckIcon },
      ],
    },
  ]

  if (flags?.helpCenter) {
    sections.push({
      label: 'Help Center',
      items: [{ label: 'Help Center', to: '/admin/settings/help-center', icon: BookOpenIcon }],
    })
  }

  sections.push(
    {
      label: 'End Users',
      items: [
        { label: 'Authentication', to: '/admin/settings/portal-auth', icon: LockClosedIcon },
        {
          label: 'User Attributes',
          to: '/admin/settings/user-attributes',
          icon: AdjustmentsHorizontalIcon,
        },
      ],
    },
    {
      label: 'Developers',
      items: [
        { label: 'API Keys', to: '/admin/settings/api-keys', icon: KeyIcon },
        { label: 'Webhooks', to: '/admin/settings/webhooks', icon: BoltIcon },
        { label: 'MCP Server', to: '/admin/settings/mcp', icon: CommandLineIcon },
        { label: 'Experimental', to: '/admin/settings/experimental', icon: BeakerIcon },
      ],
    }
  )

  return sections
}

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
        className="flex w-full items-center justify-between px-2.5 py-1 text-xs font-normal text-muted-foreground/80 hover:text-foreground transition-colors"
      >
        {label}
        {isOpen ? <ChevronUpIcon className="h-3 w-3" /> : <ChevronDownIcon className="h-3 w-3" />}
      </button>
      {isOpen && <div className="mt-2 space-y-1">{children}</div>}
    </div>
  )
}

export function SettingsNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const { settings } = useRouteContext({ from: '__root__' })
  const flags = settings?.featureFlags as FeatureFlags | undefined

  const navSections = useMemo(() => buildNavSections(flags), [flags])

  return (
    <div className="space-y-1">
      {navSections.map((section) => (
        <NavSection key={section.label} label={section.label}>
          {section.items.map((item) => {
            const isActive = pathname === item.to || pathname.startsWith(item.to + '/')
            const Icon = item.icon

            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  'flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-colors',
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
