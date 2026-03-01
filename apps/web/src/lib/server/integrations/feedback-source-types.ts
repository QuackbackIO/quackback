/**
 * Feedback source connector types.
 *
 * Shared interfaces at the integrations root level, matching the pattern of
 * inbound-types.ts and user-sync-types.ts. Implementations are colocated
 * per integration directory.
 */

import type { IntegrationId, PrincipalId } from '@quackback/ids'
import type {
  RawFeedbackAuthor,
  RawFeedbackContent,
  RawFeedbackItemContextEnvelope,
} from '@/lib/server/db'

export type FeedbackSourceType =
  | 'slack'
  | 'teams'
  | 'zendesk'
  | 'intercom'
  | 'discord'
  | 'github'
  | 'hubspot'
  | 'freshdesk'
  | 'salesforce'
  | 'email'
  | 'csv'
  | 'api'
  | 'quackback'

export type FeedbackDeliveryMode = 'webhook' | 'poll' | 'batch' | 'passive'

export interface FeedbackConnectorContext {
  sourceId: string
  sourceType: FeedbackSourceType
  integrationId?: IntegrationId
  actorPrincipalId?: PrincipalId
}

export interface RawFeedbackSeed {
  externalId: string
  externalUrl?: string
  sourceCreatedAt: Date
  author: RawFeedbackAuthor
  content: RawFeedbackContent
  contextEnvelope?: RawFeedbackItemContextEnvelope
}

/** Webhook-push sources (Slack, Intercom, Discord, GitHub, Teams). Mirrors InboundWebhookHandler's verify+parse pattern. */
export interface FeedbackWebhookConnector {
  readonly sourceType: FeedbackSourceType

  verifyWebhook(request: Request, rawBody: string, secret: string): Promise<true | Response>

  parseWebhook(args: {
    request: Request
    rawBody: string
    context: FeedbackConnectorContext
  }): Promise<RawFeedbackSeed[]>

  enrich?(item: {
    id: string
    sourceId: string
    contextEnvelope: RawFeedbackItemContextEnvelope
  }): Promise<RawFeedbackItemContextEnvelope>

  onSourceDisconnect?(
    sourceConfig: Record<string, unknown>,
    secrets: Record<string, unknown>
  ): Promise<void>
}

/** Poll/sync sources (Zendesk, HubSpot, Freshdesk, Salesforce). Orchestrator manages cursor state on feedback_sources row. */
export interface FeedbackPollConnector {
  readonly sourceType: FeedbackSourceType

  poll(args: {
    cursor?: string
    since?: Date
    limit: number
    context: FeedbackConnectorContext
  }): Promise<{ items: RawFeedbackSeed[]; nextCursor?: string; hasMore: boolean }>

  enrich?(item: {
    id: string
    sourceId: string
    contextEnvelope: RawFeedbackItemContextEnvelope
  }): Promise<RawFeedbackItemContextEnvelope>

  onSourceDisconnect?(
    sourceConfig: Record<string, unknown>,
    secrets: Record<string, unknown>
  ): Promise<void>
}

/** Batch/import sources (CSV, migration scripts). Not part of IntegrationDefinition. */
export interface FeedbackBatchConnector {
  readonly sourceType: FeedbackSourceType

  parseBatch(args: {
    fileName: string
    mimeType: string
    content: string
    context: FeedbackConnectorContext
  }): Promise<{ items: RawFeedbackSeed[]; errors: Array<{ row: number; message: string }> }>
}

/** Union type for IntegrationDefinition.feedbackSource attachment. */
export type FeedbackConnector = FeedbackWebhookConnector | FeedbackPollConnector
