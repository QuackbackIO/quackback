/**
 * What one check of a self-hosted section hostname found, as the daily re-check
 * (`section-domains-watch.ts`) and a person's Verify both judge it.
 *
 * A check that fails is not always a sign the hostname stopped being this
 * workspace's. A server behind NAT without hairpin routing, with split DNS, or
 * whose egress rules block its own public address never reaches itself through
 * a hostname that works for everyone else. So a failed check is split:
 *
 * - `reaches`: this server answered (or the hostname shares the primary
 *   domain's address, `probeCustomDomain`).
 * - `unreachable`: DNS still gives the hostname an address and nothing else
 *   answered there, and the workspace's own verification record for a zone
 *   that covers it (a Verified domain's `_quackback` TXT, a sending domain's
 *   or a sign-in domain's record) is still published with its value. The
 *   hostname is still verifiably ours: a warning only.
 * - `unsure`: a DNS lookup went unanswered (timeout, server failure), for the
 *   hostname or its record. It says nothing either way: a warning only.
 * - `failed`: the zone said the hostname has no address, something other
 *   than this server answered on it, or the verification record is gone, no
 *   longer matches, or never existed. The grace and then the end of the
 *   verification still apply to this.
 *
 * Something else answering is a failure even while the record is published:
 * a dangling name under a zone the workspace still holds is how a hostname is
 * taken over, and sign-in must never be carried there.
 */
import { lookupVerificationTxt } from '@/lib/server/auth/dns-verify'
import { interactiveResolver } from '@/lib/server/dns/resolver'
import { logger } from '@/lib/server/logger'
import type { CustomDomainProbe } from '@/lib/server/domains/domain-proof/reachability-probe'
import { rankedZoneProofs } from '@/lib/server/domains/domain-proof/hostname-proof'
import { getProvenZones } from '@/lib/server/domains/domain-proof/proven-zones'

const log = logger.child({ component: 'section-domain-check' })

export type SectionDomainCheck = 'reaches' | 'unreachable' | 'unsure' | 'failed'

/**
 * Whether the workspace's verification record for a zone covering `hostname`
 * is still published with its value. Read through the wire-format TXT lookup
 * (`txt-query.ts`), so a record longer than 255 bytes, published as several
 * strings, is read whole.
 */
export async function verificationRecordHolds(
  hostname: string
): Promise<'proven' | 'absent' | 'unknown'> {
  const proofs = rankedZoneProofs(hostname, await getProvenZones({ includeSso: true }))
  let unanswered = false
  for (const proof of proofs) {
    const result = await lookupVerificationTxt(proof.record.name, interactiveResolver)
    if (result.ok && result.values.includes(proof.record.value)) return 'proven'
    if (!result.ok && result.reason === 'lookup-failed') unanswered = true
  }
  return unanswered ? 'unknown' : 'absent'
}

/** Judge a probe of `hostname`, reading the verification record only when it matters. */
export async function judgeSectionDomainProbe(
  hostname: string,
  probe: CustomDomainProbe
): Promise<SectionDomainCheck> {
  if (probe.status.verified) return 'reaches'
  if (probe.instance === 'other') return 'failed'
  if (probe.dns === 'unknown') return 'unsure'
  if (probe.dns === 'absent') return 'failed'
  const record = await verificationRecordHolds(hostname)
  log.info({ hostname, record }, 'section domain not reached; verification record checked')
  if (record === 'proven') return 'unreachable'
  return record === 'unknown' ? 'unsure' : 'failed'
}
