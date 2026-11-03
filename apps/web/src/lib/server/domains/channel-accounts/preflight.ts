/**
 * Pre-flight for a new sending domain, run before its identity is created.
 *
 * Three cheap lookups that shape the setup steps without deciding anything:
 * who hosts the domain's DNS (so the instructions can name that host's quirks),
 * whether the MAIL FROM subdomain is already in use (publishing our MX there
 * would displace whatever lives at it, so a taken name is refused), and the
 * domain's DMARC record (read and shown, never required or changed).
 *
 * A lookup that fails leaves its field out rather than guessing: an unknown
 * host is just generic instructions, and an unknown MAIL FROM name is not a
 * reason to refuse.
 */
import type { SendingDomainPreflight } from '@/lib/server/db'
import type { DnsResolver } from './dns-resolver'

type DnsHost = NonNullable<SendingDomainPreflight['dnsHost']>
type DmarcPolicy = NonNullable<NonNullable<SendingDomainPreflight['dmarc']>['policy']>

/** Lookup failures that mean "nothing is published here". */
const NO_ANSWER = new Set(['ENODATA', 'ENOTFOUND', 'NOTFOUND', 'ENONAME'])

/** The answer, an empty one for "nothing here", or undefined when the lookup failed. */
async function lookup<T>(read: () => Promise<T[]>): Promise<T[] | undefined> {
  try {
    return await read()
  } catch (err) {
    const code = (err as { code?: unknown })?.code
    return typeof code === 'string' && NO_ANSWER.has(code) ? [] : undefined
  }
}

const HOST_PATTERNS: [DnsHost, RegExp][] = [
  ['cloudflare', /\.ns\.cloudflare\.com$/],
  ['route53', /\.awsdns-\d+\.(com|net|org|co\.uk)$/],
  ['godaddy', /\.domaincontrol\.com$/],
  ['namecheap', /\.registrar-servers\.com$/],
  ['google', /\.googledomains\.com$/],
]

/** The DNS host a set of nameservers belongs to, by hostname suffix. */
export function dnsHostFromNameservers(nameservers: string[]): DnsHost | undefined {
  const names = nameservers.map((n) => n.trim().toLowerCase().replace(/\.$/, '')).filter(Boolean)
  if (names.length === 0) return undefined
  for (const [host, pattern] of HOST_PATTERNS) {
    if (names.some((n) => pattern.test(n))) return host
  }
  return 'other'
}

/**
 * The nameservers of the zone a domain lives in: the domain's own, or the
 * nearest parent's when the domain is a name inside someone else's zone.
 */
async function zoneNameservers(
  domain: string,
  resolver: DnsResolver
): Promise<string[] | undefined> {
  const labels = domain.split('.')
  for (let i = 0; i <= labels.length - 2; i++) {
    const name = labels.slice(i).join('.')
    const found = await lookup(() => resolver.resolveNs(name))
    if (found === undefined) return undefined
    if (found.length > 0) return found
  }
  return []
}

/** Whether anything at all answers at a name. Undefined when we could not ask. */
async function nameInUse(name: string, resolver: DnsResolver): Promise<boolean | undefined> {
  const answers = await Promise.all([
    lookup(() => resolver.resolveTxt(name)),
    lookup(() => resolver.resolveCname(name)),
    lookup(() => resolver.resolveMx(name)),
    lookup(() => resolver.resolve4(name)),
  ])
  if (answers.some((a) => a !== undefined && a.length > 0)) return true
  if (answers.some((a) => a === undefined)) return undefined
  return false
}

/** The domain's DMARC record, or undefined when the lookup failed. */
export async function readDmarc(
  domain: string,
  resolver: DnsResolver
): Promise<SendingDomainPreflight['dmarc']> {
  const values = await lookup(() => resolver.resolveTxt(`_dmarc.${domain}`))
  if (values === undefined) return undefined
  const record = values
    .map((chunks) => chunks.join('').trim())
    .find((v) => v.toLowerCase().startsWith('v=dmarc1'))
  if (!record) return { found: false }
  const policy = /(?:^|;)\s*p\s*=\s*(none|quarantine|reject)\s*(?:;|$)/i.exec(record)?.[1]
  return policy ? { found: true, policy: policy.toLowerCase() as DmarcPolicy } : { found: true }
}

export async function runPreflight(
  domain: string,
  mailFromLabel: string,
  resolver: DnsResolver,
  now: Date = new Date()
): Promise<SendingDomainPreflight> {
  const [nameservers, inUse, dmarc] = await Promise.all([
    zoneNameservers(domain, resolver),
    nameInUse(`${mailFromLabel}.${domain}`, resolver),
    readDmarc(domain, resolver),
  ])
  const dnsHost = nameservers ? dnsHostFromNameservers(nameservers) : undefined
  return {
    ...(dnsHost ? { dnsHost } : {}),
    ...(inUse !== undefined ? { mailFromFree: !inUse } : {}),
    ...(dmarc ? { dmarc } : {}),
    checkedAt: now.toISOString(),
  }
}
