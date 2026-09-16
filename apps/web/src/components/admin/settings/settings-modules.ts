import type { ComponentType } from 'react'
import {
  ChatBubbleLeftIcon,
  ChatBubbleLeftRightIcon,
  Cog6ToothIcon,
  Squares2X2Icon,
  ShieldCheckIcon,
  TagIcon,
  ClockIcon,
  BookOpenIcon,
  MegaphoneIcon,
  TicketIcon,
  QueueListIcon,
  EnvelopeIcon,
  DocumentDuplicateIcon,
  SignalIcon,
} from '@heroicons/react/24/solid'
import { GitHubIcon } from '@/components/icons/integration-icons'
import { isProductEnabled, type FeatureFlags } from '@/lib/shared/types'

export interface SettingsModulePage {
  label: string
  to: string
  icon: ComponentType<{ className?: string }>
  description?: string
}

export interface SettingsModule {
  id: string
  label: string
  icon: ComponentType<{ className?: string }>
  description: string
  /** Landing page when the module has several child pages (Channels-style card). */
  hubTo?: string
  pages: SettingsModulePage[]
}

function pathIsUnder(pathname: string, to: string): boolean {
  return pathname === to || pathname.startsWith(`${to}/`)
}

/** Product modules shown under Settings → Modules. Several pages land on a hub card. */
export function buildSettingsModules(flags?: Partial<FeatureFlags>): SettingsModule[] {
  const modules: SettingsModule[] = [
    {
      id: 'feedback',
      label: 'Feedback & Roadmaps',
      icon: ChatBubbleLeftIcon,
      description: 'Boards, statuses, tags, and moderation.',
      hubTo: '/admin/settings/feedback',
      pages: [
        {
          label: 'Boards',
          to: '/admin/settings/boards',
          icon: Squares2X2Icon,
          description: 'Where posts live',
        },
        {
          label: 'Statuses',
          to: '/admin/settings/statuses',
          icon: Cog6ToothIcon,
          description: 'The feedback pipeline',
        },
        {
          label: 'Tags',
          to: '/admin/settings/tags',
          icon: TagIcon,
          description: 'Labels for posts',
        },
        {
          label: 'Moderation',
          to: '/admin/settings/moderation',
          icon: ShieldCheckIcon,
          description: 'Approval and spam',
        },
      ],
    },
  ]

  const supportPages: SettingsModulePage[] = []
  if (flags?.supportInbox) {
    supportPages.push({
      label: 'Channels',
      to: '/admin/settings/channels',
      icon: ChatBubbleLeftRightIcon,
      description: 'Where conversations happen',
    })
  } else if (isProductEnabled(flags, 'support')) {
    supportPages.push(
      {
        label: 'Email',
        to: '/admin/settings/channels/email',
        icon: EnvelopeIcon,
        description: 'Inbound and outbound email',
      },
      {
        label: 'GitHub',
        to: '/admin/settings/channels/github',
        icon: GitHubIcon,
        description: 'Issues as conversations',
      }
    )
  }
  if (isProductEnabled(flags, 'support')) {
    supportPages.push(
      {
        label: 'Macros',
        to: '/admin/settings/macros',
        icon: DocumentDuplicateIcon,
        description: 'Saved replies',
      },
      {
        label: 'Office Hours',
        to: '/admin/settings/office-hours',
        icon: ClockIcon,
        description: 'When the team is available',
      },
      {
        label: 'SLA policies',
        to: '/admin/settings/sla',
        icon: ShieldCheckIcon,
        description: 'Response and resolution targets',
      }
    )
  }
  if (flags?.supportTickets) {
    supportPages.push(
      {
        label: 'Ticket types',
        to: '/admin/settings/ticket-types',
        icon: TicketIcon,
        description: 'Fields a ticket captures',
      },
      {
        label: 'Ticket statuses & stages',
        to: '/admin/settings/ticket-statuses',
        icon: QueueListIcon,
        description: 'The ticket pipeline',
      }
    )
  }
  if (supportPages.length > 0) {
    modules.push({
      id: 'support',
      label: 'Support',
      icon: ChatBubbleLeftRightIcon,
      description: 'Channels, macros, hours, and tickets.',
      hubTo: '/admin/settings/support',
      pages: supportPages,
    })
  }

  if (isProductEnabled(flags, 'helpCenter')) {
    modules.push({
      id: 'helpCenter',
      label: 'Help Center',
      icon: BookOpenIcon,
      description: 'Articles and categories.',
      pages: [{ label: 'Help Center', to: '/admin/settings/help-center', icon: BookOpenIcon }],
    })
  }

  if (isProductEnabled(flags, 'changelog')) {
    modules.push({
      id: 'changelog',
      label: 'Changelog',
      icon: MegaphoneIcon,
      description: 'Release notes.',
      pages: [{ label: 'Changelog', to: '/admin/settings/changelog', icon: MegaphoneIcon }],
    })
  }

  if (isProductEnabled(flags, 'status')) {
    modules.push({
      id: 'status',
      label: 'Status',
      icon: SignalIcon,
      description: 'Status page.',
      pages: [{ label: 'Status', to: '/admin/settings/status', icon: SignalIcon }],
    })
  }

  return modules
}

export function settingsModuleLandingPath(module: SettingsModule): string {
  return module.hubTo ?? module.pages[0]!.to
}

export function settingsModuleActivePaths(module: SettingsModule): string[] {
  return module.hubTo
    ? [module.hubTo, ...module.pages.map((page) => page.to)]
    : module.pages.map((page) => page.to)
}

export function settingsModuleForPath(
  pathname: string,
  modules: SettingsModule[]
): SettingsModule | undefined {
  return modules.find(
    (module) =>
      (module.hubTo && pathIsUnder(pathname, module.hubTo)) ||
      module.pages.some((page) => pathIsUnder(pathname, page.to))
  )
}
