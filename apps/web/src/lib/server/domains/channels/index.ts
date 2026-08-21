import { emailAdapter } from './email'
import { messengerAdapter } from './messenger'
import { registerChannelAdapter } from './registry'

registerChannelAdapter(messengerAdapter)
registerChannelAdapter(emailAdapter)

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
export { messengerAdapter } from './messenger'
