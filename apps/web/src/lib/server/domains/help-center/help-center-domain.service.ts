/**
 * Help center custom domain (domains/languages §1) on a self-hosted server.
 * OSS does not automate TLS or DNS -- the operator CNAMEs their domain to this
 * instance and terminates TLS in their own proxy.
 *
 * The domain is the help center's entry in the portal section map
 * (section-domains.service.ts); this module is the help center settings'
 * writer for it, behind its own permission, until custom domains are written
 * only on Settings > Domains. Sending /hc to the domain is the section host
 * middleware's job.
 */
import { normalizeDomain } from '@/lib/server/auth/normalize-domain'
import { ForbiddenError, ValidationError } from '@/lib/shared/errors'
import { helpDomainConfig } from '@/lib/shared/section-domains'
import type { HelpCenterDomainConfig } from '@/lib/server/domains/settings/settings.types'
import type { HelpCenterDomainStatus } from '@/lib/server/domains/domain-proof/reachability-probe'

export {
  checkHelpCenterDomainStatus,
  type HelpCenterDomainStatus,
} from '@/lib/server/domains/domain-proof/reachability-probe'

export const HC_DOMAIN_CLOUD_MANAGED = 'HC_DOMAIN_CLOUD_MANAGED'

async function refuseCloudLocalWriter(): Promise<void> {
  const { getWorkspaceSettings } = await import('@/lib/server/domains/settings/settings.service')
  const workspace = await getWorkspaceSettings()
  const stored = (workspace?.settings as { cloud?: { enabled?: boolean } | null } | undefined)
    ?.cloud
  // Capability flag, not the resolved projection: a cloud workspace with a
  // temporarily unreadable projection must still not use this writer.
  if (stored?.enabled === true) {
    throw new ForbiddenError(
      HC_DOMAIN_CLOUD_MANAGED,
      'Cloud workspaces cannot use the local reverse-proxy domain writer.'
    )
  }
}

const sectionDomains = () => import('@/lib/server/domains/settings/section-domains.service')

/**
 * Set (or clear) the help center's domain. A new hostname has never passed
 * the check, so it starts unverified; the same hostname keeps its result.
 */
export async function setHelpCenterDomain(
  domainInput: string | null
): Promise<HelpCenterDomainConfig> {
  const { setSectionDomain } = await sectionDomains()
  if (domainInput === null || domainInput.trim() === '') {
    // Clearing a domain is always allowed. Refusing it would strand a
    // downgraded workspace on a domain it can no longer manage.
    const cleared = await setSectionDomain('help', null)
    return helpDomainConfig(cleared.ok ? cleared.sectionDomains : {})
  }
  // Cloud identity owns custom hostnames. The local reverse-proxy writer is
  // self-host only — even when the plan grants customDomain.
  await refuseCloudLocalWriter()
  // Plan gate. No-op on any install without a cloud config, which is every
  // self-hosted one — see domains/settings/cloud/entitlements.ts.
  const { requireEntitlement } = await import('@/lib/server/domains/settings/cloud/entitlements')
  await requireEntitlement('customDomain')
  const normalized = normalizeDomain(domainInput)
  if (!normalized) {
    throw new ValidationError('HC_DOMAIN_INVALID', 'Must be a public FQDN (e.g. "help.acme.com")')
  }
  // Also puts the domain on Settings > Domains.
  const result = await setSectionDomain('help', normalized)
  if (!result.ok) throw new ValidationError(result.code, result.message)
  return helpDomainConfig(result.sectionDomains)
}

/**
 * Run the verify check against the help center's domain and persist the
 * result. A previously-verified domain that stops answering is un-verified
 * again, so visitors are not sent to a dead host.
 */
export async function verifyHelpCenterDomain(): Promise<{
  config: HelpCenterDomainConfig
  status: HelpCenterDomainStatus
}> {
  await refuseCloudLocalWriter()
  const { verifySectionDomain } = await sectionDomains()
  const result = await verifySectionDomain('help')
  if (!result.ok || !result.status) {
    throw new ValidationError('HC_DOMAIN_NOT_SET', 'Set a domain before verifying it')
  }
  return { config: helpDomainConfig(result.sectionDomains), status: result.status }
}

// The pure host-matching helper lives in lib/shared; re-exported here so
// server callers keep one import surface for the domain feature.
export { resolveHelpCenterBaseUrl } from '@/lib/shared/help-center-domain'
