import type { Channel } from '@/lib/shared/conversation/types'

export type { Channel }

/** Icon key the UI maps to a channel icon. Descriptors stay client-safe. */
export type ChannelIcon = 'messenger' | 'email' | 'github'

export type ChannelSurface = 'ours' | 'theirs'
export type ChannelThreading = 'per-peer' | 'per-thread'
export type ChannelReopenOnReply = 'always' | 'configurable' | 'never'
/** How Close maps onto the customer's surface.
 *  session: our widget ends.
 *  mailbox: we send close mail; their mailbox has no close state.
 *  native: Close is their object's state (a GitHub issue). */
export type ChannelCloseSurface = 'session' | 'mailbox' | 'native'
/** Noun for native-close channels, used in Close/Reopen copy. */
export type ChannelNativeObject = 'issue'
export type ChannelAccountRole = 'inbound' | 'sending' | 'connection'
export type ChannelRichText = 'full' | 'limited'
/** How the adapter addresses the customer. email-addressed channels need a
 *  deliverable mailbox before notify calls the adapter; thread-addressed
 *  channels (the customer's GitHub issue, etc.) always deliver. */
export type ChannelAddressing = 'email' | 'thread'

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
  addressing: ChannelAddressing
  closeSurface: ChannelCloseSurface
  /** Set when closeSurface is 'native'. */
  nativeObject?: ChannelNativeObject
}
