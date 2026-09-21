import { AsyncLocalStorage } from 'node:async_hooks'
import type { SyncOutcome } from './types'

interface Evidence {
  writes: number
  rejectedStatus?: number
  ambiguous: boolean
}
const evidence = new AsyncLocalStorage<Evidence>()

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
      if (response.status >= 400 && response.status < 500) current.rejectedStatus = response.status
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
    } catch {
      outcome = { state: 'uncertain', errorCode: 'outcome_unknown' }
    }
    if (outcome.state === 'succeeded') return outcome
    if (current.ambiguous || current.writes > 0)
      return { state: 'uncertain', errorCode: 'outcome_unknown' }
    if (current.rejectedStatus === 401 || current.rejectedStatus === 403)
      return { state: 'auth_required', errorCode: 'authentication' }
    if (current.rejectedStatus === 429) return { state: 'retry_wait', errorCode: 'unavailable' }
    if (current.rejectedStatus) return { state: 'failed', errorCode: 'provider_failed' }
    return outcome
  })
}
