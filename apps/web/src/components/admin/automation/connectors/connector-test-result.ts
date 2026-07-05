/**
 * Maps a connector test call's discriminated result onto the title/detail the
 * test panel renders. Kept separate from the panel component so the mapping
 * (one branch per ConnectorExecutionResult reason) can be tested without a
 * DOM.
 */
import type { ConnectorExecutionResult } from '@/lib/server/domains/connectors/connector.types'

export interface ConnectorTestOutcome {
  ok: boolean
  title: string
  detail?: string
}

export function describeConnectorTestResult(result: ConnectorExecutionResult): ConnectorTestOutcome {
  if (result.ok) {
    return { ok: true, title: `Success (HTTP ${result.status})` }
  }

  switch (result.reason) {
    case 'rate_limited':
      return {
        ok: false,
        title: 'Rate limited',
        detail: 'This connector has made too many calls in the last minute. Try again shortly.',
      }
    case 'host_not_allowed':
      return { ok: false, title: 'Host not allowed', detail: result.message }
    case 'http_error':
      return { ok: false, title: `HTTP error (${result.status})`, detail: result.message }
    case 'network_error':
      return { ok: false, title: 'Network error', detail: result.message }
  }
}
