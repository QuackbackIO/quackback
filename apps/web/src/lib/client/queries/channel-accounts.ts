import { queryOptions } from '@tanstack/react-query'
import { getEmailChannelConfigFn } from '@/lib/server/functions/channel-accounts'

export const emailChannelKeys = {
  config: () => ['email-channel-config'] as const,
}

/** The workspace email channel config (inbound route, sending addresses, domains). */
export const emailChannelConfigQuery = () =>
  queryOptions({
    queryKey: emailChannelKeys.config(),
    queryFn: () => getEmailChannelConfigFn(),
    staleTime: 60 * 1000,
  })
