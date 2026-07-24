/**
 * Azure DevOps hook handler.
 * Creates a work item when a post's status changes to "Planned".
 */

import type { HookHandler, HookResult } from '../../events/hook-types'
import type { EventData } from '../../events/types'
import { isRetryableError } from '../../events/hook-utils'
import { createWorkItem } from './api'
import { buildAzureDevOpsWorkItemBody } from './message'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'azure-devops' })

/** Slug of the status that triggers work item creation (stable across renames of "Planned"). */
const TARGET_STATUS_SLUG = 'planned'

export interface AzureDevOpsTarget {
  channelId: string // "projectName:workItemType"
}

export interface AzureDevOpsConfig {
  accessToken: string
  organizationUrl: string
  organizationName: string
  rootUrl: string
}

export const azureDevOpsHook: HookHandler = {
  async run(event: EventData, target: unknown, config: unknown): Promise<HookResult> {
    const { channelId } = target as AzureDevOpsTarget
    const { accessToken, organizationName, rootUrl } = config as AzureDevOpsConfig

    if (event.type !== 'post.status_changed' || event.data.newStatusSlug !== TARGET_STATUS_SLUG) {
      return { success: true }
    }

    const [project, workItemType] = channelId.split(':')
    if (!project || !workItemType) {
      return {
        success: false,
        error: 'Invalid configuration: missing project or work item type',
        shouldRetry: false,
      }
    }

    log.debug(
      { work_item_type: workItemType, project, event_type: event.type },
      'creating work item'
    )

    const { title, description } = buildAzureDevOpsWorkItemBody(event, rootUrl)

    try {
      const result = await createWorkItem(accessToken, organizationName, project, workItemType, {
        title,
        description,
      })

      log.info({ work_item_id: result.id }, 'work item created')
      return {
        success: true,
        externalId: String(result.id),
        externalUrl: result.url,
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      const status = (error as { status?: number }).status

      if (status === 401 || status === 403) {
        return {
          success: false,
          error: 'Authentication failed. Please reconnect Azure DevOps.',
          shouldRetry: false,
        }
      }

      return {
        success: false,
        error: errorMsg,
        shouldRetry: isRetryableError(error),
      }
    }
  },
}
