/**
 * Where a workspace's proof that it controls a domain came from, in words a
 * settings page can show. The proofs themselves are read on the server (see
 * `domains/domain-proof/proven-zones.ts`).
 */
import { PERMISSIONS, type PermissionKey } from './permissions'

/**
 * - `email-sending`: a verified sending domain, proven by its own ownership
 *   record or its own key.
 * - `sso`: a verified single sign-on domain, proven by its own verification
 *   record. It counts for web addresses only, never for another single
 *   sign-on domain.
 * - `web-address`: an operator-managed hostname that is ready. It proves that
 *   exact hostname and nothing under or above it.
 */
export type ProvenZoneSource = 'email-sending' | 'sso' | 'web-address'

/**
 * A source as a viewer may see it: named when they may see what proved it,
 * otherwise `workspace`, which says only that this workspace holds a proof.
 */
export type ShownProofSource = ProvenZoneSource | 'workspace'

/** The permission that shows each kind of proof. */
const SOURCE_PERMISSION: Record<ProvenZoneSource, PermissionKey> = {
  'email-sending': PERMISSIONS.CHANNEL_ACCOUNT_MANAGE,
  sso: PERMISSIONS.AUTH_MANAGE,
  'web-address': PERMISSIONS.SETTINGS_CUSTOM_DOMAIN,
}

export function shownProofSource(
  source: ProvenZoneSource,
  permissions: readonly PermissionKey[]
): ShownProofSource {
  return permissions.includes(SOURCE_PERMISSION[source]) ? source : 'workspace'
}

const SOURCE_LABEL: Record<ProvenZoneSource, string> = {
  'email-sending': 'email sending',
  sso: 'single sign-on',
  'web-address': 'a web address',
}

/** "Verified through email sending" and the like. */
export function verifiedThroughLabel(source: ShownProofSource): string {
  return source === 'workspace'
    ? 'Verified by this workspace'
    : `Verified through ${SOURCE_LABEL[source]}`
}

/** For a pending domain another proof covers: "Already verified through email sending". */
export function pendingProvenLabel(source: ShownProofSource): string {
  return source === 'workspace'
    ? 'Already verified by this workspace'
    : `Already verified through ${SOURCE_LABEL[source]}`
}

/** The label a single sign-on domain's verification TXT is published under. */
export const SSO_VERIFY_RECORD_HOST = '_quackback-verify'

/** The value of a single sign-on domain's verification TXT. */
export function ssoVerifyRecordValue(token: string): string {
  return `qb-domain-verify=${token}`
}
