/**
 * Close-spam setting — client-safe types + defaults.
 *
 * Rides in the `settings.metadata` JSON bag under `workflowCloseSpam`
 * (see `domains/settings/settings.workflows.ts`). Independent of
 * abandoned-journey auto-close. Off by default.
 */
import { z } from 'zod'

export interface WorkflowCloseSpamSettings {
  enabled: boolean
}

export const DEFAULT_WORKFLOW_CLOSE_SPAM: WorkflowCloseSpamSettings = {
  enabled: false,
}

export const workflowCloseSpamSchema = z
  .object({
    enabled: z.boolean(),
  })
  .partial()

export type UpdateWorkflowCloseSpamInput = z.infer<typeof workflowCloseSpamSchema>
