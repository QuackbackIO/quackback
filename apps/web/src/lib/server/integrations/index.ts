import type { IntegrationDefinition, IntegrationCatalogEntry, IntegrationCapability } from './types'
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
 * cannot advertise what a provider does not implement. Lookup providers
 * use their context capability to describe on-demand customer details.
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
        caps.push({
          label: 'Event delivery',
          description: `Send subscribed events to ${name}`,
        })
    }
  }

  if (i.inbound && i.webhookRegistration) {
    caps.push({
      label:
        i.inbound.statusMode === 'automatic' ? 'Receive status updates' : 'Review status updates',
      description:
        i.inbound.statusMode === 'automatic'
          ? `Verified status changes in ${name} update linked feedback in Quackback`
          : `Status changes from ${name} appear in Sync history for manual review`,
    })
  }

  if (i.listExternalStatuses) {
    caps.push({
      label: 'Review outbound status changes',
      description: `Review mapped Quackback status changes before applying them in ${name}`,
    })
  }

  if (i.issues?.parseRef || i.issues?.inspect) {
    caps.push({
      label: 'Link existing items',
      description: `Link posts and tickets to existing ${name} items`,
    })
  }

  if (i.linkedItems) {
    caps.push({
      label: 'Review cleanup on delete',
      description: `Review linked ${name} items for closing or archiving when feedback is deleted`,
    })
  }

  if (i.context) {
    caps.push({
      label: 'Customer context',
      description: `Look up customer details in ${name} on demand`,
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
  const { getConfiguredIntegrationTypes, arePlatformCredentialsManaged } =
    await import('@/lib/server/domains/platform-credentials/platform-credential.service')
  const configuredTypes = await getConfiguredIntegrationTypes()
  return Promise.all(
    Array.from(registry.values()).map(async (i) => {
      const derived = deriveCapabilities(i)
      const managed = await arePlatformCredentialsManaged(i.id)
      const hasPlatformApp =
        i.platformCredentials.length === 0 || configuredTypes.has(i.id) || managed
      return {
        ...i.catalog,
        capabilities: derived.length > 0 ? derived : (i.catalog.capabilities ?? []),
        available: hasPlatformApp,
        managed,
        configurable: i.platformCredentials.length > 0,
        platformCredentialFields: i.platformCredentials,
      }
    })
  )
}

export function getIntegrationInbound(type: string) {
  return registry.get(type)?.inbound
}

export function getIntegrationTypesWithSegmentSync(): string[] {
  return Array.from(registry.values())
    .filter((i) => i.userSync?.syncSegmentMembership)
    .map((i) => i.id)
}
