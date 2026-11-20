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
 * One whose own lookup goes unanswered is `undecided`: it is left as it is for
 * now and judged again on a later run, while the others are judged at once. A
 * failed lookup never keeps the lapsed domain itself proven.
 */
import { db, isNotNull, ssoVerifiedDomain, type Domain } from '@/lib/server/db'
import { lookupVerificationTxt } from '@/lib/server/auth/dns-verify'
import { interactiveResolver } from '@/lib/server/dns/resolver'
import { SSO_VERIFY_RECORD_HOST, ssoVerifyRecordValue } from '@/lib/shared/domain-proof'
import { isAtOrUnder, toAsciiDomain } from '@/lib/server/domains/channel-accounts/outbound-identity'
import { getProvenZones, provenZoneCovering, zonesBesidesDomain } from './proven-zones'

export interface LapsingSignInDomain {
  id: (typeof ssoVerifiedDomain.$inferSelect)['id']
  name: string
  /** The token it was judged with, so a row rotated since is left alone. */
  verificationToken: string
}

export interface SignInLapse {
  /** No proof of any kind covers these now. */
  losing: LapsingSignInDomain[]
  /** Their own lookup went unanswered; judged again on a later run. */
  undecided: string[]
}

export async function signInDomainsLosingProof(
  domain: Pick<Domain, 'name' | 'ownershipToken'>
): Promise<SignInLapse> {
  const none: SignInLapse = { losing: [], undecided: [] }
  const zone = toAsciiDomain(domain.name)
  if (!zone) return none
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
  if (covered.length === 0) return none

  // Every other proof this workspace holds, less any resting on the lapsed
  // record. Sign-in domains are left out, as everywhere: one never proves another.
  const others = zonesBesidesDomain(domain, await getProvenZones())

  const losing: LapsingSignInDomain[] = []
  const undecided: string[] = []
  for (const sso of covered) {
    if (provenZoneCovering(sso.name, others)) continue
    const own = await lookupVerificationTxt(
      `${SSO_VERIFY_RECORD_HOST}.${toAsciiDomain(sso.name)}`,
      interactiveResolver
    )
    if (!own.ok && own.reason === 'lookup-failed') {
      undecided.push(sso.name)
      continue
    }
    if (own.ok && own.values.includes(ssoVerifyRecordValue(sso.verificationToken))) continue
    losing.push(sso)
  }
  return { losing, undecided }
}
