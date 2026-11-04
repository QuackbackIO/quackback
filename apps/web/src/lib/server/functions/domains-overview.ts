/**
 * Reads for the Domains settings page. Each section has its own read, gated by
 * the permission of the page that owns that kind of domain, so a viewer sees
 * only the sections they could act on.
 */
import { createServerFn } from '@tanstack/react-start'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { requireAuth } from './auth-helpers'
import type {
  SendingDomainSummary,
  SignInDomainSummary,
} from '@/lib/server/domains/domain-proof/domains-overview'

export type { SendingDomainSummary, SignInDomainSummary }

export interface HelpCenterDomainSummary {
  domain: string
  verified: boolean
}

export const getSendingDomainSummariesFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<SendingDomainSummary[]> => {
    await requireAuth({ permission: PERMISSIONS.CHANNEL_ACCOUNT_MANAGE })
    const { listSendingDomainSummaries } =
      await import('@/lib/server/domains/domain-proof/domains-overview')
    return listSendingDomainSummaries()
  }
)

export const getSignInDomainSummariesFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<SignInDomainSummary[]> => {
    const auth = await requireAuth({ permission: PERMISSIONS.AUTH_MANAGE })
    const { listSignInDomainSummaries } =
      await import('@/lib/server/domains/domain-proof/domains-overview')
    return listSignInDomainSummaries(auth.permissions)
  }
)

/** The help center's own domain on an install that serves it itself, or null when none is set. */
export const getHelpCenterDomainSummaryFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<HelpCenterDomainSummary | null> => {
    await requireAuth({ permission: PERMISSIONS.SETTINGS_CUSTOM_DOMAIN })
    const { getHelpCenterConfig } = await import('@/lib/server/domains/settings/settings.service')
    const { domain } = await getHelpCenterConfig()
    if (!domain?.domain) return null
    return { domain: domain.domain, verified: domain.verifiedAt !== null }
  }
)
