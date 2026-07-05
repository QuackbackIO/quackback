/**
 * Connector health badge classification from the circuit-breaker fields
 * (status/failureCount). Mirrors the webhook breaker's active/issues/failing/
 * auto-disabled scheme and thresholds (webhooks-settings.tsx) since
 * connector.execute.ts's MAX_FAILURES uses the same value.
 */
import type { ConnectorStatus } from '@/lib/server/domains/connectors/connector.types'

const MAX_FAILURES = 50
const FAILING_THRESHOLD = 25

export type ConnectorHealthVariant = 'default' | 'secondary' | 'destructive' | 'outline'

export interface ConnectorHealth {
  variant: ConnectorHealthVariant
  label: string
  title?: string
}

export function getConnectorHealth(connector: {
  status: ConnectorStatus
  failureCount: number
}): ConnectorHealth {
  const { status, failureCount } = connector

  if (status === 'disabled') {
    if (failureCount >= MAX_FAILURES) {
      return {
        variant: 'destructive',
        label: 'Auto-disabled',
        title: `Auto-disabled after ${failureCount} failures`,
      }
    }
    return { variant: 'secondary', label: 'Disabled' }
  }

  if (failureCount >= FAILING_THRESHOLD) {
    return {
      variant: 'destructive',
      label: `Failing (${failureCount}/${MAX_FAILURES})`,
      title: `${failureCount} consecutive failures`,
    }
  }

  if (failureCount > 0) {
    return {
      variant: 'outline',
      label: `Issues (${failureCount})`,
      title: `${failureCount} consecutive failures`,
    }
  }

  return { variant: 'default', label: 'Active' }
}
