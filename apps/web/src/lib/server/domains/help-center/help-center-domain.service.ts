/**
 * Help center custom domain (domains/languages §1). OSS does not automate TLS
 * or DNS -- the operator CNAMEs their domain to this instance and terminates
 * TLS in their own proxy. This module owns:
 *  - normalizing/persisting the configured domain,
 *  - the "Verify" check (DNS resolves + the instance answers on it),
 *  - the pure host-matching helpers the router/bootstrap layer uses for the
 *    default-host -> custom-domain 301 and for domain-aware canonical URLs.
 */
import { systemResolver } from '@/lib/server/dns/resolver'
import { isNoAnswer } from '@/lib/server/dns/lookup-outcome'
import { normalizeDomain } from '@/lib/server/auth/normalize-domain'
import { ForbiddenError, ValidationError } from '@/lib/shared/errors'
import { logger } from '@/lib/server/logger'
import {
  getHelpCenterConfig,
  updateHelpCenterConfig,
} from '@/lib/server/domains/settings/settings.service'
import type { HelpCenterDomainConfig } from '@/lib/server/domains/settings/settings.types'

const log = logger.child({ component: 'help-center-domain' })

/** Same probe path the request-context middleware treats as a health check. */
const HEALTH_PATH = '/api/health'
const REACHABILITY_TIMEOUT_MS = 5000

export interface HelpCenterDomainStatus {
  dnsResolved: boolean
  instanceReachable: boolean
  verified: boolean
}

/**
 * Resolves A then AAAA records; either succeeding counts as "DNS resolves".
 * Through the shared resolver, so a nameserver that does not answer costs
 * seconds, not the system default's retry cycle.
 *
 * `absent` only when both names answered with nothing; a lookup that went
 * unanswered (timeout, server failure) leaves the answer `unknown`.
 */
async function domainResolves(domain: string): Promise<'resolved' | 'absent' | 'unknown'> {
  let unanswered = false
  const lookups = [() => systemResolver.resolve4(domain), () => systemResolver.resolve6(domain)]
  for (const lookup of lookups) {
    try {
      const addrs = await lookup()
      if (addrs.length > 0) return 'resolved'
    } catch (err) {
      if (!isNoAnswer(err)) unanswered = true
    }
  }
  return unanswered ? 'unknown' : 'absent'
}

/**
 * Whether this exact instance answers on the domain. A plain HTTPS GET to
 * the liveness path proves the CNAME + the operator's proxy both terminate
 * on us -- no shared secret needed for a v1 status check.
 */
async function instanceAnswersOn(domain: string): Promise<boolean> {
  try {
    const res = await fetch(`https://${domain}${HEALTH_PATH}`, {
      signal: AbortSignal.timeout(REACHABILITY_TIMEOUT_MS),
    })
    return res.ok
  } catch {
    return false
  }
}

/** The status, and whether DNS gave an answer at all. */
async function probeHelpCenterDomain(
  domain: string
): Promise<{ status: HelpCenterDomainStatus; dnsAnswered: boolean }> {
  const [dns, instanceReachable] = await Promise.all([
    domainResolves(domain),
    instanceAnswersOn(domain),
  ])
  const dnsResolved = dns === 'resolved'
  return {
    status: { dnsResolved, instanceReachable, verified: dnsResolved && instanceReachable },
    dnsAnswered: dns !== 'unknown',
  }
}

/** Read-only status check, used both by the "Verify" action and its status chip. */
export async function checkHelpCenterDomainStatus(domain: string): Promise<HelpCenterDomainStatus> {
  return (await probeHelpCenterDomain(domain)).status
}

/**
 * Set (or clear) the configured domain. Changing the domain always resets
 * verification -- a new hostname has never passed the check.
 */
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

export async function setHelpCenterDomain(
  domainInput: string | null
): Promise<HelpCenterDomainConfig> {
  if (domainInput === null || domainInput.trim() === '') {
    // Clearing a domain is always allowed. Refusing it would strand a
    // downgraded workspace on a domain it can no longer manage.
    const updated = await updateHelpCenterConfig({ domain: { domain: null, verifiedAt: null } })
    return updated.domain
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
  const updated = await updateHelpCenterConfig({
    domain: { domain: normalized, verifiedAt: null },
  })
  return updated.domain
}

/**
 * Run the verify check against the currently configured domain and persist
 * the result. A previously-verified domain that stops answering is
 * un-verified again (verifiedAt cleared) so the 301 doesn't strand visitors
 * on a dead host.
 */
export async function verifyHelpCenterDomain(): Promise<{
  config: HelpCenterDomainConfig
  status: HelpCenterDomainStatus
}> {
  await refuseCloudLocalWriter()
  const current = await getHelpCenterConfig('fresh')
  const domain = current.domain?.domain
  if (!domain) {
    throw new ValidationError('HC_DOMAIN_NOT_SET', 'Set a domain before verifying it')
  }

  const { status, dnsAnswered } = await probeHelpCenterDomain(domain)
  log.info({ domain, status, dns_answered: dnsAnswered }, 'help center domain verify check')
  // A lookup that went unanswered says nothing about the domain, so it keeps
  // a verification it already has; only an answer can take one away.
  const kept = !status.verified && !dnsAnswered ? (current.domain?.verifiedAt ?? null) : null
  if (kept) {
    log.warn({ domain }, 'help center domain lookup went unanswered; keeping its verification')
  }
  const verifiedAt = status.verified ? new Date().toISOString() : kept
  const updated = await updateHelpCenterConfig({ domain: { domain, verifiedAt } })
  return { config: updated.domain, status }
}

// The pure host-matching helpers live in lib/shared (route beforeLoad code is
// client-bundled and must not drag this server module in); re-exported here so
// server callers keep one import surface for the domain feature.
export {
  resolveHelpCenterDomainRedirect,
  resolveHelpCenterBaseUrl,
} from '@/lib/shared/help-center-domain'
