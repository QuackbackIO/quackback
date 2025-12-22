/**
 * Event Workflow for Cloudflare Workers.
 *
 * Consolidated workflow that processes domain events for both integrations
 * and user notifications. Replaces the separate IntegrationWorkflow and
 * UserNotificationWorkflow with a single, simpler workflow.
 *
 * Steps:
 * 1. get-mappings: Query integration mappings from database
 * 2. integration-{id}: Process each integration (with retries)
 * 3. notifications: Send user notifications (if applicable)
 */

import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers'
import { setDbGetter, createDb } from '@quackback/db/client'
import type { EventJobData, EventJobResult } from '../../../types'
import {
  getIntegrationMappings,
  processSingleIntegration,
  processEventNotifications,
  isNotificationEvent,
  type IntegrationMapping,
} from '../../../processors/event'
import { DurableObjectStateAdapter } from '../state-adapter'

/**
 * Cloudflare environment for the Event Workflow.
 */
export interface EventWorkflowEnv {
  HYPERDRIVE: Hyperdrive
  INTEGRATION_STATE: DurableObjectNamespace
  // Secrets needed for integration processing
  INTEGRATION_ENCRYPTION_KEY: string
  RESEND_API_KEY: string
  ROOT_URL: string
}

/**
 * Configure database for workflow execution.
 */
function configureDb(env: EventWorkflowEnv): void {
  setDbGetter(() => createDb(env.HYPERDRIVE.connectionString, { prepare: true, max: 1 }))
}

/**
 * Configure process.env from Cloudflare Worker env.
 * Required because modules like crypto.ts use process.env which isn't
 * automatically populated in Cloudflare Workers.
 */
function configureProcessEnv(env: EventWorkflowEnv): void {
  // Set environment variables that modules expect via process.env
  if (env.INTEGRATION_ENCRYPTION_KEY) {
    process.env.INTEGRATION_ENCRYPTION_KEY = env.INTEGRATION_ENCRYPTION_KEY
  }
  if (env.RESEND_API_KEY) {
    process.env.RESEND_API_KEY = env.RESEND_API_KEY
  }
  if (env.ROOT_URL) {
    process.env.ROOT_URL = env.ROOT_URL
  }
}

/**
 * Event Workflow definition.
 *
 * Processes domain events in a single workflow:
 * 1. Queries integration mappings from database
 * 2. Processes each matching integration with individual retries
 * 3. Sends user notifications (for status changes and comments)
 */
export class EventWorkflow extends WorkflowEntrypoint<EventWorkflowEnv, EventJobData> {
  async run(event: WorkflowEvent<EventJobData>, step: WorkflowStep): Promise<EventJobResult> {
    // Configure environment: database and process.env variables
    configureDb(this.env)
    configureProcessEnv(this.env)

    const { id, type, workspaceId } = event.payload
    const stateAdapter = new DurableObjectStateAdapter(this.env)

    console.log(`[EventWorkflow] Processing ${type} event ${id} for org ${workspaceId}`)

    // Initialize result
    const result: EventJobResult = {
      integrationsProcessed: 0,
      integrationErrors: [],
      notificationsSent: 0,
      notificationErrors: [],
    }

    // Step 1: Get integration mappings from database
    // Note: We serialize the mappings because step.do requires Serializable<T>
    const mappingsJson = await step.do('get-mappings', async () => {
      const mappings = await getIntegrationMappings(workspaceId, type)
      return JSON.stringify(mappings)
    })

    const mappings: IntegrationMapping[] = mappingsJson ? JSON.parse(mappingsJson as string) : []
    console.log(`[EventWorkflow] Found ${mappings.length} integration mappings`)

    // Step 2: Process each integration with individual retries
    for (const mapping of mappings) {
      try {
        const integrationResult = await step.do(
          `integration-${mapping.integrationId}`,
          {
            retries: {
              limit: 3,
              delay: '5 seconds',
              backoff: 'exponential',
            },
            timeout: '30 seconds',
          },
          async () => {
            return processSingleIntegration(mapping, event.payload, stateAdapter)
          }
        )

        if (integrationResult.success) {
          result.integrationsProcessed++
        } else if (integrationResult.error) {
          result.integrationErrors.push(`${mapping.integrationType}: ${integrationResult.error}`)
        }
      } catch (error) {
        // Step failed after all retries
        const msg = error instanceof Error ? error.message : 'Unknown error'
        result.integrationErrors.push(`${mapping.integrationType}: ${msg}`)
        console.error(`[EventWorkflow] Integration ${mapping.integrationType} failed:`, error)
      }
    }

    // Step 3: Send user notifications (only for certain event types)
    if (isNotificationEvent(type)) {
      try {
        const notifResult = await step.do(
          'notifications',
          {
            retries: {
              limit: 3,
              delay: '5 seconds',
              backoff: 'exponential',
            },
            timeout: '60 seconds', // Longer timeout for sending multiple emails
          },
          async () => {
            return processEventNotifications(event.payload)
          }
        )

        result.notificationsSent = notifResult.emailsSent
        result.notificationErrors = notifResult.errors
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown error'
        result.notificationErrors.push(msg)
        console.error(`[EventWorkflow] Notifications failed:`, error)
      }
    }

    console.log(
      `[EventWorkflow] Completed: ${result.integrationsProcessed} integrations, ` +
        `${result.notificationsSent} notifications, ` +
        `${result.integrationErrors.length + result.notificationErrors.length} errors`
    )

    return result
  }
}
