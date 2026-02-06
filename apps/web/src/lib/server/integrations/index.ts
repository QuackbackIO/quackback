import type { IntegrationDefinition, IntegrationCatalogEntry } from './types'
import type { HookHandler } from '../events/hook-types'
import { slackIntegration } from './slack'
import { discordIntegration } from './discord'
import { linearIntegration } from './linear'
import { jiraIntegration } from './jira'
import { githubIntegration } from './github'
import { intercomIntegration } from './intercom'
import { teamsIntegration } from './teams'
import { zendeskIntegration } from './zendesk'
import { hubspotIntegration } from './hubspot'
import { asanaIntegration } from './asana'
import { clickupIntegration } from './clickup'
import { shortcutIntegration } from './shortcut'
import { zapierIntegration } from './zapier'

const registry = new Map<string, IntegrationDefinition>([
  [slackIntegration.id, slackIntegration],
  [discordIntegration.id, discordIntegration],
  [linearIntegration.id, linearIntegration],
  [jiraIntegration.id, jiraIntegration],
  [githubIntegration.id, githubIntegration],
  [intercomIntegration.id, intercomIntegration],
  [teamsIntegration.id, teamsIntegration],
  [zendeskIntegration.id, zendeskIntegration],
  [hubspotIntegration.id, hubspotIntegration],
  [asanaIntegration.id, asanaIntegration],
  [clickupIntegration.id, clickupIntegration],
  [shortcutIntegration.id, shortcutIntegration],
  [zapierIntegration.id, zapierIntegration],
])

export function getIntegration(type: string): IntegrationDefinition | undefined {
  return registry.get(type)
}

export function getIntegrationCatalog(): IntegrationCatalogEntry[] {
  return Array.from(registry.values()).map((i) => i.catalog)
}

export function getIntegrationHook(type: string): HookHandler | undefined {
  return registry.get(type)?.hook
}
