import type { ComponentType } from 'react'
import {
  ArrowDownTrayIcon,
  BeakerIcon,
  BellIcon,
  BoltIcon,
  BookOpenIcon,
  BuildingOfficeIcon,
  ChatBubbleLeftIcon,
  ChatBubbleLeftRightIcon,
  ClockIcon,
  CodeBracketIcon,
  Cog6ToothIcon,
  CommandLineIcon,
  CreditCardIcon,
  DocumentDuplicateIcon,
  EnvelopeIcon,
  FlagIcon,
  GlobeAltIcon,
  LinkIcon,
  MegaphoneIcon,
  PuzzlePieceIcon,
  ShieldCheckIcon,
  SignalIcon,
  SparklesIcon,
  Squares2X2Icon,
  TagIcon,
  TicketIcon,
  UserGroupIcon,
  UsersIcon,
} from '@heroicons/react/24/solid'
import { GitHubIcon } from '@/components/icons/integration-icons'
import type { AiPagePath, SettingsPagePath } from './settings-pages'

/**
 * The icon of each settings page, keyed like the label registry in
 * settings-pages.ts. Only the settings nav and module lists import it.
 */
export const SETTINGS_PAGE_ICONS: Record<
  SettingsPagePath,
  ComponentType<{ className?: string }>
> = {
  '/admin/settings/feedback': ChatBubbleLeftIcon,
  '/admin/settings/support': ChatBubbleLeftRightIcon,
  '/admin/settings/boards': Squares2X2Icon,
  '/admin/settings/statuses': FlagIcon,
  '/admin/settings/tags': TagIcon,
  '/admin/settings/moderation': ShieldCheckIcon,
  '/admin/settings/channels': ChatBubbleLeftRightIcon,
  '/admin/settings/channels/messenger': ChatBubbleLeftRightIcon,
  '/admin/settings/channels/email': EnvelopeIcon,
  '/admin/settings/channels/github': GitHubIcon,
  '/admin/settings/macros': DocumentDuplicateIcon,
  '/admin/settings/who-answers': UserGroupIcon,
  '/admin/settings/hours-sla': ClockIcon,
  '/admin/settings/tickets': TicketIcon,
  '/admin/settings/fields': TagIcon,
  '/admin/settings/help-center': BookOpenIcon,
  '/admin/settings/changelog': MegaphoneIcon,
  '/admin/settings/status': SignalIcon,
  '/admin/settings/general': Cog6ToothIcon,
  '/admin/settings/domains': GlobeAltIcon,
  '/admin/settings/notifications': BellIcon,
  '/admin/settings/portal': GlobeAltIcon,
  '/admin/settings/widget': ChatBubbleLeftRightIcon,
  '/admin/settings/widget/install': CodeBracketIcon,
  '/admin/settings/members': UsersIcon,
  '/admin/settings/security/authentication': ShieldCheckIcon,
  '/admin/settings/agents': CommandLineIcon,
  '/admin/settings/agents/assistants': CommandLineIcon,
  '/admin/settings/agents/keys': CommandLineIcon,
  '/admin/settings/agents/webhooks': CommandLineIcon,
  '/admin/settings/labs': BeakerIcon,
  '/admin/settings/integrations': PuzzlePieceIcon,
  '/admin/settings/billing': CreditCardIcon,
  '/admin/settings/people': UserGroupIcon,
  '/admin/settings/companies': BuildingOfficeIcon,
  '/admin/settings/imports': ArrowDownTrayIcon,
}

/** The icon of each page whose label is a message. */
export const AI_PAGE_ICONS: Record<AiPagePath, ComponentType<{ className?: string }>> = {
  '/admin/settings/ai': SparklesIcon,
  '/admin/settings/ai/customers': SparklesIcon,
  '/admin/settings/ai/teammates': UserGroupIcon,
  '/admin/settings/ai/knowledge': BookOpenIcon,
  '/admin/settings/ai/guidance': BookOpenIcon,
  '/admin/settings/ai/actions': LinkIcon,
  '/admin/settings/workflows': BoltIcon,
}

/** The icon of every page the nav and the module tabs can name. */
export const PAGE_ICONS: Record<
  SettingsPagePath | AiPagePath,
  ComponentType<{ className?: string }>
> = { ...SETTINGS_PAGE_ICONS, ...AI_PAGE_ICONS }
