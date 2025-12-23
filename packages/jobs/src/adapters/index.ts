/**
 * Adapter factory for job and state management.
 *
 * Uses BullMQ + Redis for job processing and state management.
 */

import type { JobAdapter, StateAdapter } from './types'

// Re-export types
export type { JobAdapter, StateAdapter, CircuitState, ProcessedEvent } from './types'
export { CIRCUIT_BREAKER_CONFIG, IDEMPOTENCY_CONFIG } from './types'

// Singleton instances for adapters
let _jobAdapter: JobAdapter | null = null
let _stateAdapter: StateAdapter | null = null

/**
 * Get the job adapter.
 *
 * @returns JobAdapter instance (BullMQ)
 */
export function getJobAdapter(): JobAdapter {
  if (!_jobAdapter) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { BullMQJobAdapter } = require('./bullmq/job-adapter')
    _jobAdapter = new BullMQJobAdapter()
  }
  return _jobAdapter!
}

/**
 * Get the state adapter.
 *
 * @returns StateAdapter instance (Redis)
 */
export function getStateAdapter(): StateAdapter {
  if (!_stateAdapter) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { RedisStateAdapter } = require('./bullmq/state-adapter')
    _stateAdapter = new RedisStateAdapter()
  }
  return _stateAdapter!
}

/**
 * Close all adapter connections (for graceful shutdown).
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
