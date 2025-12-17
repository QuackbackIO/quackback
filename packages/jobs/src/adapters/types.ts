/**
 * Job and state adapter interfaces for dual-mode operation.
 *
 * These interfaces allow the job system to work with either:
 * - BullMQ + Redis (OSS/self-hosted deployments)
 * - Cloudflare Workflows + Durable Objects (Cloud deployments)
 */

import type {
  ImportJobData,
  ImportJobStatus,
  IntegrationJobData,
  UserNotificationJobData,
  EventJobData,
} from '../types'

/**
 * Job adapter interface for creating and querying jobs.
 * Implementations: BullMQJobAdapter, WorkflowJobAdapter
 */
export interface JobAdapter {
  /**
   * Add an import job to the queue/workflow.
   * @returns Job ID for status polling
   */
  addImportJob(data: ImportJobData): Promise<string>

  /**
   * Get the current status of an import job.
   * @returns Job status or null if not found
   */
  getImportJobStatus(jobId: string): Promise<ImportJobStatus | null>

  /**
   * Add an integration job to process a domain event.
   * @returns Job ID
   */
  addIntegrationJob(data: IntegrationJobData, options?: { jobId?: string }): Promise<string>

  /**
   * Add a user notification job to send emails to subscribers.
   * @returns Job ID
   */
  addUserNotificationJob(data: UserNotificationJobData): Promise<string>

  /**
   * Add an event job to process integrations and notifications.
   * This is the preferred method - consolidates integration + notification handling.
   * @returns Job ID
   */
  addEventJob(data: EventJobData): Promise<string>

  /**
   * Close all connections (for graceful shutdown).
   */
  close?(): Promise<void>
}

/**
 * State adapter interface for circuit breaker, idempotency, and caching.
 * Implementations: RedisStateAdapter, DurableObjectStateAdapter
 */
export interface StateAdapter {
  // Circuit breaker operations
  /**
   * Check if the circuit for an integration allows execution.
   * @returns true if circuit is closed or half-open, false if open
   */
  canExecute(integrationId: string): Promise<boolean>

  /**
   * Record a successful operation, closing the circuit.
   */
  recordSuccess(integrationId: string): Promise<void>

  /**
   * Record a failed operation, potentially opening the circuit.
   */
  recordFailure(integrationId: string): Promise<void>

  // Idempotency operations
  /**
   * Check if an event has already been processed for an integration.
   */
  isProcessed(eventId: string, integrationId: string): Promise<boolean>

  /**
   * Mark an event as processed for an integration.
   * @param externalId Optional external entity ID (e.g., Slack message ts)
   */
  markProcessed(eventId: string, integrationId: string, externalId?: string): Promise<void>

  /**
   * Get the external ID for a previously processed event.
   */
  getProcessedResult(eventId: string, integrationId: string): Promise<string | null>

  // Generic caching operations
  /**
   * Get a cached value by key.
   */
  get(key: string): Promise<string | null>

  /**
   * Set a cached value with optional TTL in seconds.
   */
  set(key: string, value: string, ttlSeconds?: number): Promise<void>

  /**
   * Delete a cached value.
   */
  del(key: string): Promise<void>
}

/**
 * Circuit breaker state (for reference in implementations)
 */
export interface CircuitState {
  state: 'closed' | 'open' | 'half-open'
  failures: number
  lastFailure: number
  lastSuccess: number
}

/**
 * Processed event record (for idempotency tracking)
 */
export interface ProcessedEvent {
  externalId?: string
  timestamp: number
}

/**
 * Circuit breaker configuration
 */
export const CIRCUIT_BREAKER_CONFIG = {
  /** Number of failures before circuit opens */
  failureThreshold: 5,
  /** Time in ms before circuit transitions from open to half-open */
  resetTimeout: 60_000,
  /** TTL for circuit state in seconds */
  stateTtl: 3600,
} as const

/**
 * Idempotency configuration
 */
export const IDEMPOTENCY_CONFIG = {
  /** TTL for processed event records in seconds (7 days) */
  ttl: 7 * 24 * 60 * 60,
} as const
