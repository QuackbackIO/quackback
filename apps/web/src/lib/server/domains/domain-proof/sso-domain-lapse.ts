/**
 * Which sign-in (single sign-on) domains lose their verification when a
 * domain added by name loses its proof.
 *
 * A sign-in domain is verified once and the stamp is kept, so the proof it was
 * verified through is not recorded. What is judged instead is whether anything
 * still proves it now, leaving out the lapsed domain's record, which the zone
 * has said is gone:
 *
 * - its own `_quackback-verify` record, holding its own token: kept, always;
 * - another proof this workspace holds that covers it (a verified sending
 *   domain or another verified domain at or above it, or a ready web address
 *   that is exactly it): kept. A proof that rests on the same `_quackback`
 *   record as the lapsed domain (a sending row issued its token) is the same
 *   evidence and does not count;
 * - nothing: it loses verification.
 *
 * Only verified sign-in domains at or under the lapsed domain are considered.
 * When any one of their own lookups goes unanswered, the answer is
 * `undecided` and nothing is taken away until a run can judge them all.
 */
import { db, isNotNull, ssoVerifiedDomain, type Domain } from '@/lib/server/db'
import { lookupVerificationTxt } from '@/lib/server/auth/dns-verify'
import { interactiveResolver } from '@/lib/server/dns/resolver'
import { SSO_VERIFY_RECORD_HOST, ssoVerifyRecordValue } from '@/lib/shared/domain-proof'
import { isAtOrUnder, toAsciiDomain } from '@/lib/server/domains/channel-accounts/outbound-identity'
import { OWNERSHIP_RECORD_HOST } from '@/lib/server/domains/channel-accounts/sending-domain-records'
import { recordName } from '@/lib/server/domains/channel-accounts/record-check'
import { domainOwnershipValue } from './domains.service'
import { getProvenZones, provenZoneCovering } from './proven-zones'

export interface LapsingSignInDomain {
  id: (typeof ssoVerifiedDomain.$inferSelect)['id']
  name: string
  /** The token it was judged with, so a row rotated since is left alone. */
  verificationToken: string
}

export async function signInDomainsLosingProof(
  domain: Pick<Domain, 'name' | 'ownershipToken'>
): Promise<LapsingSignInDomain[] | 'undecided'> {
  const zone = toAsciiDomain(domain.name)
  if (!zone) return []
  const verified = await db
    .select({
      id: ssoVerifiedDomain.id,
      name: ssoVerifiedDomain.name,
      verificationToken: ssoVerifiedDomain.verificationToken,
    })
    .from(ssoVerifiedDomain)
    .where(isNotNull(ssoVerifiedDomain.verifiedAt))
  const covered = verified
    .filter((s) => {
      const name = toAsciiDomain(s.name)
      return !!name && isAtOrUnder(name, zone)
    })
    .sort((a, b) => a.name.localeCompare(b.name))
  if (covered.length === 0) return []

  const lapsed = {
    name: recordName(zone, OWNERSHIP_RECORD_HOST),
    value: domainOwnershipValue(domain.ownershipToken),
  }
  // Every other proof this workspace holds. Sign-in domains are left out, as
  // everywhere: one never proves another.
  const others = (await getProvenZones()).filter(
    (z) => !(z.record && z.record.name === lapsed.name && z.record.value === lapsed.value)
  )

  const losing: LapsingSignInDomain[] = []
  for (const sso of covered) {
    if (provenZoneCovering(sso.name, others)) continue
    const own = await lookupVerificationTxt(
      `${SSO_VERIFY_RECORD_HOST}.${toAsciiDomain(sso.name)}`,
      interactiveResolver
    )
    if (!own.ok && own.reason === 'lookup-failed') return 'undecided'
    if (own.ok && own.values.includes(ssoVerifyRecordValue(sso.verificationToken))) continue
    losing.push(sso)
  }
  return losing
}
