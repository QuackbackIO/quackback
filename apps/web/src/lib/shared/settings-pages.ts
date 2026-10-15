import { defineMessages } from 'react-intl'

interface SettingsPageEntry {
  label: string
}

/**
 * The single registry of settings page labels. The settings nav, the module
 * lists and every page title read from here, so a nav label and the title of
 * the page it opens cannot differ. Keys are the page paths. It imports no
 * icons, so a label lookup does not pull the icon set into its chunk; the nav
 * takes icons from settings-page-icons.ts.
 */
export const SETTINGS_PAGES = {
  // Modules
  '/admin/settings/feedback': { label: 'Feedback & Roadmaps' },
  '/admin/settings/support': { label: 'Support' },
  // Feedback & Roadmaps
  '/admin/settings/boards': { label: 'Boards' },
  '/admin/settings/statuses': { label: 'Statuses' },
  '/admin/settings/tags': { label: 'Tags' },
  '/admin/settings/moderation': { label: 'Moderation' },
  // Support
  '/admin/settings/channels': { label: 'Channels' },
  '/admin/settings/channels/messenger': { label: 'Messenger' },
  '/admin/settings/channels/email': { label: 'Email' },
  '/admin/settings/channels/github': { label: 'GitHub' },
  '/admin/settings/who-answers': { label: 'Who answers' },
  '/admin/settings/macros': { label: 'Macros' },
  '/admin/settings/hours-sla': { label: 'Hours & SLAs' },
  '/admin/settings/tickets': { label: 'Tickets' },
  '/admin/settings/fields': { label: 'Fields & tags' },
  // Other product modules
  '/admin/settings/help-center': { label: 'Help Center' },
  '/admin/settings/changelog': { label: 'Changelog' },
  '/admin/settings/status': { label: 'Status' },
  // Workspace
  '/admin/settings/general': { label: 'General' },
  '/admin/settings/domains': { label: 'Domains' },
  '/admin/settings/notifications': { label: 'Notifications' },
  '/admin/settings/portal': { label: 'Portal' },
  '/admin/settings/widget': { label: 'Widget' },
  '/admin/settings/widget/install': { label: 'Install' },
  '/admin/settings/members': { label: 'Members & Teams' },
  '/admin/settings/security/authentication': { label: 'Access & Security' },
  '/admin/settings/agents': { label: 'Agents & API' },
  '/admin/settings/agents/assistants': { label: 'Assistants' },
  '/admin/settings/agents/keys': { label: 'API keys' },
  '/admin/settings/agents/webhooks': { label: 'Webhooks' },
  '/admin/settings/labs': { label: 'Labs' },
  '/admin/settings/integrations': { label: 'Integrations' },
  '/admin/settings/billing': { label: 'Plan & billing' },
  // Data
  '/admin/settings/people': { label: 'Users' },
  '/admin/settings/companies': { label: 'Companies' },
  '/admin/settings/imports': { label: 'Imports & exports' },
} as const satisfies Record<string, SettingsPageEntry>

export type SettingsPagePath = keyof typeof SETTINGS_PAGES

const aiMessages = defineMessages({
  module: { id: 'automation.nav.group.quinn', defaultMessage: 'Quackback AI' },
  customers: { id: 'ai.nav.customers', defaultMessage: 'Customers' },
  teammates: { id: 'ai.nav.teammates', defaultMessage: 'Teammates' },
  knowledge: { id: 'automation.agent.tabs.knowledge', defaultMessage: 'Knowledge' },
  guidance: { id: 'automation.agent.tabs.guidance', defaultMessage: 'Guidance' },
  actions: { id: 'automation.agent.tabs.actions', defaultMessage: 'Actions' },
  workflows: { id: 'automation.nav.workflows', defaultMessage: 'Workflows' },
})

/**
 * The settings pages whose labels are messages, so the page title is
 * translated: the Quackback AI module and its pages, and Workflows. The
 * settings nav shows each message's default text.
 */
export const AI_PAGES = {
  '/admin/settings/ai': aiMessages.module,
  '/admin/settings/ai/customers': aiMessages.customers,
  '/admin/settings/ai/teammates': aiMessages.teammates,
  '/admin/settings/ai/knowledge': aiMessages.knowledge,
  '/admin/settings/ai/guidance': aiMessages.guidance,
  '/admin/settings/ai/actions': aiMessages.actions,
  '/admin/settings/workflows': aiMessages.workflows,
} as const

export type AiPagePath = keyof typeof AI_PAGES

export function settingsPageLabel(path: SettingsPagePath): string {
  const page = SETTINGS_PAGES[path]
  if (!page) throw new Error(`No settings page registered for ${path}`)
  return page.label
}
