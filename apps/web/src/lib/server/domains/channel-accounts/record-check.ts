/**
 * Per-record DNS checks for a sending domain: which of the records the owner
 * was asked to publish we can see, and what is there instead when it is wrong.
 *
 * These explain; they do not decide. The mail provider is the authority on
 * whether a domain is verified, and nothing here promotes one. What these add
 * is the answer to "which record is holding this up", which the provider's
 * single status cannot give, and the two mistakes a DNS form makes easy:
 *
 * - the full name typed into a field that appends the domain itself, so the
 *   record lands at `_quackback.acme.com.acme.com` (reported as a mismatch
 *   with `reason: 'doubled-name'`);
 * - a CNAME a DNS host proxies, so the name answers with addresses rather than
 *   pointing at the value (reported as `proxied`).
 *
 * A return path CNAME a DNS host flattens (serving the target's MX and SPF
 * under the name rather than the CNAME) counts as found.
 */
import type { SendingDomainDnsRecord, SendingDomainRecordCheck } from '@/lib/server/db'
import type { DnsResolver } from '@/lib/server/dns/resolver'
import { isNoAnswer } from '@/lib/server/dns/lookup-outcome'
import { dkimPublicKeyOf, isKeyRecord } from './dkim-key'

export type { DnsResolver } from '@/lib/server/dns/resolver'

/** Thrown inside a check when the resolver could not answer at all. */
class LookupFailed extends Error {}

/** A resolved answer, or an empty one when nothing is published at the name. */
async function answer<T>(lookup: () => Promise<T[]>): Promise<T[]> {
  try {
    return await lookup()
  } catch (err) {
    if (isNoAnswer(err)) return []
    throw new LookupFailed(String((err as { code?: unknown })?.code ?? 'lookup failed'))
  }
}

/** Lower-cased, trimmed, without the root dot DNS answers sometimes carry. */
function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, '')
}

/** A TXT value as compared: trimmed and case-folded, so `V=SPF1` is `v=spf1`. */
function normalizeText(value: string): string {
  return value.trim().toLowerCase()
}

/** The full name a relative host resolves at, `@` being the apex. */
export function recordName(domain: string, host: string): string {
  return host === '@' ? domain : `${host}.${domain}`
}

/**
 * The part of a TXT value that says what kind of record it is.
 *
 * `v=spf1 include:...` is an SPF record by its first word; a token record like
 * `quackback-domain-verification=abc` is identified by everything up to its
 * `=`. A value sharing that prefix is the owner's attempt at this record; any
 * other value at the name is something else that happens to live there.
 */
function textPrefix(value: string): string {
  const v = normalizeText(value)
  const space = v.indexOf(' ')
  if (space > 0) return v.slice(0, space)
  const eq = v.indexOf('=')
  return eq > 0 ? v.slice(0, eq + 1) : v
}

/**
 * A signing key TXT holding another value, named for the two ways a DNS host
 * mangles a long one: cut at its length limit (the found key is the start of
 * the wanted one), or with the quote marks of pasted parts kept as text.
 */
function keyMismatch(seen: string, want: string): Omit<SendingDomainRecordCheck, 'checkedAt'> {
  if (seen.includes('"')) return { state: 'mismatch', seen, reason: 'quoted' }
  const key = dkimPublicKeyOf(seen) ?? ''
  if (key.length < want.length && want.startsWith(key)) {
    return { state: 'mismatch', seen, reason: 'truncated' }
  }
  return { state: 'mismatch', seen }
}

/** A name's MX hosts and SPF values, in the form they are compared. */
async function mailAnswers(name: string, resolver: DnsResolver) {
  const [mx, txt] = await Promise.all([
    answer(() => resolver.resolveMx(name)),
    answer(() => resolver.resolveTxt(name)),
  ])
  return {
    mx: mx.map((m) => `${m.priority} ${normalizeName(m.exchange)}`),
    spf: txt.map((chunks) => normalizeText(chunks.join(''))).filter((v) => v.startsWith('v=spf1')),
  }
}

/**
 * Whether a return path name with no CNAME visible answers as its target does:
 * the same MX and the same SPF record. Some DNS hosts flatten a CNAME, serving
 * the target's records under the name instead of the CNAME itself, which the
 * provider accepts just the same. Both must be present at the target, so a
 * name is never counted found against a target that answers nothing.
 */
async function flattened(name: string, target: string, resolver: DnsResolver): Promise<boolean> {
  const [here, there] = await Promise.all([
    mailAnswers(name, resolver),
    mailAnswers(normalizeName(target), resolver),
  ])
  if (there.mx.length === 0 || there.spf.length === 0) return false
  return (
    there.mx.every((mx) => here.mx.includes(mx)) && there.spf.every((spf) => here.spf.includes(spf))
  )
}

