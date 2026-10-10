import { Badge } from '@/components/ui/badge'

export type BadgeState = 'on' | 'off' | 'paused' | 'connected' | 'attention' | 'error'

const STATES: Record<
  BadgeState,
  { label: string; variant: 'secondary' | 'success' | 'warning' | 'destructive' }
> = {
  on: { label: 'On', variant: 'secondary' },
  off: { label: 'Off', variant: 'secondary' },
  paused: { label: 'Paused', variant: 'secondary' },
  connected: { label: 'Connected', variant: 'success' },
  attention: { label: 'Needs attention', variant: 'warning' },
  error: { label: 'Error', variant: 'destructive' },
}

/**
 * The one state vocabulary. Render it only for a non-default state; a normal
 * state shows no badge.
 */
export function StateBadge({ state }: { state: BadgeState }) {
  const { label, variant } = STATES[state]
  return (
    <Badge variant={variant} size="sm">
      {label}
    </Badge>
  )
}
