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
import { azureDevOpsIntegration } from './azure-devops'
import { notionIntegration } from './notion'
import { trelloIntegration } from './trello'
import { gitlabIntegration } from './gitlab'
import { stripeIntegration } from './stripe'
import { mondayIntegration } from './monday'
import { freshdeskIntegration } from './freshdesk'
import { salesforceIntegration } from './salesforce'
import { n8nIntegration } from './n8n'
import { makeIntegration } from './make'
import { segmentIntegration } from './segment'

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
  [azureDevOpsIntegration.id, azureDevOpsIntegration],
  [notionIntegration.id, notionIntegration],
  [trelloIntegration.id, trelloIntegration],
  [gitlabIntegration.id, gitlabIntegration],
  [stripeIntegration.id, stripeIntegration],
  [mondayIntegration.id, mondayIntegration],
  [freshdeskIntegration.id, freshdeskIntegration],
  [salesforceIntegration.id, salesforceIntegration],
  [n8nIntegration.id, n8nIntegration],
  [makeIntegration.id, makeIntegration],
  [segmentIntegration.id, segmentIntegration],
])

export function getIntegration(type: string): IntegrationDefinition | undefined {
  return registry.get(type)
}

export async function getIntegrationCatalog(): Promise<IntegrationCatalogEntry[]> {
  const { getConfiguredIntegrationTypes } =
    await import('@/lib/server/domains/platform-credentials/platform-credential.service')
  const configuredTypes = await getConfiguredIntegrationTypes()
  return Array.from(registry.values()).map((i) => ({
    ...i.catalog,
    available: i.platformCredentials.length === 0 || configuredTypes.has(i.id),
    configurable: i.platformCredentials.length > 0,
    platformCredentialFields: i.platformCredentials,
  }))
}

export function getIntegrationHook(type: string): HookHandler | undefined {
  return registry.get(type)?.hook
}

export function getIntegrationInbound(type: string) {
  return registry.get(type)?.inbound
}

export function getIntegrationTypesWithSegmentSync(): string[] {
  return Array.from(registry.values())
    .filter((i) => i.userSync?.syncSegmentMembership)
    .map((i) => i.id)
}
