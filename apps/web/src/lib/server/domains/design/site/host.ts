/**
 * The host a site capture is kept under, and the homepage it captures.
 *
 * Captures are cached per host, so `www.acme.test`, `ACME.test/pricing` and
 * `https://acme.test/?ref=x` all share one: lowercase, punycode (the URL
 * parser does that), a leading `www.` dropped, path, query and fragment
 * ignored. The homepage keeps the hostname as given, `www.` included, since
 * some sites only answer on one of the two.
 *
 * Refuses what is plainly not a public website: IP addresses, local and
 * internal names, single-label hosts, credentials, other ports and schemes.
 * The DNS check (ssrf-guard) runs later, on the homepage URL; this is only
 * the cheap, offline part.
 */
import { isStandardWebsiteUrl, parseWebsiteInput } from '@/lib/shared/website-branding'

const LOCAL_SUFFIXES = ['localhost', 'local', 'internal', 'lan', 'home.arpa']

/** Dotted numbers, or hex and octal parts, which some resolvers read as an address. */
const IPISH = /^(?:0x[\da-f]*|\d+)(?:\.(?:0x[\da-f]*|\d+))*\.?$/i

export function siteHost(input: string): { host: string; url: string } | null {
  const parsed = parseWebsiteInput(input)
  if (!parsed || !isStandardWebsiteUrl(parsed)) return null
  // A default port is dropped by the parser; any other was refused above.
  if (parsed.port !== '') return null

  let hostname = parsed.hostname.toLowerCase()
  if (hostname.endsWith('.')) hostname = hostname.slice(0, -1)
  if (!hostname) return null
  // IPv6 literals come back bracketed.
  if (hostname.startsWith('[') || hostname.includes(':')) return null
  if (IPISH.test(hostname)) return null

  const labels = hostname.split('.')
  if (labels.length < 2 || labels.some((label) => label === '')) return null
  if (LOCAL_SUFFIXES.some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`))) {
    return null
  }

  const host = hostname.startsWith('www.') ? hostname.slice(4) : hostname
  if (!host.includes('.')) return null
  return { host, url: `${parsed.protocol}//${hostname}/` }
}
