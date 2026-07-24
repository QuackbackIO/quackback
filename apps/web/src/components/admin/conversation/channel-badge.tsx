import { EnvelopeIcon } from '@heroicons/react/24/solid'
import type { Channel } from '@/lib/shared/conversation/types'

/** Every channel's display label — shared by the badge below and any surface
 *  that needs to name the channel outright (e.g. the inbox detail panel's
 *  Properties row, which shows "Messenger" too, unlike the badge). */
export const CHANNEL_LABEL: Record<Channel, string> = {
  messenger: 'Messenger',
  email: 'Email',
}

/** Badge showing a non-default arrival channel; renders nothing for messenger. */
export function ChannelBadge({ channel }: { channel: Channel }) {
  if (channel === 'messenger') return null
  const label = CHANNEL_LABEL[channel]
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
      {channel === 'email' && <EnvelopeIcon className="h-2.5 w-2.5" />}
      {label}
    </span>
  )
}

/** Flags to an agent that an offline reply has no address to reach. */
export function NoEmailBadge() {
  return (
    <span className="inline-flex items-center rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-medium text-amber-600">
      No email
    </span>
  )
}
