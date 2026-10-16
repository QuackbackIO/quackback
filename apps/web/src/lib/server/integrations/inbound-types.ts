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
  /**
   * A broader status name to map when `externalStatus` has no mapping of its
   * own (GitHub's `Closed (not planned)` falls back to `Closed`), so a
   * mapping made before the finer status existed keeps applying.
   */
  fallbackStatus?: string
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
 * An item's assignee added or removed on the provider (GitHub
 * `issues.assigned` / `issues.unassigned`), parsed from a signed delivery.
 */
export interface InboundAssigneeChange {
  /** The destination the delivery came from, as `destinationOf` names it. */
  destination: { externalId: string; externalKey?: string }
  /** The item's id in that destination (GitHub: the issue number). */
  externalId: string
  externalDisplayId: string
  externalUrl: string | null
  /**
   * The channel thread an Inbox conversation about this item has, for a
   * provider with an Inbox channel (GitHub: `owner/repo#n`), so a ticket
   * paired with that conversation follows too.
   */
  threadKey?: string
  action: 'assigned' | 'unassigned'
  /** The account added or removed: the provider's immutable id when it sends one, and its login. */
  assignee: { externalUserId: string | null; login: string }
  /** When the item last changed, for ordering against other changes to it. */
  occurredAt?: string
}

/**
 * A comment on an item, as the provider reports it: in a delivery, or read
 * back when a ticket is resynced.
 */
export interface RemoteIssueComment {
  /** The provider's comment id (GitHub: the numeric issue-comment id). */
  externalId: string
  externalUrl: string | null
  /** The comment, as Markdown. */
  body: string
  /** Who wrote it: the provider's immutable id when it sends one, and its login. */
  author: { externalUserId: string | null; login: string }
  createdAt: string
  /** Its version, for ordering edits (GitHub: `updated_at`). */
  updatedAt: string
  /** Written by the connection's own account (GitHub: `config.username`). */
  byConnection: boolean
  /** Carries one of Quackback's hidden markers: something Quackback wrote. */
  marked: boolean
  /**
   * The ticket reply this comment stands for, when its marker names one
   * (a reply the connection posted as a comment, `issues.comments`).
   */
  mirrorOf: { messageId: string; integrationId: string } | null
}

/**
 * A comment created, edited or deleted on an item (GitHub `issue_comment`),
 * parsed from a signed delivery.
 */
export interface InboundCommentChange {
  /** The destination the delivery came from, as `destinationOf` names it. */
  destination: { externalId: string; externalKey?: string }
  /** The item's id in that destination (GitHub: the issue number). */
  externalId: string
  externalDisplayId: string
  externalUrl: string | null
  /**
   * The channel thread an Inbox conversation about this item has, for a
   * provider with an Inbox channel (GitHub: `owner/repo#n`): such an item's
   * comments reach the inbox through the channel instead.
   */
  threadKey?: string
  action: 'created' | 'edited' | 'deleted'
  comment: RemoteIssueComment
}

/**
 * The ticket an item names as its own, read from a signed delivery about the
 * item: Quackback's hidden marker on an issue it opened, or a link to the
 * ticket in Quackback in the item's body.
 */
export interface InboundTicketReference {
  /** The destination the delivery came from, as `destinationOf` names it. */
  destination: { externalId: string; externalKey?: string }
  /** The item's id in that destination (GitHub: the issue number). */
  externalId: string
  externalDisplayId: string
  externalUrl: string | null
  ticketId: string
  /** The connection the marker names; absent when only a link names the ticket. */
  integrationId?: string
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
   * For a provider with `destination.multiple`: which destination an incoming
   * delivery claims to come from, read from the unverified body only to pick
   * the secret to verify it with. Null when the body names none. Nothing is
   * trusted or written until the signature checks out with that secret.
   */
  destinationOf?(
    body: string,
    headers: Headers
  ): { externalId: string; externalKey?: string } | null

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

  /**
   * Runs in the durable worker beside `parseStatusChange`, on the same signed
   * receipt: the assignee change a delivery reports, or null for any other
   * delivery and for the connection's own changes coming back. Linked tickets
   * follow it in destinations that switch assignee sync on
   * (`sync/assignees.ts`).
   */
  parseAssigneeChange?(body: string, config: Record<string, unknown>): InboundAssigneeChange | null

  /**
   * Runs in the durable worker beside `parseStatusChange`, on the same signed
   * receipt: the comment change a delivery reports, or null for any other
   * delivery. The connection's own comments are reported too (flagged
   * `byConnection`), so one that stands for a ticket reply can be recognised.
   * Tickets linked to the item take it in destinations that set a
   * `commentVisibility` (`sync/inbound-comments.ts`).
   */
  parseCommentChange?(body: string, config: Record<string, unknown>): InboundCommentChange | null

  /**
   * Runs in the durable worker beside `parseStatusChange`, on the same signed
   * receipt: the ticket the item a delivery is about names as its own, or
   * null. When no link to that item exists, Sync history proposes linking it
   * for a teammate to confirm (`sync/ticket-recovery.ts`); nothing is linked
   * on its say-so.
   */
  parseTicketReference?(body: string): InboundTicketReference | null
}
