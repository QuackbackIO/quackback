/**
 * Shared integration display helpers.
 * Used by both the integration config UI and the delete post dialog.
 */

const INTEGRATION_DISPLAY_NAMES: Record<string, string> = {
  linear: 'Linear',
  github: 'GitHub',
  jira: 'Jira',
  gitlab: 'GitLab',
  clickup: 'ClickUp',
  asana: 'Asana',
  shortcut: 'Shortcut',
  azure_devops: 'Azure DevOps',
  trello: 'Trello',
  notion: 'Notion',
  monday: 'Monday',
}

/** Get a human-readable display name for an integration type */
export function getIntegrationDisplayName(integrationType: string): string {
  return INTEGRATION_DISPLAY_NAMES[integrationType] ?? integrationType
}

/** Get the action verb for a platform (Close vs Archive) */
export function getIntegrationActionVerb(integrationType: string): string {
  switch (integrationType) {
    case 'github':
    case 'jira':
    case 'gitlab':
    case 'clickup':
    case 'azure_devops':
      return 'Close'
    default:
      return 'Archive'
  }
}

/** Get the item noun for a platform (issue, task, story, etc.) */
export function getIntegrationItemNoun(integrationType: string): string {
  switch (integrationType) {
    case 'asana':
    case 'clickup':
    case 'trello':
      return 'task'
    case 'shortcut':
      return 'story'
    case 'azure_devops':
      return 'work item'
    case 'notion':
      return 'page'
    case 'monday':
      return 'item'
    default:
      return 'issue'
  }
}
