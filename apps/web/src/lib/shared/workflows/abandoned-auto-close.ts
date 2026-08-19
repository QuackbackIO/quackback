/**
 * Abandoned-journey auto-close settings — client-safe types + defaults,
 * mirroring the status/ticket settings pattern (no dedicated DB column; the
 * value rides in the `settings.metadata` JSON bag under the
 * `workflowAbandonedAutoClose` key, see
 * `domains/settings/settings.workflows.ts`).
 *
 * When enabled, an interactive conversational block (a customer-facing
 * workflow parked waiting on the visitor's structured reply — buttons,
 * collect data/reply, a rating ask) that sits unanswered past `waitMinutes`
 * is swept: the run ends, and — unless the conversation already has a
 * visitor reply, or (when `keepIfEmailCaptured`) an email was captured for
 * follow-up — the conversation itself is closed rather than left open
 * forever with nobody coming back to it.
 */
import { z } from 'zod'

export interface WorkflowAbandonedAutoCloseSettings {
  /** Master switch. Off by default — an interactive block's park never
   *  expires until an admin opts in. */
  enabled: boolean
  /** How long an interactive block waits for the visitor's reply before it
   *  is considered abandoned. 1-60 minutes. */
  waitMinutes: number
  /** When true, a conversation with a captured contact email is left open
   *  for a human follow-up instead of being auto-closed — there's someone
   *  to reach even though the journey itself stalled. */
  keepIfEmailCaptured: boolean
}

export const DEFAULT_WORKFLOW_ABANDONED_AUTO_CLOSE: WorkflowAbandonedAutoCloseSettings = {
  enabled: false,
  waitMinutes: 5,
  keepIfEmailCaptured: true,
}

export const workflowAbandonedAutoCloseSchema = z
  .object({
    enabled: z.boolean(),
    waitMinutes: z.number().int().min(1).max(60),
    keepIfEmailCaptured: z.boolean(),
  })
  .partial()

export type UpdateWorkflowAbandonedAutoCloseInput = z.infer<typeof workflowAbandonedAutoCloseSchema>
