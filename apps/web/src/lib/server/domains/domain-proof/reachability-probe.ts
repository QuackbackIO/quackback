/**
 * Whether a custom domain reaches this server: DNS resolves and the instance
 * answers on it. OSS does not automate TLS or DNS, so this is the only check
 * a self-hosted domain gets, for the help center's own domain and for any
 * portal section's.
 */
import { systemResolver } from '@/lib/server/dns/resolver'
import { isNoAnswer } from '@/lib/server/dns/lookup-outcome'

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
export async function probeCustomDomain(
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
  return (await probeCustomDomain(domain)).status
}
