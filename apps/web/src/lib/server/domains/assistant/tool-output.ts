import { z } from 'zod'

/**
 * The pipeline's gate results. Every tool's declared output must also admit
 * these: the model runtime validates execute results against outputSchema
 * AFTER the pipeline wrapper runs, so a pending-approval / denied / duplicate
 * / failed / simulated result must parse or the model sees a generic
 * validation error instead of the note it should relay to the customer.
 * Compose every definition's outputSchema through `withGateEnvelope`.
 */
export const assistantGateEnvelopeSchema = z.union([
  z.object({
    status: z.enum(['pending_approval', 'denied', 'skipped_duplicate', 'failed']),
    note: z.string(),
  }),
  z.object({ simulated: z.literal(true), summary: z.string() }),
])

/**
 * Compose a tool's outputSchema so it also admits the pipeline's gate
 * envelopes (pending-approval/denied/duplicate/failed/simulated).
 *
 * This deliberately does NOT use TanStack's `needsApproval` tool option.
 * Approval here is a PERSISTED queue — a pending-action row with a TTL, a
 * summary card a teammate reviews, and later execution as a bounded
 * teammate-actor (see `proposePendingAction` / `executeApprovedPendingAction`)
 * — not the in-stream client-side approval prompt `needsApproval` triggers. The
 * gate result is a normal tool output the model must be able to relay to the
 * customer, so it rides the outputSchema; do not migrate this to `needsApproval`.
 */
export function withGateEnvelope<T extends z.ZodTypeAny>(schema: T) {
  return z.union([schema, assistantGateEnvelopeSchema])
}
