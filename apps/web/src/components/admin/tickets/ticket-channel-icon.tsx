/**
 * Channel icon for tickets. Maps the channel to a Heroicon.
 */
import {
  EnvelopeIcon,
  GlobeAltIcon,
  CodeBracketIcon,
  ChatBubbleBottomCenterTextIcon,
} from '@heroicons/react/24/outline'
import { cn } from '@/lib/shared/utils'

export type TicketChannel = 'email' | 'portal' | 'api' | 'widget'

export interface TicketChannelIconProps {
  channel: TicketChannel
  className?: string
}

const iconMap: Record<TicketChannel, typeof EnvelopeIcon> = {
  email: EnvelopeIcon,
  portal: GlobeAltIcon,
  api: CodeBracketIcon,
  widget: ChatBubbleBottomCenterTextIcon,
}

export function TicketChannelIcon({ channel, className }: TicketChannelIconProps) {
  const Icon = iconMap[channel]
  return <Icon className={cn('h-4 w-4 text-muted-foreground', className)} aria-label={channel} />
}
