/**
 * Where a workspace's proof that it controls a domain came from, in words a
 * settings page can show. The proofs themselves are read on the server (see
 * `domains/domain-proof/proven-zones.ts`).
 */
import { PERMISSIONS, type PermissionKey } from './permissions'

/**
 * - `email-sending`: a verified sending domain, proven by its own ownership
 *   record or its own key.
 * - `web-address`: an operator-managed hostname that is ready. It proves that
 *   exact hostname and nothing under or above it.
 */
export type ProvenZoneSource = 'email-sending' | 'web-address'

/**
 * A source as a viewer may see it: named when they may see what proved it,
 * otherwise `workspace`, which says only that this workspace holds a proof.
 */
export type ShownProofSource = ProvenZoneSource | 'workspace'

/** The permission that shows each kind of proof. */
const SOURCE_PERMISSION: Record<ProvenZoneSource, PermissionKey> = {
  'email-sending': PERMISSIONS.CHANNEL_ACCOUNT_MANAGE,
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
  'web-address': 'a web address',
}

/** "Verified through email sending" and the like. */
export function verifiedThroughLabel(source: ShownProofSource): string {
  return source === 'workspace'
    ? 'Verified, already proven by this workspace'
    : `Verified through ${SOURCE_LABEL[source]}`
}

/** For a pending domain another proof covers: "Already proven through email sending". */
export function pendingProvenLabel(source: ShownProofSource): string {
  return source === 'workspace'
    ? 'Already proven by this workspace'
    : `Already proven through ${SOURCE_LABEL[source]}`
}
