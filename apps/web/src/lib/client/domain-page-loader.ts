/**
 * What a domain's own page loads: the domain itself (its ownership record and
 * whether any use holds it), the summaries the Domains list reads, for a
 * viewer who manages email sending, the email config behind the email
 * card (its DNS records and addresses), and on Cloud, for a viewer who
 * manages custom domains, the web addresses the operator routes here. The route loader imports this when it
 * runs, so only the import rides in the app entry.
 */
import type { QueryClient } from '@tanstack/react-query'
import { EMAIL_SENDING_PERMISSION } from '@/lib/shared/email-sending-permissions'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { emailChannelConfigQuery } from '@/lib/client/queries/channel-accounts'
import { getDomainFn, type DomainDetail } from '@/lib/server/functions/domains'
import { getCloudCustomDomainsFn, type WebAddress } from '@/lib/server/functions/cloud-identity'
import { loadDomainSummaries, type DomainSummaries } from './domain-summaries'

export interface DomainPageData extends DomainSummaries {
  /** Null when it could not be read: the uses still show. */
  domain: DomainDetail | null
  /** Cloud's web addresses; empty off Cloud or when they could not be read. */
  webAddresses: WebAddress[]
}

export async function loadDomainPage(
  context: {
    permissions?: readonly string[]
    cloudEnabled?: boolean
    queryClient: QueryClient
  },
  name: string
): Promise<DomainPageData> {
  const [summaries, domain, webAddresses] = await Promise.all([
    loadDomainSummaries(context),
    getDomainFn({ data: { name } }).catch(() => null),
    context.cloudEnabled && context.permissions?.includes(PERMISSIONS.SETTINGS_CUSTOM_DOMAIN)
      ? getCloudCustomDomainsFn().catch(() => [] as WebAddress[])
      : ([] as WebAddress[]),
    // The card says where the domain stands without it, so a failed read
    // (a prefetch never throws) does not fail the page.
    context.permissions?.includes(EMAIL_SENDING_PERMISSION)
      ? context.queryClient.prefetchQuery(emailChannelConfigQuery())
      : null,
  ])
  return { ...summaries, domain, webAddresses }
}
