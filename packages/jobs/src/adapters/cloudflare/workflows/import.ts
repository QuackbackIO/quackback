/**
 * Import Workflow for Cloudflare Workers.
 *
 * Processes CSV imports with step-level progress tracking.
 * Each batch of rows is a separate step for:
 * - Progress tracking via instance.status()
 * - Automatic retry of failed batches
 * - Resume from last successful batch on failure
 */

import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers'
import { setDbGetter, createDb } from '@quackback/db/client'
import type { ImportJobData, ImportJobResult } from '../../../types'
import { parseCSV, processBatch, BATCH_SIZE, MAX_ERRORS } from '../../../processors/import'

/**
 * Cloudflare environment for the Import Workflow.
 */
export interface ImportWorkflowEnv {
  HYPERDRIVE: Hyperdrive
}

/**
 * Configure database for workflow execution.
 * Must be called before any database operations.
 */
function configureDb(env: ImportWorkflowEnv): void {
  setDbGetter(() => createDb(env.HYPERDRIVE.connectionString, { prepare: true, max: 1 }))
}

/**
 * Import Workflow definition.
 *
 * Steps:
 * 1. parse-csv: Parse the base64-encoded CSV content
 * 2. batch-N: Process batch N of rows (one step per batch)
 *
 * Progress is tracked by counting completed batch steps.
 */
export class ImportWorkflow extends WorkflowEntrypoint<ImportWorkflowEnv, ImportJobData> {
  async run(event: WorkflowEvent<ImportJobData>, step: WorkflowStep): Promise<ImportJobResult> {
    // Configure database connection via Hyperdrive
    configureDb(this.env)

    const { csvContent, workspaceId, boardId } = event.payload

    // Step 1: Parse CSV
    const rows = await step.do('parse-csv', async () => {
      return parseCSV(csvContent)
    })

    // Initialize cumulative result
    let result: ImportJobResult = {
      imported: 0,
      skipped: 0,
      errors: [],
      createdTags: [],
    }

    // Process in batches - each batch is a step for progress tracking
    const totalBatches = Math.ceil(rows.length / BATCH_SIZE)

    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
      const startIndex = batchIndex * BATCH_SIZE
      const batch = rows.slice(startIndex, startIndex + BATCH_SIZE)

      // Each batch is a separate step with retry configuration
      const batchResult = await step.do(
        `batch-${batchIndex}`,
        {
          retries: {
            limit: 3,
            delay: '1 second',
            backoff: 'exponential',
          },
          timeout: '30 seconds',
        },
        async () => {
          return processBatch(batch, workspaceId, boardId, startIndex)
        }
      )

      // Merge batch result into cumulative result
      result = {
        imported: result.imported + batchResult.imported,
        skipped: result.skipped + batchResult.skipped,
        errors: [...result.errors, ...batchResult.errors].slice(0, MAX_ERRORS),
        createdTags: [...new Set([...result.createdTags, ...batchResult.createdTags])],
      }
    }

    return result
  }
}
