import { deliveryError } from '@/lib/server/integrations/sync/outcomes'
/**
 * Azure DevOps hook handler.
 * Creates work items when feedback events occur.
 */

import type { IntegrationHook, DeliveryOutcome } from '@/lib/server/integrations/sync/outcomes'
import type { EventData } from '@/lib/server/events/types'
import { createWorkItem } from '@/integrations/azure-devops/server/api'
import { buildAzureDevOpsWorkItemBody } from '@/integrations/azure-devops/server/message'
import { logger } from '@/lib/server/logger'
import { hookLinks } from '@/lib/server/integrations/message-utils'
import type { SectionOrigins } from '@/lib/shared/section-links'

const log = logger.child({ component: 'azure-devops' })

export interface AzureDevOpsTarget {
  channelId: string // "projectName:workItemType"
}

export interface AzureDevOpsConfig {
  accessToken: string
  organizationUrl: string
  organizationName: string
  rootUrl: string
  links?: SectionOrigins
}

export const azureDevOpsHook: IntegrationHook = {
  async run(event: EventData, target: unknown, config: unknown): Promise<DeliveryOutcome> {
    const { channelId } = target as AzureDevOpsTarget
    const { accessToken, organizationName, rootUrl, links } = config as AzureDevOpsConfig

    if (event.type !== 'post.created') {
      return { state: 'succeeded' }
    }

    if (!organizationName) {
      return { state: 'failed', errorCode: 'provider_failed' }
    }
    if (!accessToken) {
      return { state: 'failed', errorCode: 'provider_failed' }
    }

    const [project, workItemType] = channelId.split(':')
    if (!project || !workItemType) {
      return { state: 'failed', errorCode: 'provider_failed' }
    }

    log.debug(
      { work_item_type: workItemType, project, event_type: event.type },
      'creating work item'
    )

    const { title, description } = buildAzureDevOpsWorkItemBody(
      event,
      hookLinks({ rootUrl, links })
    )

    try {
      const result = await createWorkItem(accessToken, organizationName, project, workItemType, {
        title,
        description,
      })

      log.info({ work_item_id: result.id }, 'work item created')
      return {
        state: 'succeeded',
        result: { externalId: String(result.id), externalUrl: result.url },
      }
    } catch (error) {
      return deliveryError(error)
    }
  },
}
