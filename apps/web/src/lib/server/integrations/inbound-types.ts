/**
 * Inbound webhook handler interface.
 *
 * Each integration that supports inbound status sync implements this interface.
 * The central orchestrator calls verifySignature, then parseStatusChange,
 * then looks up the post and updates its status.
 */

/**
 * Result of parsing an inbound webhook payload.
 */
export interface InboundWebhookResult {
  /** The external issue ID that changed status */
  externalId: string
  /** The new status name from the external platform */
  externalStatus: string
  /** Event type for logging (e.g. 'issue.updated', 'taskStatusUpdated') */
  eventType: string
  /**
   * Semantic open/closed transition, when the provider payload states it
   * outright (GitHub's `action: closed|reopened`). Most providers only report
   * a workflow-state change with a status name, so this stays undefined and
   * downstream copy falls back to naming the new status. Optional by design —
   * do NOT derive it heuristically from status names.
   */
  transition?: 'closed' | 'reopened'
}

/**
 * Handler interface for inbound webhooks from external platforms.
 */
export interface InboundWebhookHandler {
  /**
   * Verify the webhook signature/authenticity.
   * Returns `true` if valid, or a `Response` for handshake challenges or auth failures.
   */
  verifySignature(request: Request, body: string, secret: string): Promise<true | Response>

  /**
   * Parse the webhook body and extract a status change, if any.
   * Returns null for events we don't care about (acknowledged but ignored).
   */
  parseStatusChange(
    body: string,
    config: Record<string, unknown>,
    secrets: Record<string, unknown>
  ): Promise<InboundWebhookResult | null>
}
