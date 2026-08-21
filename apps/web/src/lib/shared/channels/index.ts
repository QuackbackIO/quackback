import { emailDescriptor } from './email'
import { messengerDescriptor } from './messenger'
import { registerChannelDescriptor } from './registry'

registerChannelDescriptor(messengerDescriptor)
registerChannelDescriptor(emailDescriptor)

export type {
  Channel,
  ChannelAccountRole,
  ChannelDescriptor,
  ChannelIcon,
  ChannelReopenOnReply,
  ChannelRichText,
  ChannelSurface,
  ChannelThreading,
} from './types'
export {
  channelFromVisitorTransport,
  channelLabelMap,
  getChannelDescriptor,
  isChannel,
  listChannelDescriptors,
  parseChannel,
  registerChannelDescriptor,
  unregisterChannelDescriptor,
  requireChannelDescriptor,
} from './registry'
export { emailDescriptor } from './email'
export { messengerDescriptor } from './messenger'
