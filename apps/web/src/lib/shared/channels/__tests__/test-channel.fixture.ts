import type { Channel } from '@/lib/shared/conversation/types'
import type { ChannelDescriptor } from '../types'

/** Test-only fixture id. Never registered in production. */
export const TEST_CHANNEL_ID = 'test_channel' as Channel

export const testChannelDescriptor: ChannelDescriptor = {
  id: TEST_CHANNEL_ID,
  label: 'Test channel',
  icon: 'email',
  surface: 'theirs',
  threading: 'per-thread',
  reopenOnReply: 'always',
  accountRoles: ['connection'],
  richText: 'limited',
  addressing: 'thread',
  closeSurface: 'native',
}
