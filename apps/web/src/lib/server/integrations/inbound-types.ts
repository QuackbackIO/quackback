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
  /** Verified scope from the signed event, never inferred from the current connection. */
  destinationId?: string
  occurredAt?: string
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
  /** Automatic adapters supply signed destination and revision evidence. */
  statusMode: 'automatic' | 'review'
  /** Acknowledge setup challenges without accepting events or storing untrusted secrets. */
  handshake?(request: Request): Response | null

  /**
   * Verify the webhook signature/authenticity.
   * Returns `true` if valid, or a `Response` for handshake challenges or auth failures.
   */
  verifySignature(request: Request, body: string, secret: string): Promise<true | Response>

  /**
   * Runs in the durable worker. Return null for irrelevant events, an array
   * for batches, and throw on transient lookup failures so the receipt retries.
   */
  parseStatusChange(
    body: string,
    config: Record<string, unknown>,
    secrets: Record<string, unknown>
  ): Promise<InboundWebhookResult | InboundWebhookResult[] | null>
}
