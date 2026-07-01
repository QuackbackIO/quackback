import { EnvelopeIcon } from '@heroicons/react/24/solid'
import type { Channel } from '@/lib/shared/conversation/types'

const LABELS: Partial<Record<Channel, string>> = {
  email: 'Email',
  web_form: 'Web form',
}

/** Badge showing a non-default arrival channel; renders nothing for live chat. */
export function ChannelBadge({ channel }: { channel: Channel }) {
  const label = LABELS[channel]
  if (!label) return null
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
      {channel === 'email' && <EnvelopeIcon className="h-2.5 w-2.5" />}
      {label}
    </span>
  )
}

/** Flags to an agent that an offline reply has no address to reach. */
export function NoEmailBadge() {
  return (
    <span className="inline-flex items-center rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600">
      No email
    </span>
  )
}
