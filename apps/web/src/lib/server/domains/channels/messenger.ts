import { deliverAgentMessageOnChannel } from './deliver-agent-message'
import type { ChannelAdapter } from './types'

/**
 * First-party messenger: the widget/portal is the thread. Agent messages are
 * still emailed as offline notifications; lifecycle events stay in-thread.
 */
export const messengerAdapter: ChannelAdapter = {
  id: 'messenger',

  deliverAgentMessage: (ctx) => deliverAgentMessageOnChannel('messenger', ctx),

  async deliverLifecycleEvent() {
    // The widget already shows the system message. No mailbox to notify.
  },

  async deliverCsatRequest() {
    // CSAT is the in-widget block. Email rating links are the email adapter.
  },
}
