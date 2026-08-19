import type { IntegrationDefinition, IntegrationCatalogEntry, IntegrationCapability } from './types'
import type { HookHandler } from '../events/hook-types'
import { slackIntegration } from '@/integrations/slack/server'
import { discordIntegration } from '@/integrations/discord/server'
import { linearIntegration } from '@/integrations/linear/server'
import { jiraIntegration } from '@/integrations/jira/server'
import { githubIntegration } from '@/integrations/github/server'
import { intercomIntegration } from '@/integrations/intercom/server'
import { teamsIntegration } from '@/integrations/teams/server'
import { zendeskIntegration } from '@/integrations/zendesk/server'
import { hubspotIntegration } from '@/integrations/hubspot/server'
import { asanaIntegration } from '@/integrations/asana/server'
import { clickupIntegration } from '@/integrations/clickup/server'
import { shortcutIntegration } from '@/integrations/shortcut/server'
import { zapierIntegration } from '@/integrations/zapier/server'
import { azureDevOpsIntegration } from '@/integrations/azure-devops/server'
import { notionIntegration } from '@/integrations/notion/server'
import { trelloIntegration } from '@/integrations/trello/server'
import { gitlabIntegration } from '@/integrations/gitlab/server'
import { stripeIntegration } from '@/integrations/stripe/server'
import { mondayIntegration } from '@/integrations/monday/server'
import { freshdeskIntegration } from '@/integrations/freshdesk/server'
import { salesforceIntegration } from '@/integrations/salesforce/server'
import { n8nIntegration } from '@/integrations/n8n/server'
import { makeIntegration } from '@/integrations/make/server'
import { segmentIntegration } from '@/integrations/segment/server'
import { ntfyIntegration } from '@/integrations/ntfy/server'

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
  [ntfyIntegration.id, ntfyIntegration],
])

export function getIntegration(type: string): IntegrationDefinition | undefined {
  return registry.get(type)
}

/** The full list of registered integration type ids (e.g. 'slack', 'azure-devops'). */
export function listIntegrationTypes(): string[] {
  return [...registry.keys()]
}

/**
 * Capability badges derived from the definition's slots, flavored by the
 * catalog category (taxonomy, not a capability claim) — so the catalog
 * cannot advertise what a provider does not implement (IF WO-4). Providers
 * with no capability slots yet (enrichment-only: zendesk/intercom/hubspot)
 * fall back to their hand-written copy until the context capability lands.
 */
function deriveCapabilities(i: IntegrationDefinition): IntegrationCapability[] {
  const name = i.catalog.name
  const caps: IntegrationCapability[] = []

  if (i.hook) {
    switch (i.catalog.category) {
      case 'issue_tracking':
        caps.push({
          label: 'Create items from feedback',
          description: `Automatically create ${name} items when new feedback is submitted`,
        })
        break
      case 'notifications':
        caps.push({
          label: 'Channel notifications',
          description: `Send feedback updates to ${name}`,
        })
        break
      case 'automation':
        caps.push({
          label: 'Event triggers',
          description: `Send feedback events to ${name} to power your automations`,
        })
        break
      default:
        // support_crm hooks are enrichment lookups, not deliveries.
        caps.push({
          label: 'Customer context',
          description: `Look up customer details in ${name} when feedback arrives`,
        })
    }
  }

  if (i.inbound && i.webhookRegistration) {
    caps.push({
      label: 'Two-way status sync',
      description: `Status changes in ${name} update linked feedback in Quackback`,
    })
  }

  if (i.issues) {
    caps.push({
      label: 'Link existing items',
      description: `Link posts and tickets to existing ${name} items`,
    })
  }

  if (i.archive) {
    caps.push({
      label: 'Clean up on delete',
      description: `Close or archive linked ${name} items when feedback is deleted`,
    })
  }

  if (i.userSync) {
    caps.push({
      label: 'User data sync',
      description: `Sync user attributes and segment membership with ${name}`,
    })
  }

  return caps
}

export async function getIntegrationCatalog(): Promise<IntegrationCatalogEntry[]> {
  const { getConfiguredIntegrationTypes } =
    await import('@/lib/server/domains/platform-credentials/platform-credential.service')
  const configuredTypes = await getConfiguredIntegrationTypes()
  return Array.from(registry.values()).map((i) => {
    const derived = deriveCapabilities(i)
    return {
      ...i.catalog,
      capabilities: derived.length > 0 ? derived : (i.catalog.capabilities ?? []),
      available: i.platformCredentials.length === 0 || configuredTypes.has(i.id),
      configurable: i.platformCredentials.length > 0,
      platformCredentialFields: i.platformCredentials,
    }
  })
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
