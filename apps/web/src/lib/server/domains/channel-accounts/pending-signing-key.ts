/**
 * The signing key a sending domain row holds while the identity it joined signs
 * with a key nobody can publish.
 *
 * ## Why a row ever holds its private key
 *
 * Every workspace shares one provider account, and nothing here can delete an
 * identity. So a workspace can add a domain it does not own and remove the row
 * again, and the identity stays behind, signing with a key whose public half
 * was only ever in that row. Nobody can publish that key, so the provider never
 * verifies it, and the domain's real owner, adding it later, would join an
 * identity that can never sign.
 *
 * A row that joins such an identity therefore keeps its own freshly minted
 * private key, encrypted, and once it proves ownership by publishing that
 * key's public half, the identity is re-keyed to it. The row then signs with
 * its own key like any row that created its identity, and the key is cleared.
 *
 * ## When the identity is re-keyed, and when never
 *
 * Only after this row has proved ownership of the zone: re-keying replaces the
 * key every sender on the account signs with for the domain, so doing it on
 * anything less would let any workspace break a working identity. And never
 * onto an identity whose DKIM already verifies, because somebody published its
 * key and it works; a row joining that keeps today's shared behaviour.
 *
 * The key is never returned, logged, or carried in an error or notification.
 */
import { putSesDkimSigningKey } from '@quackback/email/ses-identity'
import type { SesDomainIdentity } from '@quackback/email/ses-identity'
import { encrypt, decrypt } from '@/lib/server/encryption'
import { logger } from '@/lib/server/logger'
import {
  db,
  eq,
  emailSendingDomains,
  type EmailSendingDomain,
  type SendingDomainKeyRecord,
} from '@/lib/server/db'
import { isKeyRecord } from './dkim-key'

const log = logger.child({ component: 'sending-domain-signing-key' })

/** The key derivation purpose for a held signing key. */
export const PENDING_SIGNING_KEY_PURPOSE = 'sending-domain-signing-key'

/** Encrypt a private key for the row to hold. */
export function sealSigningKey(privateKey: string): string {
  return encrypt(privateKey, PENDING_SIGNING_KEY_PURPOSE)
}

/** Open a held private key. Throws when it cannot be opened. */
export function openSigningKey(sealed: string): string {
  return decrypt(sealed, PENDING_SIGNING_KEY_PURPOSE)
}

/**
 * Should a new row hold its key? Only when it joined an identity (rather than
 * creating one) that signs with a key supplied elsewhere and does not verify.
 * An identity on the provider's own keys lists records anyone can publish, and
 * one that verifies is working; neither needs replacing.
 */
export function shouldHoldSigningKey(creation: {
  identity: SesDomainIdentity
  preexisting: boolean
}): boolean {
  const { identity, preexisting } = creation
  return preexisting && identity.signingOrigin === 'external' && identity.dkimStatus !== 'SUCCESS'
}

/** The selector a key record is published under (`<selector>._domainkey`). */
function selectorOf(record: SendingDomainKeyRecord): string | null {
  const suffix = '._domainkey'
  return record.host.endsWith(suffix) ? record.host.slice(0, -suffix.length) || null : null
}

/**
 * Re-key the identity to the key this row holds, once the row has proved
 * ownership. Returns the row as it now stands and whether the identity was
 * re-keyed; a failure is logged and leaves the key held for the next check.
 *
 * `ownershipProven` must be this row's own proof, checked against its own key
 * record: it is the whole gate between a workspace and another's identity.
 */
export async function rekeyToHeldSigningKey(
  row: EmailSendingDomain,
  identity: SesDomainIdentity | null,
  ownershipProven: boolean
): Promise<{ row: EmailSendingDomain; rekeyed: boolean }> {
  const unchanged = { row, rekeyed: false }
  if (!ownershipProven || !row.pendingSigningKey || !identity) return unchanged
  if (identity.dkimStatus === 'SUCCESS') return unchanged
  const record = (row.dnsRecords ?? []).find(isKeyRecord)
  const selector = record ? selectorOf(record) : null
  if (!selector) return unchanged

  try {
    await putSesDkimSigningKey(row.domain, {
      selector,
      privateKey: openSigningKey(row.pendingSigningKey),
    })
  } catch (err) {
    // The error is the provider's or the decrypt's, never the key itself.
    log.warn(
      { err, sending_domain_id: row.id, domain: row.domain },
      're-keying the sending domain identity failed; the next check retries'
    )
    return unchanged
  }

  const [updated] = await db
    .update(emailSendingDomains)
    .set({ pendingSigningKey: null, dkimMode: 'byo', updatedAt: new Date() })
    .where(eq(emailSendingDomains.id, row.id))
    .returning()
  log.info(
    { sending_domain_id: row.id, domain: row.domain, selector },
    'sending domain identity re-keyed to the key its owner published'
  )
  return { row: updated ?? { ...row, pendingSigningKey: null, dkimMode: 'byo' }, rekeyed: true }
}
