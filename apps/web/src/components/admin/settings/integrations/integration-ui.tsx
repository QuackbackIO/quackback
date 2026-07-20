/**
 * Integration UI manifest (IF WO-5). ONE client-side source of truth for
 * per-provider presentation metadata — icon, display name, the close/archive
 * verb + item noun for tracker cleanup copy, external-id formatting, and the
 * source-badge color. Replaces the scattered `lib/shared/integrations.ts`
 * switches, the provider half of `source-type-icon.tsx`'s color/label maps,
 * and the inline `integrationType === 'github'` id-formatting special case.
 *
 * (Icons still live in `integration-icons.tsx`; per-provider colocation of
 * this metadata into `<provider>/manifest.tsx` happens in WO-11.)
 */
import type { ComponentType } from 'react'
import {
  AsanaIcon,
  AzureDevOpsIcon,
  ClickUpIcon,
  DiscordIcon,
  FreshdeskIcon,
  GitHubIcon,
  GitLabIcon,
  HubSpotIcon,
  IntercomIcon,
  JiraIcon,
  LinearIcon,
  MakeIcon,
  MondayIcon,
  N8nIcon,
  NotionIcon,
  NtfyIcon,
  SalesforceIcon,
  ShortcutIcon,
  SlackIcon,
  StripeIcon,
  TeamsIcon,
  TrelloIcon,
  ZapierIcon,
  ZendeskIcon,
} from '@/components/icons/integration-icons'

interface IconProps {
  className?: string
}

export interface IntegrationUiManifest {
  /** Provider brand icon (component). */
  icon: ComponentType<IconProps>
  /** Human-readable display name. */
  displayName: string
  /** Verb for the linked-item cleanup action, when this provider is a tracker. */
  actionVerb?: 'Close' | 'Archive'
  /** Noun for the linked external item (issue/task/story/…), when a tracker. */
  itemNoun?: string
  /** Render an external id for display (e.g. GitHub issue → "#42"). */
  formatExternalId?: (externalId: string) => string
  /** Source-badge background/text classes, when this provider appears as a feedback source. */
  badge?: string
}

