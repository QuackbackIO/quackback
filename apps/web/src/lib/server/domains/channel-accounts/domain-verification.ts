/**
 * Sending-domain DNS verification (support platform §4.8). Before a sending domain
 * is trusted, the SPF (TXT) and DKIM (CNAME) records we published must actually
 * resolve — so mail from it passes authentication instead of landing in spam. The
 * record MATCHING is a pure function (unit-tested); the lookup itself is node:dns.
 */
import { resolveTxt, resolveCname } from 'node:dns/promises'
import type { SendingDomainDnsRecord } from '@/lib/server/db'

/** The host to query for a record: '@' is the domain apex, else `host.domain`. */
function hostFor(record: SendingDomainDnsRecord, domain: string): string {
  return record.host === '@' ? domain : `${record.host}.${domain}`
}

/**
 * Whether the resolved values satisfy the expected record. Lenient where DNS is:
 * an SPF TXT may carry extra mechanisms, so match on the required include; a CNAME
 * is compared case- and trailing-dot-insensitively.
 */
export function recordSatisfied(resolved: string[], record: SendingDomainDnsRecord): boolean {
  if (record.type === 'TXT') {
    // SPF: the record must carry the include mechanism we published.
    const include = /include:\S+/.exec(record.value)?.[0]
    const needle = (include ?? record.value).toLowerCase()
    return resolved.some((r) => r.toLowerCase().includes(needle))
  }
  const want = record.value.replace(/\.$/, '').toLowerCase()
  return resolved.some((r) => r.replace(/\.$/, '').toLowerCase() === want)
}

/**
 * Resolve and check every expected record. A lookup failure (NXDOMAIN, no record
 * yet) counts as unsatisfied, not an error — the admin is still propagating DNS.
 * An empty expectation is never "verified".
 */
export async function verifySendingDomainDns(
  domain: string,
  expected: SendingDomainDnsRecord[]
): Promise<boolean> {
  if (expected.length === 0) return false
  for (const record of expected) {
    const host = hostFor(record, domain)
    try {
      const resolved =
        record.type === 'TXT'
          ? (await resolveTxt(host)).map((chunks) => chunks.join(''))
          : await resolveCname(host)
      if (!recordSatisfied(resolved, record)) return false
    } catch {
      return false
    }
  }
  return true
}
