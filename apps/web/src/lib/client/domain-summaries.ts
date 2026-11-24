/**
 * The domain reads behind the Domains list and a domain's own page. Each is
 * made only for a holder of the permission that owns that use, so a viewer is
 * sent, and sees, only the uses they could act on. Loader-safe: it imports the
 * server functions and nothing that renders.
 */
import { PERMISSIONS } from '@/lib/shared/permissions'
import { EMAIL_SENDING_PERMISSION } from '@/lib/shared/email-sending-permissions'
import {
  getSendingDomainSummariesFn,
  getSignInDomainSummariesFn,
  type SendingDomainSummary,
  type SignInDomainSummary,
} from '@/lib/server/functions/domains-overview'
import {
  getSectionDomainsFn,
  type SectionDomainsView,
} from '@/lib/server/functions/section-domains'
import { listDomainsFn, type AddedDomainSummary } from '@/lib/server/functions/domains'
import { DOMAINS_PAGE_PERMISSIONS } from '@/lib/shared/domains-permissions'

export interface DomainSummaries {
  sending: SendingDomainSummary[]
  signIn: SignInDomainSummary[]
  /** The hostname each portal section is served at, and the primary domain. */
  sectionDomains: SectionDomainsView | null
  /** The domains added by name, with or without a use. */
  added: AddedDomainSummary[]
}

export async function loadDomainSummaries({
  permissions,
  sectionDomains: withSections = true,
}: {
  permissions?: readonly string[]
  cloudEnabled?: boolean
  /** The Domains list rows no section map; a domain's own page lists its custom domains. */
  sectionDomains?: boolean
}): Promise<DomainSummaries> {
  const can = (permission: string) => permissions?.includes(permission) ?? false
  const [sending, signIn, sectionDomains, added] = await Promise.all([
    can(EMAIL_SENDING_PERMISSION)
      ? getSendingDomainSummariesFn().catch(() => [] as SendingDomainSummary[])
      : ([] as SendingDomainSummary[]),
    can(PERMISSIONS.AUTH_MANAGE)
      ? getSignInDomainSummariesFn().catch(() => [] as SignInDomainSummary[])
      : ([] as SignInDomainSummary[]),
    withSections && can(PERMISSIONS.SETTINGS_CUSTOM_DOMAIN)
      ? getSectionDomainsFn().catch(() => null)
      : (null as SectionDomainsView | null),
    DOMAINS_PAGE_PERMISSIONS.some(can)
      ? listDomainsFn().catch(() => [] as AddedDomainSummary[])
      : ([] as AddedDomainSummary[]),
  ])
  return { sending, signIn, sectionDomains, added }
}