/** The manifest registry, keyed by integration id. */
export const INTEGRATION_UI: Record<string, IntegrationUiManifest> = {
  asana: {
    icon: AsanaIcon,
    displayName: 'Asana',
    actionVerb: 'Archive',
    itemNoun: 'task',
    badge: 'bg-rose-100 dark:bg-rose-900/80 text-[#F06A6A] dark:text-[#F5A3A3]',
  },
  azure_devops: {
    icon: AzureDevOpsIcon,
    displayName: 'Azure DevOps',
    actionVerb: 'Close',
    itemNoun: 'work item',
  },
  clickup: {
    icon: ClickUpIcon,
    displayName: 'ClickUp',
    actionVerb: 'Close',
    itemNoun: 'task',
  },
  discord: {
    icon: DiscordIcon,
    displayName: 'Discord',
    badge: 'bg-indigo-100 dark:bg-indigo-900/80 text-[#5865F2] dark:text-[#99A1F7]',
  },
  freshdesk: {
    icon: FreshdeskIcon,
    displayName: 'Freshdesk',
    badge: 'bg-emerald-100 dark:bg-emerald-900/80 text-emerald-600 dark:text-emerald-400',
  },
  github: {
    icon: GitHubIcon,
    displayName: 'GitHub',
    actionVerb: 'Close',
    itemNoun: 'issue',
    formatExternalId: (id) => `#${id}`,
    badge: 'bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300',
  },
  gitlab: {
    icon: GitLabIcon,
    displayName: 'GitLab',
    actionVerb: 'Close',
    itemNoun: 'issue',
    badge: 'bg-orange-100 dark:bg-orange-900/80 text-[#FC6D26] dark:text-[#FEA876]',
  },
  hubspot: {
    icon: HubSpotIcon,
    displayName: 'HubSpot',
    badge: 'bg-orange-100 dark:bg-orange-900/80 text-[#FF7A59] dark:text-[#FFB199]',
  },
  intercom: {
    icon: IntercomIcon,
    displayName: 'Intercom',
    badge: 'bg-blue-100 dark:bg-blue-900/80 text-[#286EFA] dark:text-[#7DAAFC]',
  },
  jira: {
    icon: JiraIcon,
    displayName: 'Jira',
    actionVerb: 'Close',
    itemNoun: 'issue',
    badge: 'bg-blue-100 dark:bg-blue-900/80 text-[#0052CC] dark:text-[#669EFF]',
  },
  linear: {
    icon: LinearIcon,
    displayName: 'Linear',
    actionVerb: 'Archive',
    itemNoun: 'issue',
    badge: 'bg-violet-100 dark:bg-violet-900/80 text-[#5E6AD2] dark:text-[#9B9FE8]',
  },
  make: { icon: MakeIcon, displayName: 'Make' },
  monday: {
    icon: MondayIcon,
    displayName: 'Monday',
    actionVerb: 'Archive',
    itemNoun: 'item',
    badge: 'bg-yellow-100 dark:bg-yellow-900/80 text-[#FFCC00] dark:text-[#FFE066]',
  },
  n8n: { icon: N8nIcon, displayName: 'n8n' },
  notion: {
    icon: NotionIcon,
    displayName: 'Notion',
    actionVerb: 'Archive',
    itemNoun: 'page',
    badge: 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300',
  },
  ntfy: { icon: NtfyIcon, displayName: 'ntfy' },
  salesforce: {
    icon: SalesforceIcon,
    displayName: 'Salesforce',
    badge: 'bg-sky-100 dark:bg-sky-900/80 text-sky-600 dark:text-sky-400',
  },
  shortcut: {
    icon: ShortcutIcon,
    displayName: 'Shortcut',
    actionVerb: 'Archive',
    itemNoun: 'story',
  },
  slack: {
    icon: SlackIcon,
    displayName: 'Slack',
    badge: 'bg-[#f3e5f5] dark:bg-[#2d1230] text-[#611f69] dark:text-[#E8B4E9]',
  },
  stripe: {
    icon: StripeIcon,
    displayName: 'Stripe',
    badge: 'bg-purple-100 dark:bg-purple-900/80 text-[#635BFF] dark:text-[#A29BFE]',
  },
  teams: {
    icon: TeamsIcon,
    displayName: 'Microsoft Teams',
    badge: 'bg-indigo-100 dark:bg-indigo-900/80 text-[#6264A7] dark:text-[#9B9DD4]',
  },
  trello: {
    icon: TrelloIcon,
    displayName: 'Trello',
    actionVerb: 'Archive',
    itemNoun: 'task',
  },
  zapier: { icon: ZapierIcon, displayName: 'Zapier' },
  zendesk: {
    icon: ZendeskIcon,
    displayName: 'Zendesk',
    badge: 'bg-[#e0f2f1] dark:bg-[#0a2528] text-[#03363D] dark:text-[#78B8C1]',
  },
}

/** Look up a provider's icon component, if registered. */
export function getIntegrationIcon(type: string): ComponentType<IconProps> | undefined {
  return INTEGRATION_UI[type]?.icon
}

/** Human-readable display name for an integration type (falls back to the raw id). */
export function getIntegrationDisplayName(type: string): string {
  return INTEGRATION_UI[type]?.displayName ?? type
}

/** Cleanup action verb (Close vs Archive) for a tracker; defaults to Archive. */
export function getIntegrationActionVerb(type: string): string {
  return INTEGRATION_UI[type]?.actionVerb ?? 'Archive'
}

/** Item noun (issue/task/story/…) for a tracker; defaults to issue. */
export function getIntegrationItemNoun(type: string): string {
  return INTEGRATION_UI[type]?.itemNoun ?? 'issue'
}

/** Format an external id for display (e.g. GitHub → "#42"); identity by default. */
export function formatExternalId(type: string, externalId: string): string {
  return INTEGRATION_UI[type]?.formatExternalId?.(externalId) ?? externalId
}
