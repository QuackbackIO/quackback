import type { Channel } from '@/lib/shared/conversation/types'

export type { Channel }

/** Icon key the UI maps to a heroicon. Descriptors stay client-safe. */
export type ChannelIcon = 'messenger' | 'email'

export type ChannelSurface = 'ours' | 'theirs'
export type ChannelThreading = 'per-peer' | 'per-thread'
export type ChannelReopenOnReply = 'always' | 'configurable'
export type ChannelAccountRole = 'inbound' | 'sending' | 'connection'
export type ChannelRichText = 'full' | 'limited'

/**
 * Client-safe channel metadata. UI (badges, filters, settings, analytics,
 * workflow triggers) reads this and never imports server adapters.
 */
export interface ChannelDescriptor {
  id: Channel
  label: string
  icon: ChannelIcon
  /** ours = presence-gated widget/portal; theirs = their mailbox/app, always deliver. */
  surface: ChannelSurface
  threading: ChannelThreading
  reopenOnReply: ChannelReopenOnReply
  accountRoles: ChannelAccountRole[]
  richText: ChannelRichText
}
