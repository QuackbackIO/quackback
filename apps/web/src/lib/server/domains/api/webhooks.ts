/**
 * Webhook API helpers.
 * Shared utilities for webhook routes.
 */

import type { Webhook } from '@/lib/server/domains/webhooks'

/**
 * Format a webhook for API response.
 * Converts dates to ISO strings. Secret is never returned (encrypted at rest).
 */
export function toWebhookResponse(webhook: Webhook) {
  return {
    id: webhook.id,
    url: webhook.url,
    events: webhook.events,
    boardIds: webhook.boardIds,
    status: webhook.status,
    failureCount: webhook.failureCount,
    lastError: webhook.lastError,
    lastTriggeredAt: webhook.lastTriggeredAt?.toISOString() ?? null,
    createdAt: webhook.createdAt.toISOString(),
    updatedAt: webhook.updatedAt.toISOString(),
  }
}

/**
 * Format a webhook for API list response (excludes lastError).
 */
export function toWebhookListResponse(webhook: Webhook) {
  return {
    id: webhook.id,
    url: webhook.url,
    events: webhook.events,
    boardIds: webhook.boardIds,
    status: webhook.status,
    failureCount: webhook.failureCount,
    lastTriggeredAt: webhook.lastTriggeredAt?.toISOString() ?? null,
    createdAt: webhook.createdAt.toISOString(),
    updatedAt: webhook.updatedAt.toISOString(),
  }
}

/**
 * Webhook update data type for PATCH requests.
 */
export interface WebhookUpdateData {
  url?: string
  events?: string[]
  boardIds?: string[] | null
  status?: 'active' | 'disabled'
  failureCount?: number
  lastError?: string | null
  updatedAt: Date
}
