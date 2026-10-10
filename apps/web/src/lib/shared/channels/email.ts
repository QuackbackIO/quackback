import type { ChannelDescriptor } from './types'

export const emailDescriptor: ChannelDescriptor = {
  id: 'email',
  label: 'Email',
  icon: 'email',
  surface: 'theirs',
  threading: 'per-thread',
  reopenOnReply: 'always',
  accountRoles: ['inbound', 'sending'],
  richText: 'full',
  addressing: 'email',
  closeSurface: 'mailbox',
}
