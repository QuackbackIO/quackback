/**
 * Pre-flight for a new sending domain, run before its identity is created.
 *
 * Three cheap lookups that shape the setup steps without deciding anything:
 * who hosts the domain's DNS (so the instructions can name that host's quirks),
 * whether the MAIL FROM subdomain already holds records ours would conflict
 * with (so a taken name is refused), and the domain's DMARC record (read and
 * shown, never required or changed).
 *
 * A lookup that fails leaves its field out rather than guessing: an unknown
 * host is just generic instructions, and an unknown MAIL FROM name is not a
 * reason to refuse.
 */
import { randomBytes } from 'node:crypto'
import { SES_MAIL_FROM_SPF_VALUE, sesMailFromMxValue } from '@quackback/email/ses-identity'
import type { SendingDomainPreflight } from '@/lib/server/db'
import type { DnsResolver } from '@/lib/server/dns/resolver'

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

const normalName = (n: string) => n.trim().toLowerCase().replace(/\.$/, '')
const normalText = (t: string) => t.trim().replace(/\s+/g, ' ').toLowerCase()

const sameAnswers = (a: string[], b: string[]) =>
  a.length === b.length && [...a].sort().join('\n') === [...b].sort().join('\n')

type Kind = 'cname' | 'mx' | 'spf' | 'txt' | 'a' | 'aaaa'
type Answers = Partial<Record<Kind, string[] | undefined>>

/**
 * Read the record types that can conflict with ours at a name: for an MX and
 * SPF TXT, a CNAME, an MX and an SPF record; for a CNAME, anything at all.
 */
async function conflictingTypes(
  name: string,
  resolver: DnsResolver,
  forCname: boolean
): Promise<Answers> {
  const [cname, mx, txt, a, aaaa] = await Promise.all([
    lookup(() => resolver.resolveCname(name)),
    lookup(() => resolver.resolveMx(name)),
    lookup(() => resolver.resolveTxt(name)),
    forCname ? lookup(() => resolver.resolve4(name)) : Promise.resolve([]),
    forCname ? lookup(() => resolver.resolve6(name)) : Promise.resolve([]),
  ])
  const texts = txt?.map((chunks) => normalText(chunks.join('')))
  return {
    cname: cname?.map(normalName),
    mx: mx?.map((m) => normalName(m.exchange)),
    ...(forCname
      ? { txt: texts, a: a?.map(normalName), aaaa: aaaa?.map(normalName) }
      : { spf: texts?.filter((v) => v.startsWith('v=spf1')) }),
  }
}

/**
 * Whether the MAIL FROM name already holds records ours would conflict with.
 * Undefined when we could not ask.
 *
 * Our MX and SPF TXT sit beside anything else at the name, so only three things
 * conflict with them: a CNAME (nothing may sit beside one), an MX that is not
 * ours, and an SPF record that is not ours. Addresses and other TXT records
 * coexist, and our own MX and SPF (left from a domain removed and added again)
 * are what we would publish anyway.
 *
 * A return path that is one CNAME (`returnPathTarget`) can sit beside nothing,
 * so any record at the name conflicts, except that same CNAME already there.
 * Other types read at a name holding our CNAME are the target's, followed.
 *
 * A wildcard answers at every name that holds nothing of its own, so the same
 * types are read at a random sibling too: an answer identical there comes from
 * the wildcard, and an explicit record we publish overrides it.
 */
async function mailFromNameTaken(
  name: string,
  domain: string,
  region: string,
  resolver: DnsResolver,
  returnPathTarget: string | null
): Promise<boolean | undefined> {
  const forCname = returnPathTarget !== null
  const probe = `qb-probe-${randomBytes(6).toString('hex')}.${domain}`
  const [here, wildcard] = await Promise.all([
    conflictingTypes(name, resolver, forCname),
    conflictingTypes(probe, resolver, forCname),
  ])
  const ours: Answers = forCname
    ? { cname: [normalName(returnPathTarget)] }
    : { mx: [normalName(sesMailFromMxValue(region))], spf: [normalText(SES_MAIL_FROM_SPF_VALUE)] }
  if (forCname && here.cname?.some((v) => ours.cname?.includes(v))) return false
  let unknown = false
  for (const type of Object.keys(here) as Kind[]) {
    const found = here[type]
    if (found === undefined) {
      unknown = true
      continue
    }
    const foreign = found.filter((v) => !(ours[type] ?? []).includes(v))
    if (foreign.length === 0) continue
    const fromWildcard = wildcard[type]
    if (fromWildcard === undefined) {
      unknown = true
      continue
    }
    if (sameAnswers(found, fromWildcard)) continue
    return true
  }
  return unknown ? undefined : false
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
  region: string,
  resolver: DnsResolver,
  now: Date = new Date(),
  /** Set when the return path is one CNAME to this name rather than an MX and TXT. */
  returnPathTarget: string | null = null
): Promise<SendingDomainPreflight> {
  const [nameservers, inUse, dmarc] = await Promise.all([
    zoneNameservers(domain, resolver),
    mailFromNameTaken(`${mailFromLabel}.${domain}`, domain, region, resolver, returnPathTarget),
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
