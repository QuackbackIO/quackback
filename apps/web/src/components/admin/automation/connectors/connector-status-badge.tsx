import { StateBadge } from '@/components/shared/state-badge'
import type { ConnectorStatus } from '@/lib/shared/assistant/connectors'

export function ConnectorStatusBadge({ status }: { status: ConnectorStatus }) {
  if (status === 'connected') return <StateBadge state="connected" />
  if (status === 'error') return <StateBadge state="attention" />
  return <StateBadge state="off" />
}
