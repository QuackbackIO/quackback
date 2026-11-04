import { systemResolver, type DnsResolver } from '@/lib/server/dns/resolver'

export type LookupResult =
  { ok: true; values: string[] } | { ok: false; reason: 'no-record' | 'lookup-failed' }

/**
 * Resolve TXT records at `name` and return concatenated string values.
 *
 * RFC 1035 splits any TXT value over 255 bytes into multiple chunks, so
 * `resolveTxt` returns `string[][]`; the inner array is joined per record
 * before comparing. ENOTFOUND / ENODATA collapse to `no-record`; anything
 * else (timeout, transport failure, malformed response) becomes
 * `lookup-failed` so the caller can render a retry-friendly message.
 *
 * Read through the shared resolver (one short try by default; a caller a
 * person is waiting on passes the two-try one), so a hung zone cannot hold
 * the verify endpoint.
 */
export async function lookupVerificationTxt(
  name: string,
  resolver: Pick<DnsResolver, 'resolveTxt'> = systemResolver
): Promise<LookupResult> {
  try {
    const records = await resolver.resolveTxt(name)
    const values = records.map((chunks) => chunks.join(''))
    if (values.length === 0) return { ok: false, reason: 'no-record' }
    return { ok: true, values }
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    if (code === 'ENOTFOUND' || code === 'ENODATA') {
      return { ok: false, reason: 'no-record' }
    }
    return { ok: false, reason: 'lookup-failed' }
  }
}
