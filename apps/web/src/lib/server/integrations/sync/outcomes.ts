import type { HookHandler } from '@/lib/server/events/hook-types'
import type { SyncOutcome } from './types'

/** Success, confirmed rejection, or an unknown remote outcome. No retry hints without evidence. */
export type DeliveryOutcome =
  | { state: 'succeeded'; result?: Record<string, unknown> }
  | {
      state: 'failed' | 'auth_required' | 'retry_wait' | 'uncertain'
      errorCode?: 'provider_failed' | 'authentication' | 'unavailable' | 'outcome_unknown'
      retryAfterMs?: number
    }

export interface IntegrationHook extends Omit<HookHandler, 'run'> {
  run(...args: Parameters<HookHandler['run']>): Promise<DeliveryOutcome>
}

export function retryDelayMs(value: string | null): number | undefined {
  if (!value) return undefined
  const seconds = Number(value)
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now()
  return Number.isFinite(delay) && delay >= 0 ? Math.ceil(delay) : undefined
}

export function httpDeliveryFailure(
  response: Pick<Response, 'status' | 'headers'>
): DeliveryOutcome {
  return deliveryError({
    status: response.status,
    retryAfterMs: retryDelayMs(response.headers.get('retry-after')),
  })
}

/** A status is accepted only from a received response, never inferred from error text. */
export function deliveryError(error: unknown): DeliveryOutcome {
  const data =
    error && typeof error === 'object' ? (error as { status?: unknown; retryAfterMs?: number }) : {}
  const status = Number(data.status)
  if (status === 401 || status === 403)
    return { state: 'auth_required', errorCode: 'authentication' }
  if (status === 429)
    return {
      state: 'retry_wait',
      errorCode: 'unavailable',
      ...(data.retryAfterMs !== undefined ? { retryAfterMs: data.retryAfterMs } : {}),
    }
  if (status >= 400 && status < 500) return { state: 'failed', errorCode: 'provider_failed' }
  return { state: 'uncertain', errorCode: 'outcome_unknown' }
}

/** A compound app action cannot prove rejection from just its final error. */
export function syncErrorOutcome(error: unknown, dispatched: boolean): SyncOutcome {
  if (dispatched) return { state: 'uncertain', errorCode: 'outcome_unknown' }
  const result = deliveryError(error)
  return result.state === 'uncertain' ? { state: 'retry_wait', errorCode: 'unavailable' } : result
}
