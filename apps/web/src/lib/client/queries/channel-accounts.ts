import { queryOptions } from '@tanstack/react-query'
import type { AddedDomainSummary } from '@/lib/server/functions/domains'
import {
  getEmailChannelConfigFn,
  getSurfaceSenderFn,
  type EmailChannelConfigDTO,
} from '@/lib/server/functions/channel-accounts'

import type { ProductSenderSurface } from '@/lib/shared/email-sending-permissions'

export const emailChannelKeys = {
  config: () => ['email-channel-config'] as const,
  /** Under the config key, so every sender change refreshes it too. */
  surfaceSender: (surface: ProductSenderSurface) =>
    ['email-channel-config', 'sender', surface] as const,
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

/**
 * The domains added by name on Settings > Domains, which Add sending address
 * (and Add custom domain) build on and Verify domain links to. Here because
 * the email pages already load this module; read only when asked for, and
 * readable with any Domains page permission.
 */
export const addedDomainsQuery = () =>
  queryOptions({
    queryKey: ['settings', 'added-domains'],
    staleTime: 30_000,
    queryFn: async (): Promise<AddedDomainSummary[]> =>
      (await import('@/lib/server/functions/domains')).listDomainsFn(),
  })

/** The names of the Verified domains among them. */
export const verifiedDomainNames = (domains: readonly AddedDomainSummary[]): string[] =>
  domains.filter((d) => d.verified).map((d) => d.name)

/** The From one kind of email goes out under now, for its product's settings page. */
export const surfaceSenderQuery = (surface: ProductSenderSurface) =>
  queryOptions({
    queryKey: emailChannelKeys.surfaceSender(surface),
    queryFn: () => getSurfaceSenderFn({ data: { surface } }),
    staleTime: 60 * 1000,
  })
