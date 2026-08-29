import { emailDescriptor } from './email'
import { githubDescriptor } from './github'
import { messengerDescriptor } from './messenger'
import { registerChannelDescriptor } from './registry'

registerChannelDescriptor(messengerDescriptor)
registerChannelDescriptor(emailDescriptor)
registerChannelDescriptor(githubDescriptor)

export type {
  Channel,
  ChannelAccountRole,
  ChannelAddressing,
  ChannelCloseSurface,
  ChannelDescriptor,
  ChannelIcon,
  ChannelNativeObject,
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
export { githubDescriptor, githubIssuePeopleFromMessages, githubIssueRefFromUrl } from './github'
export type { GitHubIssuePerson } from './github'
export { messengerDescriptor } from './messenger'
export {
  channelCloseActionLabel,
  channelCloseFailureToast,
  channelCloseSystemCopy,
  channelCloseToast,
  channelReplyPlaceholder,
  channelShowsEndConversation,
  isNativeIssueChannel,
} from './close'
