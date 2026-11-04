import { queryOptions } from '@tanstack/react-query'
import {
  getEmailChannelConfigFn,
  type EmailChannelConfigDTO,
} from '@/lib/server/functions/channel-accounts'

export const emailChannelKeys = {
  config: () => ['email-channel-config'] as const,
}

/** How often the card re-reads while a domain is being checked automatically. */
const AUTO_CHECK_POLL_MS = 60 * 1000

/** Is any domain pending inside its automatic check window? */
function autoChecking(config: EmailChannelConfigDTO | undefined, now = Date.now()): boolean {
  return (config?.domains ?? []).some(
    (d) =>
      d.status === 'pending' &&
      d.autoCheckUntil !== null &&
      new Date(d.autoCheckUntil).getTime() > now
  )
}

/**
 * The workspace email channel config (inbound route, sending addresses, domains).
 *
 * Polls while a domain is being checked in the background, so a domain that
 * goes live shows it without a reload, and stops once none is.
 */
export const emailChannelConfigQuery = () =>
  queryOptions({
    queryKey: emailChannelKeys.config(),
    queryFn: () => getEmailChannelConfigFn(),
    staleTime: 60 * 1000,
    refetchInterval: (query) => (autoChecking(query.state.data) ? AUTO_CHECK_POLL_MS : false),
  })
