/**
 * What a domain's own page loads: the summaries the Domains list reads, and
 * for a viewer who manages email sending, the email config behind the email
 * card (its DNS records and addresses). The route loader imports this when it
 * runs, so only the import rides in the app entry.
 */
import type { QueryClient } from '@tanstack/react-query'
import { EMAIL_SENDING_PERMISSION } from '@/lib/shared/email-sending-permissions'
import { emailChannelConfigQuery } from '@/lib/client/queries/channel-accounts'
import { loadDomainSummaries, type DomainSummaries } from './domain-summaries'

export async function loadDomainPage(context: {
  permissions?: readonly string[]
  cloudEnabled?: boolean
  queryClient: QueryClient
}): Promise<DomainSummaries> {
  const [summaries] = await Promise.all([
    loadDomainSummaries(context),
    // The card says where the domain stands without it, so a failed read
    // (a prefetch never throws) does not fail the page.
    context.permissions?.includes(EMAIL_SENDING_PERMISSION)
      ? context.queryClient.prefetchQuery(emailChannelConfigQuery())
      : null,
  ])
  return summaries
}
