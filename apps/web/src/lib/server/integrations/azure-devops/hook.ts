/**
 * Azure DevOps hook handler.
 * Creates work items when feedback events occur.
 */

import type { HookHandler, HookResult } from '../../events/hook-types'
import type { EventData } from '../../events/types'
import { isRetryableError } from '../../events/hook-utils'
import { createWorkItem } from './api'
import { buildAzureDevOpsWorkItemBody } from './message'

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

    if (event.type !== 'post.created') {
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

    console.log(`[AzureDevOps] Creating ${workItemType} in ${project} for ${event.type}`)

    const { title, description } = buildAzureDevOpsWorkItemBody(event, rootUrl)

    try {
      const result = await createWorkItem(accessToken, organizationName, project, workItemType, {
        title,
        description,
      })

      console.log(`[AzureDevOps] Created work item #${result.id}`)
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
