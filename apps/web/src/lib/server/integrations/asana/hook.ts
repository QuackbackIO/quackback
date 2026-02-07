/**
 * Asana hook handler.
 * Creates Asana tasks when feedback events occur.
 */

import type { HookHandler, HookResult } from '../../events/hook-types'
import type { EventData } from '../../events/types'
import { isRetryableError } from '../../events/hook-utils'
import { buildAsanaTaskBody } from './message'

const ASANA_API = 'https://app.asana.com/api/1.0'

export interface AsanaTarget {
  channelId: string // projectId is stored as channelId for consistency
}

export interface AsanaConfig {
  accessToken: string
  rootUrl: string
  workspaceGid: string
}

export const asanaHook: HookHandler = {
  async run(event: EventData, target: unknown, config: unknown): Promise<HookResult> {
    const { channelId: projectId } = target as AsanaTarget
    const { accessToken, rootUrl, workspaceGid } = config as AsanaConfig

    // Only create tasks for new feedback
    if (event.type !== 'post.created') {
      return { success: true }
    }

    console.log(`[Asana] Creating task for ${event.type} → project ${projectId}`)

    const { name, htmlNotes } = buildAsanaTaskBody(event, rootUrl)

    try {
      const response = await fetch(`${ASANA_API}/tasks`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          data: {
            name,
            html_notes: htmlNotes,
            projects: [projectId],
            workspace: workspaceGid,
          },
        }),
      })

      if (!response.ok) {
        const status = response.status

        if (status === 401) {
          return {
            success: false,
            error: 'Authentication failed. Please reconnect Asana.',
            shouldRetry: false,
          }
        }

        if (status === 429) {
          console.error('[Asana] Rate limited')
          return {
            success: false,
            error: 'Rate limited by Asana',
            shouldRetry: true,
          }
        }

        if (status >= 500) {
          const errorText = await response.text()
          console.error(`[Asana] Server error ${status}: ${errorText}`)
          return {
            success: false,
            error: `Asana server error: HTTP ${status}`,
            shouldRetry: true,
          }
        }

        const errorText = await response.text()
        console.error(`[Asana] API error ${status}: ${errorText}`)
        return {
          success: false,
          error: `Asana API error: HTTP ${status}`,
          shouldRetry: false,
        }
      }

      const body = (await response.json()) as {
        data?: { gid: string; permalink_url: string }
      }

      const task = body.data
      if (!task) {
        return { success: false, error: 'No task returned', shouldRetry: false }
      }

      console.log(`[Asana] Created task ${task.gid}`)
      return { success: true, externalId: task.gid, externalUrl: task.permalink_url }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      console.error(`[Asana] Exception: ${errorMsg}`)

      return {
        success: false,
        error: errorMsg,
        shouldRetry: isRetryableError(error),
      }
    }
  },
}
