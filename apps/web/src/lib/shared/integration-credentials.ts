// Shared Cloud OAuth apps. Keep tenant and control-plane copies identical.
export const CLOUD_INTEGRATION_FIELDS: Record<string, string[]> = {
  slack: ['clientId', 'clientSecret', 'signingSecret'],
  github: ['clientId', 'clientSecret'],
  gitlab: ['clientId', 'clientSecret'],
  linear: ['clientId', 'clientSecret'],
  jira: ['clientId', 'clientSecret'],
  asana: ['clientId', 'clientSecret'],
  clickup: ['clientId', 'clientSecret'],
  monday: ['clientId', 'clientSecret'],
  notion: ['clientId', 'clientSecret'],
  trello: ['clientId', 'clientSecret'],
  zendesk: ['clientId', 'clientSecret'],
  intercom: ['clientId', 'clientSecret'],
  hubspot: ['clientId', 'clientSecret'],
  salesforce: ['clientId', 'clientSecret'],
  teams: ['clientId', 'clientSecret'],
  discord: ['clientId', 'clientSecret', 'botToken'],
}

export function integrationEnvironmentKey(provider: string, field: string): string {
  return (
    'INTEGRATION_' +
    provider.toUpperCase().replaceAll('-', '_') +
    '_' +
    field.replace(/([A-Z])/g, '_$1').toUpperCase()
  )
}