/** What one name holds for this record type, as a state relative to the wanted record. */
async function stateAt(
  name: string,
  record: SendingDomainDnsRecord,
  resolver: DnsResolver
): Promise<Omit<SendingDomainRecordCheck, 'checkedAt'>> {
  if (isKeyRecord(record)) {
    // A signing key is compared on its key alone, whatever the spacing, chunking
    // or tag order. A TXT here with another key is this record entered wrong.
    const values = (await answer(() => resolver.resolveTxt(name))).map((chunks) => chunks.join(''))
    const want = dkimPublicKeyOf(record.value)
    if (values.some((v) => dkimPublicKeyOf(v) === want)) return { state: 'found' }
    const other = values.find((v) => dkimPublicKeyOf(v) !== null)
    if (other !== undefined) return keyMismatch(other.trim(), want ?? '')
    if (values.length === 0) {
      const addresses = await answer(() => resolver.resolve4(name))
      if (addresses.length > 0) return { state: 'proxied', seen: addresses[0] }
    }
    return { state: 'missing' }
  }

  if (record.type === 'TXT') {
    const values = (await answer(() => resolver.resolveTxt(name))).map((chunks) => chunks.join(''))
    const want = normalizeText(record.value)
    if (values.some((v) => normalizeText(v) === want)) return { state: 'found' }
    const prefix = textPrefix(record.value)
    const close = values.find((v) => normalizeText(v).startsWith(prefix))
    return close !== undefined ? { state: 'mismatch', seen: close.trim() } : { state: 'missing' }
  }

  if (record.type === 'CNAME') {
    const targets = await answer(() => resolver.resolveCname(name))
    if (targets.length > 0) {
      const want = normalizeName(record.value)
      if (targets.some((t) => normalizeName(t) === want)) return { state: 'found' }
      return { state: 'mismatch', seen: normalizeName(targets[0]) }
    }
    if (record.purpose === 'mail-from' && (await flattened(name, record.value, resolver))) {
      return { state: 'found' }
    }
    const addresses = await answer(() => resolver.resolve4(name))
    if (addresses.length > 0) return { state: 'proxied', seen: addresses[0] }
    return { state: 'missing' }
  }

  if (record.type !== 'MX') return { state: 'missing' }
  const exchanges = await answer(() => resolver.resolveMx(name))
  if (exchanges.length === 0) return { state: 'missing' }
  const want = normalizeName(record.value)
  const exact = exchanges.find(
    (mx) => normalizeName(mx.exchange) === want && mx.priority === record.priority
  )
  if (exact) return { state: 'found' }
  const sameHost = exchanges.find((mx) => normalizeName(mx.exchange) === want)
  const shown = sameHost ?? exchanges[0]
  return { state: 'mismatch', seen: `${shown.priority} ${normalizeName(shown.exchange)}` }
}

/**
 * Check one record. Null when the resolver could not answer (a timeout, a
 * refused query), so a flaky lookup never reads as a record that went missing.
 */
export async function checkRecord(
  domain: string,
  record: SendingDomainDnsRecord,
  resolver: DnsResolver,
  now: Date = new Date()
): Promise<SendingDomainRecordCheck | null> {
  const checkedAt = now.toISOString()
  const name = recordName(domain, record.host)
  try {
    const result = await stateAt(name, record, resolver)
    if (result.state !== 'missing') return { ...result, checkedAt }
    // Nothing at the right name: look where a doubled entry would have put it.
    const doubled = `${name}.${domain}`
    const there = await stateAt(doubled, record, resolver)
    if (there.state === 'found' || there.state === 'mismatch') {
      return { state: 'mismatch', seen: doubled, reason: 'doubled-name', checkedAt }
    }
    return { state: 'missing', checkedAt }
  } catch (err) {
    if (err instanceof LookupFailed) return null
    throw err
  }
}

/**
 * Check every record, attaching each result as `check`. A record whose lookup
 * failed keeps the check it already carried.
 */
export async function checkRecords(
  domain: string,
  records: SendingDomainDnsRecord[],
  resolver: DnsResolver,
  now: Date = new Date()
): Promise<SendingDomainDnsRecord[]> {
  const checks = await Promise.all(records.map((r) => checkRecord(domain, r, resolver, now)))
  return records.map((record, i) => {
    const check = checks[i] ?? record.check
    return check ? { ...record, check } : record
  })
}
