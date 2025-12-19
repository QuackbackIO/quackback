/**
 * Cloudflare Workflow job adapter for cloud deployments.
 *
 * Uses Cloudflare Workflows for durable job execution.
 * This adapter is used when running in Cloudflare Workers environment.
 *
 * NOTE: This is a placeholder - full implementation in Phase 4.
 */

import type { JobAdapter } from '../types'
import type { ImportJobData, ImportJobStatus, EventJobData } from '../../types'

/**
 * Cloudflare environment bindings for Workflows and Durable Objects.
 */
export interface CloudflareEnv {
  IMPORT_WORKFLOW: {
    create(options: { id: string; params: ImportJobData }): Promise<{ id: string }>
    get(id: string): Promise<WorkflowInstance | null>
  }
  EVENT_WORKFLOW: {
    create(options: { id: string; params: EventJobData }): Promise<{ id: string }>
  }
  INTEGRATION_STATE: DurableObjectNamespace
}

interface WorkflowInstance {
  status(): Promise<WorkflowStatus>
}

interface WorkflowStatus {
  status: 'queued' | 'running' | 'complete' | 'errored' | 'terminated'
  output?: unknown
  error?: { message: string }
  steps?: WorkflowStep[]
}

interface WorkflowStep {
  name: string
  status: 'pending' | 'running' | 'complete' | 'errored'
  output?: unknown
}

/**
 * Map Workflow status to ImportJobStatus status.
 */
function mapWorkflowStatus(wfStatus: string): 'waiting' | 'active' | 'completed' | 'failed' {
  switch (wfStatus) {
    case 'queued':
      return 'waiting'
    case 'running':
      return 'active'
    case 'complete':
      return 'completed'
    case 'errored':
    case 'terminated':
      return 'failed'
    default:
      return 'waiting'
  }
}

/**
 * Extract progress from workflow steps.
 * Counts completed batch steps to determine progress.
 */
function extractProgressFromSteps(
  steps: WorkflowStep[] | undefined,
  totalRows: number
): { processed: number; total: number } | undefined {
  if (!steps) return undefined

  const batchSteps = steps.filter((s) => s.name.startsWith('batch-'))
  const completedBatches = batchSteps.filter((s) => s.status === 'complete').length

  const batchSize = 100
  return {
    processed: Math.min(completedBatches * batchSize, totalRows),
    total: totalRows,
  }
}

/**
 * Workflow implementation of the JobAdapter interface.
 */
export class WorkflowJobAdapter implements JobAdapter {
  constructor(private env: CloudflareEnv) {}

  async addImportJob(data: ImportJobData): Promise<string> {
    const id = `import-${data.workspaceId}-${Date.now()}`
    await this.env.IMPORT_WORKFLOW.create({ id, params: data })
    return id
  }

  async getImportJobStatus(jobId: string): Promise<ImportJobStatus | null> {
    const instance = await this.env.IMPORT_WORKFLOW.get(jobId)
    if (!instance) return null

    const status = await instance.status()

    // Extract totalRows from params stored in workflow (not available in status)
    // For now, estimate from steps
    const batchSteps = status.steps?.filter((s) => s.name.startsWith('batch-')) || []
    const totalBatches = Math.max(batchSteps.length, 1)
    const estimatedTotal = totalBatches * 100

    return {
      jobId,
      status: mapWorkflowStatus(status.status),
      progress: extractProgressFromSteps(status.steps, estimatedTotal),
      result: status.output as ImportJobStatus['result'],
      error: status.error?.message,
    }
  }

  async addEventJob(data: EventJobData): Promise<string> {
    const id = `event-${data.workspaceId}-${data.id}`
    await this.env.EVENT_WORKFLOW.create({ id, params: data })
    return id
  }

  // Legacy methods - kept for interface compatibility but use addEventJob instead
  async addIntegrationJob(): Promise<string> {
    throw new Error('addIntegrationJob is deprecated. Use addEventJob instead.')
  }

  async addUserNotificationJob(): Promise<string> {
    throw new Error('addUserNotificationJob is deprecated. Use addEventJob instead.')
  }

  async close(): Promise<void> {
    // Workflows don't need explicit cleanup
  }
}
