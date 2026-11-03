import { systemResolver } from '@/lib/server/dns/resolver'

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
 * Read through the shared resolver, which gives up on a slow nameserver
 * after one short try, so a hung zone cannot hold the verify endpoint.
 */
export async function lookupVerificationTxt(name: string): Promise<LookupResult> {
  try {
    const records = await systemResolver.resolveTxt(name)
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
