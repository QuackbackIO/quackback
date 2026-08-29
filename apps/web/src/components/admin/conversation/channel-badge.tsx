import { ChatBubbleLeftRightIcon, EnvelopeIcon } from '@heroicons/react/24/solid'
import type { Channel } from '@/lib/shared/conversation/types'
import { channelLabelMap, getChannelDescriptor } from '@/lib/shared/channels'
import { GitHubIcon } from '@/components/icons/integration-icons'

/** Every channel's display label — sourced from the descriptor registry. */
export const CHANNEL_LABEL: Record<Channel, string> = channelLabelMap()

const CHANNEL_ICON = {
  messenger: ChatBubbleLeftRightIcon,
  email: EnvelopeIcon,
  github: GitHubIcon,
} as const

/** Badge showing a non-default (their-surface) channel; first-party messenger is silent. */
export function ChannelBadge({ channel }: { channel: Channel }) {
  const descriptor = getChannelDescriptor(channel)
  if (!descriptor || descriptor.surface === 'ours') return null
  const label = descriptor.label
  const Icon = CHANNEL_ICON[descriptor.icon]
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
      <Icon className="h-2.5 w-2.5" />
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

/** Unreachable on the conversation's current channel. */
export function UnreachableBadge({ channel }: { channel: Channel }) {
  const label = getChannelDescriptor(channel)?.label ?? 'channel'
  return (
    <span className="inline-flex items-center rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-medium text-amber-600">
      Unreachable on {label}
    </span>
  )
}
