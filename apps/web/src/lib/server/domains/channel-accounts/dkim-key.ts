/**
 * The signing key a new sending domain is created with.
 *
 * Each row gets its own 2048-bit RSA key under its own selector. The public
 * half is the one DKIM record the domain's owner publishes. At 2048 bits the
 * value is longer than one 255-character TXT string, so DNS carries it as
 * several strings of one record; most DNS hosts split a long value themselves,
 * and the rest take it pasted as quoted parts. Rows created with a 1024-bit
 * key keep it: the key is fixed once the provider holds its private half. The
 * private half is handed to the mail provider when the identity is created and
 * dropped: it is never stored, logged or returned.
 *
 * Because the key is random and unique to the row, finding it published in
 * the domain's zone is also the proof that this workspace controls the zone.
 */
import { generateKeyPairSync, randomBytes } from 'node:crypto'
import type { SendingDomainKeyRecord } from '@/lib/server/db'

export interface GeneratedDkimKey {
  /** `qb` plus eight hex characters, unique to the row. */
  selector: string
  /** The TXT to publish at `<selector>._domainkey`. */
  record: SendingDomainKeyRecord
  /** Base64 PKCS#1 DER, the form the provider takes. For the create call only. */
  privateKey: string
}

export function generateDkimKey(): GeneratedDkimKey {
  const selector = `qb${randomBytes(4).toString('hex')}`
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs1', format: 'der' },
  })
  return {
    selector,
    record: {
      type: 'TXT',
      host: `${selector}._domainkey`,
      value: `v=DKIM1; k=rsa; p=${publicKey.toString('base64')}`,
      purpose: 'dkim',
    },
    privateKey: privateKey.toString('base64'),
  }
}

/** The `p=` key of a DKIM TXT value, whitespace removed, or null when it has none. */
export function dkimPublicKeyOf(value: string): string | null {
  for (const tag of value.split(';')) {
    const eq = tag.indexOf('=')
    if (eq < 0 || tag.slice(0, eq).trim().toLowerCase() !== 'p') continue
    const key = tag.slice(eq + 1).replace(/\s+/g, '')
    return key || null
  }
  return null
}

/** Whether a stored record is a row-minted signing key (and so a proof record). */
export function isKeyRecord(record: {
  type: string
  purpose: string
  value: string
}): record is SendingDomainKeyRecord {
  return (
    record.type === 'TXT' && record.purpose === 'dkim' && dkimPublicKeyOf(record.value) !== null
  )
}
