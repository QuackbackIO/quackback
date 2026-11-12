/**
 * The domain reads behind the Domains list and a domain's own page. Each is
 * made only for a holder of the permission that owns that use, so a viewer is
 * sent, and sees, only the uses they could act on. Loader-safe: it imports the
 * server functions and nothing that renders.
 */
import { PERMISSIONS } from '@/lib/shared/permissions'
import { EMAIL_SENDING_PERMISSION } from '@/lib/shared/email-sending-permissions'
import {
  getHelpCenterDomainSummaryFn,
  getSendingDomainSummariesFn,
  getSignInDomainSummariesFn,
  type HelpCenterDomainSummary,
  type SendingDomainSummary,
  type SignInDomainSummary,
} from '@/lib/server/functions/domains-overview'

export interface DomainSummaries {
  sending: SendingDomainSummary[]
  signIn: SignInDomainSummary[]
  helpCenterDomain: HelpCenterDomainSummary | null
}

export async function loadDomainSummaries({
  permissions,
  cloudEnabled,
}: {
  permissions?: readonly string[]
  cloudEnabled?: boolean
}): Promise<DomainSummaries> {
  const can = (permission: string) => permissions?.includes(permission) ?? false
  const [sending, signIn, helpCenterDomain] = await Promise.all([
    can(EMAIL_SENDING_PERMISSION)
      ? getSendingDomainSummariesFn().catch(() => [] as SendingDomainSummary[])
      : ([] as SendingDomainSummary[]),
    can(PERMISSIONS.AUTH_MANAGE)
      ? getSignInDomainSummariesFn().catch(() => [] as SignInDomainSummary[])
      : ([] as SignInDomainSummary[]),
    // Off Cloud the one web address an install takes is its help center's.
    !cloudEnabled && can(PERMISSIONS.SETTINGS_CUSTOM_DOMAIN)
      ? getHelpCenterDomainSummaryFn().catch(() => null)
      : (null as HelpCenterDomainSummary | null),
  ])
  return { sending, signIn, helpCenterDomain }
}
