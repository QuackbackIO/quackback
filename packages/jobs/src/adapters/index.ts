/**
 * Adapter factory for job and state management.
 *
 * Automatically selects the appropriate adapter based on runtime environment:
 * - Cloudflare Workers: Uses Workflows + Durable Objects
 * - Node.js/Bun: Uses BullMQ + Redis
 */

import type { JobAdapter, StateAdapter } from './types'
import { isCloudflareWorker } from './runtime'

// Re-export types
export type { JobAdapter, StateAdapter, CircuitState, ProcessedEvent } from './types'
export { CIRCUIT_BREAKER_CONFIG, IDEMPOTENCY_CONFIG } from './types'
export { isCloudflareWorker } from './runtime'

/**
 * Cloudflare environment type (for type safety when passing env)
 */
export interface CloudflareEnv {
  IMPORT_WORKFLOW?: unknown
  INTEGRATION_WORKFLOW?: unknown
  NOTIFICATION_WORKFLOW?: unknown
  INTEGRATION_STATE?: unknown
}

// Singleton instances for adapters
let _jobAdapter: JobAdapter | null = null
let _stateAdapter: StateAdapter | null = null

/**
 * Get the job adapter for the current runtime environment.
 *
 * @param env - Cloudflare environment (required in CF Workers)
 * @returns JobAdapter instance
 */
export function getJobAdapter(env?: CloudflareEnv): JobAdapter {
  // In Cloudflare Workers, we need a new adapter per request (env is request-scoped)
  if (isCloudflareWorker()) {
    if (!env) {
      throw new Error('Cloudflare environment required in Workers runtime')
    }
    // Dynamic import to avoid bundling CF-specific code in Node.js
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { WorkflowJobAdapter } = require('./cloudflare/job-adapter')
    return new WorkflowJobAdapter(env)
  }

  // In Node.js/Bun, use singleton pattern
  if (!_jobAdapter) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { BullMQJobAdapter } = require('./bullmq/job-adapter')
    _jobAdapter = new BullMQJobAdapter()
  }
  return _jobAdapter!
}

/**
 * Get the state adapter for the current runtime environment.
 *
 * @param env - Cloudflare environment (required in CF Workers)
 * @returns StateAdapter instance
 */
export function getStateAdapter(env?: CloudflareEnv): StateAdapter {
  // In Cloudflare Workers, we need a new adapter per request
  if (isCloudflareWorker()) {
    if (!env) {
      throw new Error('Cloudflare environment required in Workers runtime')
    }
    // Dynamic import to avoid bundling CF-specific code in Node.js
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DurableObjectStateAdapter } = require('./cloudflare/state-adapter')
    return new DurableObjectStateAdapter(env)
  }

  // In Node.js/Bun, use singleton pattern
  if (!_stateAdapter) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { RedisStateAdapter } = require('./bullmq/state-adapter')
    _stateAdapter = new RedisStateAdapter()
  }
  return _stateAdapter!
}

/**
 * Close all adapter connections (for graceful shutdown).
 * Only applicable in Node.js/Bun environment.
 */
export async function closeAdapters(): Promise<void> {
  if (_jobAdapter?.close) {
    await _jobAdapter.close()
    _jobAdapter = null
  }
  if (_stateAdapter && 'close' in _stateAdapter) {
    await (_stateAdapter as { close(): Promise<void> }).close()
    _stateAdapter = null
  }
}
