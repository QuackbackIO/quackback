import { useOptionalIntl } from '@/components/ui/use-optional-intl'
import { type MessageDescriptor } from 'react-intl'
import { Badge } from '@/components/ui/badge'

export type BadgeState =
  | 'on'
  | 'off'
  | 'paused'
  | 'connected'
  | 'verified'
  | 'setting-up'
  | 'pending'
  | 'attention'
  | 'error'

const STATES: Record<
  BadgeState,
  { label: MessageDescriptor; variant: 'secondary' | 'success' | 'warning' | 'destructive' }
> = {
  on: { label: { id: 'admin.shell.stateBadge.on', defaultMessage: 'On' }, variant: 'secondary' },
  off: { label: { id: 'admin.shell.stateBadge.off', defaultMessage: 'Off' }, variant: 'secondary' },
  paused: {
    label: { id: 'admin.shell.stateBadge.paused', defaultMessage: 'Paused' },
    variant: 'secondary',
  },
  connected: {
    label: { id: 'admin.shell.stateBadge.connected', defaultMessage: 'Connected' },
    variant: 'success',
  },
  verified: {
    label: { id: 'admin.shell.stateBadge.verified', defaultMessage: 'Verified' },
    variant: 'success',
  },
  'setting-up': {
    label: { id: 'admin.shell.stateBadge.settingUp', defaultMessage: 'Setting up' },
    variant: 'secondary',
  },
  pending: {
    label: { id: 'admin.shell.stateBadge.pending', defaultMessage: 'Pending' },
    variant: 'secondary',
  },
  attention: {
    label: { id: 'admin.shell.stateBadge.attention', defaultMessage: 'Needs attention' },
    variant: 'warning',
  },
  error: {
    label: { id: 'admin.shell.stateBadge.error', defaultMessage: 'Error' },
    variant: 'destructive',
  },
}

/**
 * The one state vocabulary. Render it only for a non-default state; a normal
 * state shows no badge.
 */
export function StateBadge({ state }: { state: BadgeState }) {
  const intl = useOptionalIntl()
  const { label, variant } = STATES[state]
  return (
    <Badge variant={variant} size="sm">
      {intl.formatMessage(label)}
    </Badge>
  )
}
