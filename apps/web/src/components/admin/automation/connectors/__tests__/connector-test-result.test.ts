import { describe, it, expect } from 'vitest'
import { describeConnectorTestResult } from '../connector-test-result'
import type { ConnectorExecutionResult } from '@/lib/server/domains/connectors/connector.types'

describe('describeConnectorTestResult', () => {
  it('describes a successful call', () => {
    const result: ConnectorExecutionResult = { ok: true, status: 200, data: { foo: 'bar' } }
    expect(describeConnectorTestResult(result)).toEqual({
      ok: true,
      title: 'Success (HTTP 200)',
    })
  })

  it('describes a rate-limited call', () => {
    const result: ConnectorExecutionResult = { ok: false, reason: 'rate_limited' }
    const outcome = describeConnectorTestResult(result)
    expect(outcome.ok).toBe(false)
    expect(outcome.title).toBe('Rate limited')
    expect(outcome.detail).toMatch(/too many calls/i)
  })

  it('describes a host-not-allowed call', () => {
    const result: ConnectorExecutionResult = {
      ok: false,
      reason: 'host_not_allowed',
      message: 'Host "evil.com" is not in CONNECTOR_ALLOWED_HOSTS',
    }
    expect(describeConnectorTestResult(result)).toEqual({
      ok: false,
      title: 'Host not allowed',
      detail: 'Host "evil.com" is not in CONNECTOR_ALLOWED_HOSTS',
    })
  })

  it('describes an HTTP error', () => {
    const result: ConnectorExecutionResult = {
      ok: false,
      reason: 'http_error',
      status: 500,
      message: 'HTTP 500',
    }
    expect(describeConnectorTestResult(result)).toEqual({
      ok: false,
      title: 'HTTP error (500)',
      detail: 'HTTP 500',
    })
  })

  it('describes a network error', () => {
    const result: ConnectorExecutionResult = {
      ok: false,
      reason: 'network_error',
      message: 'timed out',
    }
    expect(describeConnectorTestResult(result)).toEqual({
      ok: false,
      title: 'Network error',
      detail: 'timed out',
    })
  })
})
