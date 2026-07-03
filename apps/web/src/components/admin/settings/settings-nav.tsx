import { useMemo } from 'react'
import { Link, useRouterState, useRouteContext } from '@tanstack/react-router'
import {
  Cog6ToothIcon,
  UsersIcon,
  UserGroupIcon,
  Squares2X2Icon,
  PaintBrushIcon,
  PuzzlePieceIcon,
  ChatBubbleLeftRightIcon,
  ClockIcon,
  CommandLineIcon,
  ShieldCheckIcon,
  DocumentTextIcon,
  BeakerIcon,
  BookOpenIcon,
  TagIcon,
  MegaphoneIcon,
  SparklesIcon,
  TicketIcon,
  QueueListIcon,
} from '@heroicons/react/24/solid'
import { FilterSection } from '@/components/shared/filter-section'
import { cn } from '@/lib/shared/utils'
import type { FeatureFlags } from '@/lib/shared/types'

interface NavItem {
  label: string
  to: string
  icon: typeof Cog6ToothIcon
}

interface NavSection {
  label: string
  items: NavItem[]
}

export function buildNavSections(flags?: {
  helpCenter?: boolean
  supportInbox?: boolean
  supportTickets?: boolean
}): NavSection[] {
  const sections: NavSection[] = [
    {
      label: 'Administration',
      items: [
        { label: 'Members', to: '/admin/settings/team', icon: UsersIcon },
        { label: 'Integrations', to: '/admin/settings/integrations', icon: PuzzlePieceIcon },
        {
          label: 'Security',
          to: '/admin/settings/security/authentication',
          icon: ShieldCheckIcon,
        },
        {
          label: 'Audit log',
          to: '/admin/settings/security/audit-log',
          icon: DocumentTextIcon,
        },
        { label: 'Developers', to: '/admin/settings/developers', icon: CommandLineIcon },
        { label: 'Labs', to: '/admin/settings/labs', icon: BeakerIcon },
      ],
    },
    {
      label: 'Customization',
      items: [
        { label: 'Branding', to: '/admin/settings/branding', icon: PaintBrushIcon },
        { label: 'Portal', to: '/admin/settings/portal', icon: MegaphoneIcon },
        { label: 'Widget', to: '/admin/settings/widget', icon: ChatBubbleLeftRightIcon },
      ],
    },
    {
      label: 'Feedback',
      items: [
        { label: 'Boards', to: '/admin/settings/boards', icon: Squares2X2Icon },
        { label: 'Statuses', to: '/admin/settings/statuses', icon: Cog6ToothIcon },
        { label: 'Tags', to: '/admin/settings/tags', icon: TagIcon },
        { label: 'Moderation', to: '/admin/settings/moderation', icon: ShieldCheckIcon },
      ],
    },
  ]

  // Support — conversations, ticket config, and Help Center, each gated on its own flag.
  const supportItems: NavItem[] = [
    ...(flags?.supportInbox
      ? [
          {
            label: 'Conversations',
            to: '/admin/settings/conversations',
            icon: ChatBubbleLeftRightIcon,
          },
          {
            label: 'Office Hours',
            to: '/admin/settings/office-hours',
            icon: ClockIcon,
          },
          { label: 'Teams', to: '/admin/settings/teams', icon: UserGroupIcon },
        ]
      : []),
    ...(flags?.supportTickets
      ? [
          { label: 'Ticket types', to: '/admin/settings/ticket-types', icon: TicketIcon },
          {
            label: 'Statuses and stages',
            to: '/admin/settings/ticket-statuses',
            icon: QueueListIcon,
          },
        ]
      : []),
    ...(flags?.helpCenter
      ? [{ label: 'Help Center', to: '/admin/settings/help-center', icon: BookOpenIcon }]
      : []),
  ]
  if (supportItems.length > 0) {
    sections.push({ label: 'Support', items: supportItems })
  }

  sections.push({
    label: 'AI & Automation',
    items: [
      { label: 'Assistant', to: '/admin/settings/ai', icon: SparklesIcon },
      { label: 'Sandbox', to: '/admin/settings/ai/sandbox', icon: BeakerIcon },
    ],
  })

  sections.push({
    label: 'Customers',
    items: [{ label: 'People', to: '/admin/settings/people', icon: UserGroupIcon }],
  })

  return sections
}

export function SettingsNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const { settings } = useRouteContext({ from: '__root__' })
  const flags = settings?.featureFlags as FeatureFlags | undefined

  const navSections = useMemo(() => buildNavSections(flags), [flags])

  return (
    <div className="space-y-1">
      {navSections.map((section) => (
        <FilterSection key={section.label} title={section.label}>
          <div className="space-y-1">
            {section.items.map((item) => {
              const isActive = pathname === item.to || pathname.startsWith(item.to + '/')
              const Icon = item.icon

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
          </div>
        </FilterSection>
      ))}
    </div>
  )
}
