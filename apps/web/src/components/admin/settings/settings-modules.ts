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
}

export interface SettingsModule {
  id: string
  label: string
  icon: ComponentType<{ className?: string }>
  pages: SettingsModulePage[]
}

function pathIsUnder(pathname: string, to: string): boolean {
  return pathname === to || pathname.startsWith(`${to}/`)
}

/** Product modules shown under Settings → Modules. Nested pages become content tabs. */
export function buildSettingsModules(flags?: Partial<FeatureFlags>): SettingsModule[] {
  const modules: SettingsModule[] = [
    {
      id: 'feedback',
      label: 'Feedback & Roadmaps',
      icon: ChatBubbleLeftIcon,
      pages: [
        { label: 'Boards', to: '/admin/settings/boards', icon: Squares2X2Icon },
        { label: 'Statuses', to: '/admin/settings/statuses', icon: Cog6ToothIcon },
        { label: 'Tags', to: '/admin/settings/tags', icon: TagIcon },
        { label: 'Moderation', to: '/admin/settings/moderation', icon: ShieldCheckIcon },
      ],
    },
  ]

  const supportPages: SettingsModulePage[] = []
  if (flags?.supportInbox) {
    supportPages.push({
      label: 'Channels',
      to: '/admin/settings/channels',
      icon: ChatBubbleLeftRightIcon,
    })
  } else if (isProductEnabled(flags, 'support')) {
    supportPages.push(
      { label: 'Email', to: '/admin/settings/channels/email', icon: EnvelopeIcon },
      { label: 'GitHub', to: '/admin/settings/channels/github', icon: GitHubIcon }
    )
  }
  if (isProductEnabled(flags, 'support')) {
    supportPages.push(
      { label: 'Macros', to: '/admin/settings/macros', icon: DocumentDuplicateIcon },
      { label: 'Office Hours', to: '/admin/settings/office-hours', icon: ClockIcon },
      { label: 'SLA policies', to: '/admin/settings/sla', icon: ShieldCheckIcon }
    )
  }
  if (flags?.supportTickets) {
    supportPages.push(
      { label: 'Ticket types', to: '/admin/settings/ticket-types', icon: TicketIcon },
      {
        label: 'Ticket statuses & stages',
        to: '/admin/settings/ticket-statuses',
        icon: QueueListIcon,
      }
    )
  }
  if (supportPages.length > 0) {
    modules.push({
      id: 'support',
      label: 'Support',
      icon: ChatBubbleLeftRightIcon,
      pages: supportPages,
    })
  }

  if (isProductEnabled(flags, 'helpCenter')) {
    modules.push({
      id: 'helpCenter',
      label: 'Help Center',
      icon: BookOpenIcon,
      pages: [{ label: 'Help Center', to: '/admin/settings/help-center', icon: BookOpenIcon }],
    })
  }

  if (isProductEnabled(flags, 'changelog')) {
    modules.push({
      id: 'changelog',
      label: 'Changelog',
      icon: MegaphoneIcon,
      pages: [{ label: 'Changelog', to: '/admin/settings/changelog', icon: MegaphoneIcon }],
    })
  }

  if (isProductEnabled(flags, 'status')) {
    modules.push({
      id: 'status',
      label: 'Status',
      icon: SignalIcon,
      pages: [{ label: 'Status', to: '/admin/settings/status', icon: SignalIcon }],
    })
  }

  return modules
}

export function settingsModuleForPath(
  pathname: string,
  modules: SettingsModule[]
): SettingsModule | undefined {
  return modules.find((module) => module.pages.some((page) => pathIsUnder(pathname, page.to)))
}
