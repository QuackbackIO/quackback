import { resolveTxt } from 'node:dns/promises'

const DNS_TIMEOUT_MS = 5_000

export type LookupResult =
  | { ok: true; values: string[] }
  | { ok: false; reason: 'no-record' | 'lookup-failed' }

/**
 * Resolve TXT records at `name` and return concatenated string values.
 *
 * RFC 1035 splits any TXT value over 255 bytes into multiple chunks, so
 * `resolveTxt` returns `string[][]` — we join the inner array per record
 * before comparing. ENOTFOUND / ENODATA collapse to `no-record`;
 * anything else (timeout, transport failure, malformed response) becomes
 * `lookup-failed` so the caller can render a retry-friendly message.
 *
 * 5s timeout via `Promise.race` — node's dns API has no per-call
 * timeout. Without it a hung resolver would block the verify endpoint
 * indefinitely.
 */
export async function lookupVerificationTxt(name: string): Promise<LookupResult> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined
  try {
    const records = await Promise.race([
      resolveTxt(name),
      new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error('dns-timeout')), DNS_TIMEOUT_MS)
      }),
    ])
    const values = records.map((chunks) => chunks.join(''))
    if (values.length === 0) return { ok: false, reason: 'no-record' }
    return { ok: true, values }
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    if (code === 'ENOTFOUND' || code === 'ENODATA') {
      return { ok: false, reason: 'no-record' }
    }
    return { ok: false, reason: 'lookup-failed' }
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle)
  }
}
