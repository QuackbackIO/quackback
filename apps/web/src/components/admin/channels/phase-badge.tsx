import { StateBadge } from '@/components/shared/state-badge'
import type { DomainPhase } from './sending-domain-view'

/** No badge when live; Pending while being set up; Needs attention otherwise. */
export function PhaseBadge({ phase }: { phase: DomainPhase }) {
  if (phase === 'live') return null
  return <StateBadge state={phase === 'setting-up' ? 'pending' : 'attention'} />
}
