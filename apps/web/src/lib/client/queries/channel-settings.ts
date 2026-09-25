import { queryOptions } from '@tanstack/react-query'
import {
  fetchConversationRoutingFn,
  fetchEmailAutoAckFn,
  getEmailChannelStatusFn,
} from '@/lib/server/functions/settings'
import { listRecentEmailLogFn } from '@/lib/server/functions/channel-accounts'

/**
 * The reads behind the Channels settings pages, shared by each page's loader
 * (which warms them into the document) and the cards that read them. The
 * GitHub channel's status lives with the integration
 * (githubChannelStatusQuery).
 */
export const channelSettingsQueries = {
  /** Outbound provider, from-address and inbound domain (settings.manage). */
  emailStatus: () =>
    queryOptions({
      queryKey: ['settings', 'email-channel-status'],
      queryFn: () => getEmailChannelStatusFn(),
      staleTime: 60_000,
    }),

  /** The conversation routing switch on the Channels hub (settings.manage). */
  routing: () =>
    queryOptions({
      queryKey: ['conversation-routing'],
      queryFn: () => fetchConversationRoutingFn(),
    }),

  /** Email auto-acknowledgement (channel_account.manage). */
  emailAutoAck: () =>
    queryOptions({
      queryKey: ['email-auto-ack'],
      queryFn: () => fetchEmailAutoAckFn(),
    }),

  /** Recent sent and received mail (channel_account.manage). */
  emailActivity: () =>
    queryOptions({
      queryKey: ['email-activity'],
      queryFn: () => listRecentEmailLogFn(),
    }),
}
