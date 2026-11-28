import { defineMessages, type IntlShape } from 'react-intl'

interface SettingsPageEntry {
  /** The English label; `labelId` names it in the catalogue. */
  label: string
  labelId: string
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
  '/admin/settings/feedback': {
    label: 'Feedback & Roadmaps',
    labelId: 'admin.shell.settingsNav.feedback',
  },
  '/admin/settings/support': { label: 'Support', labelId: 'admin.shell.settingsNav.support' },
  // Feedback & Roadmaps
  '/admin/settings/boards': { label: 'Boards', labelId: 'admin.shell.settingsNav.boards' },
  '/admin/settings/statuses': { label: 'Statuses', labelId: 'admin.shell.settingsNav.statuses' },
  '/admin/settings/tags': { label: 'Tags', labelId: 'admin.shell.settingsNav.tags' },
  '/admin/settings/moderation': {
    label: 'Moderation',
    labelId: 'admin.shell.settingsNav.moderation',
  },
  // Support
  '/admin/settings/channels': { label: 'Channels', labelId: 'admin.shell.settingsNav.channels' },
  '/admin/settings/channels/messenger': {
    label: 'Messenger',
    labelId: 'admin.shell.settingsNav.channelsMessenger',
  },
  '/admin/settings/channels/email': {
    label: 'Email',
    labelId: 'admin.shell.settingsNav.channelsEmail',
  },
  '/admin/settings/channels/github': {
    label: 'GitHub',
    labelId: 'admin.shell.settingsNav.channelsGithub',
  },
  '/admin/settings/macros': { label: 'Macros', labelId: 'admin.shell.settingsNav.macros' },
  '/admin/settings/office-hours': {
    label: 'Office hours',
    labelId: 'admin.shell.settingsNav.officeHours',
  },
  '/admin/settings/sla': { label: 'SLA policies', labelId: 'admin.shell.settingsNav.sla' },
  '/admin/settings/ticket-types': {
    label: 'Ticket types',
    labelId: 'admin.shell.settingsNav.ticketTypes',
  },
  '/admin/settings/ticket-statuses': {
    label: 'Ticket statuses',
    labelId: 'admin.shell.settingsNav.ticketStatuses',
  },
  // Other product modules
  '/admin/settings/help-center': {
    label: 'Help Center',
    labelId: 'admin.shell.settingsNav.helpCenter',
  },
  '/admin/settings/changelog': { label: 'Changelog', labelId: 'admin.shell.settingsNav.changelog' },
  '/admin/settings/status': { label: 'Status', labelId: 'admin.shell.settingsNav.status' },
  // Workspace
  '/admin/settings/general': { label: 'General', labelId: 'admin.shell.settingsNav.general' },
  '/admin/settings/domains': { label: 'Domains', labelId: 'admin.shell.settingsNav.domains' },
  '/admin/settings/email': { label: 'Email', labelId: 'admin.shell.settingsNav.email' },
  '/admin/settings/notifications': {
    label: 'Notifications',
    labelId: 'admin.shell.settingsNav.notifications',
  },
  '/admin/settings/portal': { label: 'Portal', labelId: 'admin.shell.settingsNav.portal' },
  '/admin/settings/widget': { label: 'Widget', labelId: 'admin.shell.settingsNav.widget' },
  '/admin/settings/widget/install': {
    label: 'Install',
    labelId: 'admin.shell.settingsNav.widgetInstall',
  },
  '/admin/settings/members': {
    label: 'Members & Teams',
    labelId: 'admin.shell.settingsNav.members',
  },
  '/admin/settings/security/authentication': {
    label: 'Access & Security',
    labelId: 'admin.shell.settingsNav.securityAuthentication',
  },
  '/admin/settings/developers': {
    label: 'Developers',
    labelId: 'admin.shell.settingsNav.developers',
  },
  '/admin/settings/labs': { label: 'Labs', labelId: 'admin.shell.settingsNav.labs' },
  '/admin/settings/integrations': {
    label: 'Integrations',
    labelId: 'admin.shell.settingsNav.integrations',
  },
  '/admin/settings/billing': {
    label: 'Plan & billing',
    labelId: 'admin.shell.settingsNav.billing',
  },
  // Data
  '/admin/settings/people': { label: 'Users', labelId: 'admin.shell.settingsNav.people' },
  '/admin/settings/companies': { label: 'Companies', labelId: 'admin.shell.settingsNav.companies' },
  '/admin/settings/conversation-data': {
    label: 'Conversations',
    labelId: 'admin.shell.settingsNav.conversationData',
  },
  '/admin/settings/imports': {
    label: 'Imports & exports',
    labelId: 'admin.shell.settingsNav.imports',
  },
} as const satisfies Record<string, SettingsPageEntry>

export type SettingsPagePath = keyof typeof SETTINGS_PAGES

const automationMessages = defineMessages({
  agent: { id: 'automation.nav.agent', defaultMessage: 'Agent' },
  copilot: { id: 'automation.nav.copilot', defaultMessage: 'Copilot' },
  connectors: { id: 'automation.nav.connectors', defaultMessage: 'Connectors' },
  skills: { id: 'automation.nav.skills', defaultMessage: 'Skills' },
  workflows: { id: 'automation.nav.workflows', defaultMessage: 'Workflows' },
})

/**
 * The AI & Automation pages, which are settings pages too. Their labels are
 * messages, so the page title is translated; the settings nav shows each
 * message's default text.
 */
export const AUTOMATION_PAGES = {
  '/admin/settings/agent': automationMessages.agent,
  '/admin/settings/copilot': automationMessages.copilot,
  '/admin/settings/connectors': automationMessages.connectors,
  '/admin/settings/skills': automationMessages.skills,
  '/admin/settings/workflows': automationMessages.workflows,
} as const

export type AutomationPagePath = keyof typeof AUTOMATION_PAGES

/**
 * A settings page's label in the reader's language, by its path: the
 * registry's label, or an AI & Automation page's message. Anything else keeps
 * the `fallback` it came with.
 */
export function settingsPageTitle(intl: IntlShape, path: string, fallback: string): string {
  if (path in SETTINGS_PAGES) {
    const { label, labelId } = SETTINGS_PAGES[path as SettingsPagePath]
    return intl.formatMessage({ id: labelId, defaultMessage: label })
  }
  if (path in AUTOMATION_PAGES)
    return intl.formatMessage(AUTOMATION_PAGES[path as AutomationPagePath])
  return fallback
}

export function settingsPageLabel(path: SettingsPagePath): string {
  const page = SETTINGS_PAGES[path]
  if (!page) throw new Error(`No settings page registered for ${path}`)
  return page.label
}
