import { emailAdapter } from './email'
import { githubAdapter } from './github'
import { messengerAdapter } from './messenger'
import { registerChannelAdapter } from './registry'

registerChannelAdapter(messengerAdapter)
registerChannelAdapter(emailAdapter)
registerChannelAdapter(githubAdapter)

export type {
  AgentMessageDeliveryCtx,
  ChannelAdapter,
  CsatDeliveryCtx,
  LifecycleDeliveryCtx,
  LifecycleKind,
} from './types'
export {
  getChannelAdapter,
  listChannelAdapters,
  registerChannelAdapter,
  unregisterChannelAdapter,
  requireChannelAdapter,
} from './registry'
export { emailAdapter } from './email'
export { githubAdapter } from './github'
export { messengerAdapter } from './messenger'
