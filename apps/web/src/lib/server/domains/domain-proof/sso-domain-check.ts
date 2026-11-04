/**
 * Whether this workspace controls a single sign-on domain.
 *
 * A domain already proven another way (a verified sending domain at or above
 * it, or a ready web address that is exactly it) needs no record of its own,
 * so no lookup is made. Otherwise the domain's own verification TXT
 * decides, as before.
 */
import { lookupVerificationTxt } from '@/lib/server/auth/dns-verify'
import { interactiveResolver } from '@/lib/server/dns/resolver'
import {
  SSO_VERIFY_RECORD_HOST,
  ssoVerifyRecordValue,
  type ProvenZoneSource,
} from '@/lib/shared/domain-proof'
import { ssoDomainProvenBy } from './proven-zones'

export type SsoDomainCheck =
  | { ok: true; via: 'dns' | ProvenZoneSource }
  | { ok: false; reason: 'no-record' | 'lookup-failed' | 'mismatch' }

export async function checkSsoDomainOwnership(domain: {
  name: string
  verificationToken: string
}): Promise<SsoDomainCheck> {
  const provenBy = await ssoDomainProvenBy(domain.name)
  if (provenBy) return { ok: true, via: provenBy }

  // Run when someone clicks Verify, so the lookup gets a second try.
  const result = await lookupVerificationTxt(
    `${SSO_VERIFY_RECORD_HOST}.${domain.name}`,
    interactiveResolver
  )
  if (!result.ok) return { ok: false, reason: result.reason }
  if (!result.values.includes(ssoVerifyRecordValue(domain.verificationToken))) {
    return { ok: false, reason: 'mismatch' }
  }
  return { ok: true, via: 'dns' }
}
