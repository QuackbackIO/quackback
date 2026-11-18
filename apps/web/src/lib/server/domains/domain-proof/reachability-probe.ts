/**
 * Whether a custom domain reaches this server: DNS resolves and the instance
 * answers on it. OSS does not automate TLS or DNS, so this is the only check
 * a self-hosted domain gets, for the help center's own domain and for any
 * portal section's.
 */
import { isIP } from 'node:net'
import { interactiveResolver } from '@/lib/server/dns/resolver'
import { isNoAnswer } from '@/lib/server/dns/lookup-outcome'
import { logger } from '@/lib/server/logger'
import { isPooledTenancy } from '@/lib/server/workspaces/mode'
import { normalizeHost } from '@/lib/shared/section-domains'
import { SEEN_HOST_HEADER } from './seen-host'

const log = logger.child({ component: 'reachability-probe' })

/** Same probe path the request-context middleware treats as a health check. */
const HEALTH_PATH = '/api/health'
const REACHABILITY_TIMEOUT_MS = 5000

export interface HelpCenterDomainStatus {
  dnsResolved: boolean
  instanceReachable: boolean
  verified: boolean
  /**
   * Verified because the hostname resolves to an address the primary domain
   * resolves to, while this server could not reach itself through it (hairpin
   * NAT, or egress to its own address blocked). Absent otherwise.
   */
  sharesPrimaryAddress?: true
}

type Lookup = { outcome: 'resolved' | 'absent' | 'unknown'; addresses: string[] }

/**
 * Resolves A and AAAA records; either succeeding counts as "DNS resolves".
 * Two tries each, so one dropped packet is not read as a missing record, and
 * through the shared resolver, so a nameserver that does not answer costs
 * seconds, not the system default's retry cycle.
 *
 * `absent` only when both names answered with nothing; a lookup that went
 * unanswered (timeout, server failure) leaves the answer `unknown`.
 */
async function lookUp(domain: string): Promise<Lookup> {
  const lookups = [
    () => interactiveResolver.resolve4(domain),
    () => interactiveResolver.resolve6(domain),
  ]
  const results = await Promise.all(
    lookups.map(async (lookup) => {
      try {
        return { addresses: await lookup(), unanswered: false }
      } catch (err) {
        return { addresses: [] as string[], unanswered: !isNoAnswer(err) }
      }
    })
  )
  const addresses = results.flatMap((r) => r.addresses)
  if (addresses.length > 0) return { outcome: 'resolved', addresses }
  return { outcome: results.some((r) => r.unanswered) ? 'unknown' : 'absent', addresses }
}

/** The addresses the primary domain is served at: its own, when BASE_URL names an address. */
async function primaryAddresses(primaryOrigin: string): Promise<string[]> {
  let host: string
  try {
    host = new URL(primaryOrigin).hostname
  } catch {
    return []
  }
  const bare = host.replace(/^\[(.*)\]$/, '$1')
  if (isIP(bare)) return [bare]
  return (await lookUp(bare)).addresses
}

/**
 * Whether this exact instance answers on the domain. A plain HTTPS GET to
 * the liveness path proves the CNAME + the operator's proxy both terminate
 * on us -- no shared secret needed for a v1 status check. The answer names
 * the host this server saw (`SEEN_HOST_HEADER`); one that names another host
 * came through a proxy that rewrites Host, where no section is ever served.
 * An answer that names none passes, as one from a server before the header.
 *
 * `unreachable` when no answer came at all (refused, timed out, TLS failed);
 * `other` when something answered, but not this server on this hostname.
 */
async function instanceAnswersOn(domain: string): Promise<'ok' | 'unreachable' | 'other'> {
  let res: Response
  try {
    res = await fetch(`https://${domain}${HEALTH_PATH}`, {
      signal: AbortSignal.timeout(REACHABILITY_TIMEOUT_MS),
    })
  } catch {
    return 'unreachable'
  }
  if (!res.ok) return 'other'
  const seen = res.headers.get(SEEN_HOST_HEADER)
  return seen === null || normalizeHost(seen) === normalizeHost(domain) ? 'ok' : 'other'
}

/**
 * The status, and whether DNS gave an answer at all.
 *
 * With `primaryOrigin` (BASE_URL), a hostname this server cannot reach itself through is
 * still taken as reaching it when it resolves to an address the primary
 * domain resolves to. A server behind NAT without hairpinning, or one whose
 * egress to its own public address is blocked, can never fetch its own
 * hostnames; the shared address says the hostname points here, which is what
 * a section domain needs. Only when nothing answered at all: a server that
 * answered with something else is not this one.
 */
export async function probeCustomDomain(
  domain: string,
  { primaryOrigin }: { primaryOrigin?: string | null } = {}
): Promise<{ status: HelpCenterDomainStatus; dnsAnswered: boolean }> {
  // Never on a pooled process (Cloud's fleet): there another workspace's
  // hostname answers this request, and the control plane decides readiness.
  // Section domains never call this on Cloud; this holds if one ever does.
  if (isPooledTenancy()) {
    log.warn({ hostname: domain }, 'self-hosted domain probe refused on a pooled process')
    return {
      status: { dnsResolved: false, instanceReachable: false, verified: false },
      dnsAnswered: false,
    }
  }
  const [dns, instance] = await Promise.all([lookUp(domain), instanceAnswersOn(domain)])
  const dnsResolved = dns.outcome === 'resolved'
  const instanceReachable = instance === 'ok'
  const dnsAnswered = dns.outcome !== 'unknown'
  if (dnsResolved && instance === 'unreachable' && primaryOrigin) {
    const ours = new Set(await primaryAddresses(primaryOrigin))
    if (dns.addresses.some((address) => ours.has(address))) {
      return {
        status: { dnsResolved, instanceReachable, verified: true, sharesPrimaryAddress: true },
        dnsAnswered,
      }
    }
  }
  return {
    status: { dnsResolved, instanceReachable, verified: dnsResolved && instanceReachable },
    dnsAnswered,
  }
}

/** Read-only status check, used both by the "Verify" action and its status chip. */
export async function checkHelpCenterDomainStatus(domain: string): Promise<HelpCenterDomainStatus> {
  return (await probeCustomDomain(domain)).status
}
