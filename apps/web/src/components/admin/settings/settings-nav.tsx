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
  CommandLineIcon,
  ShieldCheckIcon,
  DocumentTextIcon,
  BeakerIcon,
  BookOpenIcon,
  TagIcon,
  InboxStackIcon,
  ArrowsRightLeftIcon,
  ClockIcon,
  ShieldExclamationIcon,
  MegaphoneIcon,
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
          to: '/admin/settings/audit',
          icon: DocumentTextIcon,
        },
        { label: 'Developers', to: '/admin/settings/developers', icon: CommandLineIcon },
        { label: 'Labs', to: '/admin/settings/labs', icon: BeakerIcon },
      ],
    },
    {
      label: 'Workspace',
      items: [
        { label: 'Inboxes', to: '/admin/settings/inboxes', icon: InboxStackIcon },
        { label: 'Teams', to: '/admin/settings/teams', icon: UserGroupIcon },
        {
          label: 'Routing rules',
          to: '/admin/settings/routing-rules',
          icon: ArrowsRightLeftIcon,
        },
      ],
    },
    {
      label: 'SLA',
      items: [
        {
          label: 'Business hours',
          to: '/admin/settings/business-hours',
          icon: ClockIcon,
        },
        { label: 'SLA policies', to: '/admin/settings/sla', icon: ShieldExclamationIcon },
      ],
    },
    {
      label: 'Security',
      items: [{ label: 'Roles & permissions', to: '/admin/settings/roles', icon: ShieldCheckIcon }],
    },
    {
      label: 'Customization',
      items: [
        { label: 'Branding', to: '/admin/settings/branding', icon: PaintBrushIcon },
        { label: 'Portal', to: '/admin/settings/portal', icon: MegaphoneIcon },
        { label: 'Portal Tabs', to: '/admin/settings/portal-tabs', icon: Squares2X2Icon },
        {
          label: 'Changelog Visibility',
          to: '/admin/settings/changelog-visibility',
          icon: DocumentTextIcon,
        },
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

  // Support — Conversations + Help Center bundled together, each gated on its own flag.
  const supportItems: NavItem[] = [
    ...(flags?.supportInbox
      ? [
          {
            label: 'Conversations',
            to: '/admin/settings/conversations',
            icon: ChatBubbleLeftRightIcon,
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

  // Customers — entry point to the CRM people directory. Always present and
  // anchored last (after Support), so customer management is reachable from
  // settings regardless of which support flags are on.
  sections.push({
    label: 'Customers',
    items: [{ label: 'People', to: '/admin/customers/people', icon: UsersIcon }],
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
