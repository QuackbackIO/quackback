import type { HookResult } from '@/lib/server/events/hook-types'
import type { SyncOutcome } from './types'

/** Once dispatch begins, unknown transport errors are not evidence of rejection. */
export function syncErrorOutcome(error: unknown, dispatched: boolean): SyncOutcome {
  const status =
    error && typeof error === 'object' ? Number((error as { status?: unknown }).status) : 0
  if (status === 401 || status === 403)
    return { state: 'auth_required', errorCode: 'authentication' }
  if (status === 429) return { state: 'retry_wait', errorCode: 'unavailable' }
  if (status >= 400 && status < 500) return { state: 'failed', errorCode: 'provider_failed' }
  return dispatched
    ? { state: 'uncertain', errorCode: 'outcome_unknown' }
    : { state: 'retry_wait', errorCode: 'unavailable' }
}

export function hookSyncOutcome(result: HookResult): SyncOutcome {
  if (result.success)
    return {
      state: 'succeeded',
      result: {
        ...(result.externalId ? { externalId: result.externalId } : {}),
        ...(result.externalDisplayId ? { externalDisplayId: result.externalDisplayId } : {}),
        ...(result.externalUrl ? { externalUrl: result.externalUrl } : {}),
      },
    }
  if (result.authExpired) return { state: 'auth_required', errorCode: 'authentication' }
  if (result.deliveryOutcome === 'rejected')
    return result.shouldRetry
      ? { state: 'retry_wait', errorCode: 'unavailable' }
      : { state: 'failed', errorCode: 'provider_failed' }
  // Legacy adapters cannot prove a failed response means no side effect.
  return { state: 'uncertain', errorCode: 'outcome_unknown' }
}
