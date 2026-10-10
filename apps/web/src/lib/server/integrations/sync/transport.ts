import { AsyncLocalStorage } from 'node:async_hooks'
import type { SyncOutcome } from './types'
import { deliveryError, httpDeliveryFailure, type DeliveryOutcome } from './outcomes'

interface Evidence {
  writes: number
  rejection?: DeliveryOutcome
  ambiguous: boolean
}
const evidence = new AsyncLocalStorage<Evidence>()

/** SDK adapters report the same evidence as fetch adapters. */
export function recordDeliveryOutcome(outcome: DeliveryOutcome): void {
  const current = evidence.getStore()
  if (!current) return
  if (outcome.state === 'succeeded') current.writes++
  else if (outcome.state === 'uncertain') current.ambiguous = true
  else current.rejection = outcome
}

/** Bounded transport for provider adapters. Never retries a request internally. */
export async function integrationFetch(
  input: string | URL | Request,
  init?: RequestInit
): Promise<Response> {
  const current = evidence.getStore()
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
  const write = !['GET', 'HEAD', 'OPTIONS'].includes(method)
  const originalSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined)
  const timeout = AbortSignal.timeout(20_000)
  try {
    const response = await fetch(input, {
      ...init,
      signal: originalSignal ? AbortSignal.any([originalSignal, timeout]) : timeout,
    })
    if (current && write) {
      if (response.status >= 400 && response.status < 500)
        current.rejection = httpDeliveryFailure(response)
      else if (response.ok) current.writes++
      else current.ambiguous = true
    }
    return response
  } catch (error) {
    if (current && write) current.ambiguous = true
    throw error
  }
}

/** A later rejection cannot erase an earlier successful or ambiguous request. */
export async function withSyncTransport(run: () => Promise<SyncOutcome>): Promise<SyncOutcome> {
  const current: Evidence = { writes: 0, ambiguous: false }
  return evidence.run(current, async () => {
    let outcome: SyncOutcome
    try {
      outcome = await run()
    } catch (error) {
      outcome = deliveryError(error)
    }
    if (outcome.state === 'succeeded' && !current.ambiguous && !current.rejection) return outcome
    if (current.ambiguous || current.writes > 0)
      return { state: 'uncertain', errorCode: 'outcome_unknown' }
    if (current.rejection) return current.rejection
    return outcome
  })
}
