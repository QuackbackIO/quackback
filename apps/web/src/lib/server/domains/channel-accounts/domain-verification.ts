/**
 * Sending-domain OWNERSHIP checking. The record matching is a pure function
 * (unit tested); the lookup itself is node:dns.
 *
 * What this checks and what it does not is the load-bearing part. The mail
 * provider is the authority on whether it will SIGN for a domain — it runs its
 * own scans and its answer is the one that decides whether a send succeeds — so
 * nothing here re-decides DKIM or the MAIL FROM MX. What only we can decide is
 * whether the workspace asking to send as a domain is the workspace that owns
 * it, because a provider that can sign for domains it does not host will report
 * the same domain verified to every account holder who asks about it. That
 * answer comes from a record whose value exists in one workspace's row and
 * nowhere else, and this is what resolves it.
 *
 * ## It checks ownership records and refuses to check anything else
 *
 * The narrowing is the security property, not tidiness. A DKIM CNAME, the
 * MAIL FROM MX and the MAIL FROM SPF TXT are the same for every workspace that
 * publishes them — they are the values we hand out with the instructions — so a
 * check that accepted one as proof would mark a domain verified for any
 * workspace that followed the instructions, including one that does not own the
 * domain. The compiler enforces the argument type, and the runtime refusal
 * below catches the same mistake arriving out of a jsonb column, where no type
 * survives.
 */
import type { SendingDomainOwnershipRecord, SendingDomainProofRecord } from '@/lib/server/db'
import { dkimPublicKeyOf, isKeyRecord } from './dkim-key'
import { logger } from '@/lib/server/logger'
import { systemResolver } from '@/lib/server/dns/resolver'
import { isNoAnswer } from '@/lib/server/dns/lookup-outcome'

const log = logger.child({
  component: 'sending-domain-verification',
})

/** The host to query for a record: '@' is the domain apex, else `host.domain`. */
function hostFor(record: SendingDomainProofRecord, domain: string): string {
  return record.host === '@' ? domain : `${record.host}.${domain}`
}

/**
 * Whether the resolved values carry the exact token this row was issued.
 *
 * Matched whole, with only surrounding whitespace and case forgiven. A
 * substring rule would accept a record that merely mentions the token, and the
 * token is the entire evidence: everything else about the record is public.
 */
export function ownershipRecordSatisfied(
  resolved: string[],
  record: SendingDomainOwnershipRecord
): boolean {
  const want = record.value.trim().toLowerCase()
  if (!want) return false
  return resolved.some((r) => r.trim().toLowerCase() === want)
}

/**
 * Whether the resolved values carry this row's own signing key.
 *
 * Compared on the `p=` key alone, whitespace removed, since that is the part
 * minted for this row; the other tags are the same for every key.
 */
export function keyRecordSatisfied(resolved: string[], record: SendingDomainProofRecord): boolean {
  const want = dkimPublicKeyOf(record.value)
  if (!want) return false
  return resolved.some((r) => dkimPublicKeyOf(r) === want)
}

/**
 * Is this stored record one that could prove ownership at all? The
 * `_quackback` token, or a signing key minted for this row. A DKIM CNAME is
 * the provider's and the same for everyone who follows the instructions, so it
 * never is.
 */
function isProofRecord(record: {
  type: string
  purpose: string
  value: string
}): record is SendingDomainProofRecord {
  return (record.type === 'TXT' && record.purpose === 'ownership') || isKeyRecord(record)
}

/**
 * The zone reader, injectable so a test can supply one that PUBLISHES.
 *
 * Not for convenience. Every refusal below is also what a failed lookup
 * produces, so a test pointed at a real resolver — where a reserved test domain
 * answers NXDOMAIN — cannot tell a refusal from a domain that does not exist,
 * and a check that had lost its guard entirely would still look correct. A
 * resolver that answers yes to everything is the only way the refusals are
 * observable as refusals.
 */
export type ZoneReader = (host: string) => Promise<string[][]>

/** One bounded try, like every other background domain check. */
const readTxt: ZoneReader = (host) => systemResolver.resolveTxt(host)

/**
 * What a check of the zone found:
 *
 * - `proven`: every record was read and carries this row's value;
 * - `absent`: the zone answered and at least one record is not there (not
 *   published, NXDOMAIN, or another value), or nothing could prove it at all;
 * - `unknown`: no record was found missing, but a lookup went unanswered
 *   (timeout, server failure, refusal), so the zone has not said either way.
 *
 * Only `absent` is evidence that ownership was lost. A caller holding an
 * earlier proof keeps it through `unknown` and lets the next check decide.
 */
export type OwnershipAnswer = 'proven' | 'absent' | 'unknown'

/**
 * Resolve and check every expected ownership record. A name that answers with
 * nothing counts as unsatisfied, not an error: the owner may still be
 * propagating DNS. An empty expectation is never satisfied: nothing published
 * proves nothing.
 *
 * A record that is not an ownership record is refused rather than checked, and
 * loudly, because the only way one gets here is a caller that has confused the
 * records a domain owner publishes for us with the record that identifies THEM.
 */
export async function checkSendingDomainOwnership(
  domain: string,
  expected: SendingDomainProofRecord[],
  readZone: ZoneReader = readTxt
): Promise<OwnershipAnswer> {
  if (expected.length === 0) return 'absent'
  // Typed as proof, but read out of a jsonb column where no type survives.
  const notOwnership = (expected as { type: string; purpose: string; value: string }[]).filter(
    (r) => !isProofRecord(r)
  )
  if (notOwnership.length > 0) {
    log.error(
      { domain, purposes: notOwnership.map((r) => `${r.type}/${r.purpose}`) },
      'refusing to treat a non-ownership record as proof of domain ownership'
    )
    return 'absent'
  }
  let unanswered = false
  for (const record of expected) {
    let resolved: string[]
    try {
      // A long TXT arrives split into 255-byte chunks; joined, it is the value
      // the domain owner typed.
      resolved = (await readZone(hostFor(record, domain))).map((chunks) => chunks.join(''))
    } catch (err) {
      if (!isNoAnswer(err)) {
        // Keep reading: a record the zone does answer for can still settle it.
        unanswered = true
        continue
      }
      resolved = []
    }
    const satisfied =
      record.purpose === 'dkim'
        ? keyRecordSatisfied(resolved, record)
        : ownershipRecordSatisfied(resolved, record)
    if (!satisfied) return 'absent'
  }
  return unanswered ? 'unknown' : 'proven'
}

/** Whether ownership is proven now: {@link checkSendingDomainOwnership} as a yes or no. */
export async function verifySendingDomainDns(
  domain: string,
  expected: SendingDomainProofRecord[],
  readZone: ZoneReader = readTxt
): Promise<boolean> {
  return (await checkSendingDomainOwnership(domain, expected, readZone)) === 'proven'
}
