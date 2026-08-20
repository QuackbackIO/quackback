import type { ChannelDescriptor } from './types'

export const messengerDescriptor: ChannelDescriptor = {
  id: 'messenger',
  label: 'Messenger',
  icon: 'messenger',
  surface: 'ours',
  threading: 'per-peer',
  reopenOnReply: 'configurable',
  accountRoles: [],
  richText: 'full',
}
