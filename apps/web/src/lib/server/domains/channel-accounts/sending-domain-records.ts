/**
 * The records a sending domain's owner is asked to publish, composed from what
 * the provider reported and what the row was set up with: its ownership token
 * or signing key, the provider's DKIM CNAMEs where they sign, and the return
 * path (an MX and SPF TXT, or one CNAME to the operator's return path domain).
 */
import { randomBytes } from 'node:crypto'
import {
  sesDkimCnameTarget,
  sesMailFromMxValue,
  SES_MAIL_FROM_MX_PRIORITY,
  SES_MAIL_FROM_SPF_VALUE,
} from '@quackback/email/ses-identity'
import type { SesDomainIdentity } from '@quackback/email/ses-identity'
import type {
  SendingDomainDkimMode,
  SendingDomainDnsRecord,
  SendingDomainKeyRecord,
  SendingDomainOwnershipRecord,
} from '@/lib/server/db'

/**
 * The label the ownership token is published under.
 *
 * Underscore-prefixed, because that is the convention for a record meant for a
 * machine rather than a host, and it keeps the name out of the space a domain
 * owner might already be using for something real.
 */
export const OWNERSHIP_RECORD_HOST = '_quackback'

/** The prefix on the ownership TXT value, so a zone's owner can see what it is for. */
export const OWNERSHIP_VALUE_PREFIX = 'quackback-domain-verification='

/** A fresh ownership token: unguessable, and unique to one row. */
export function mintOwnershipToken(): string {
  return randomBytes(16).toString('hex')
}

/** The ownership record for a token. */
export function ownershipRecord(token: string): SendingDomainOwnershipRecord {
  return {
    type: 'TXT',
    host: OWNERSHIP_RECORD_HOST,
    value: `${OWNERSHIP_VALUE_PREFIX}${token}`,
    purpose: 'ownership',
  }
}

/**
 * The USABLE ownership records among a stored set.
 *
 * A record is usable only if it is a TXT under the ownership purpose AND its
 * value carries the prefix a token is issued under. The prefix test is not
 * decoration: the token is read back by removing that prefix, and a value
 * without it yields a slice of somebody else's string — a token that was never
 * issued, that the owner cannot publish, and that would keep the row pending
 * forever while looking like it was being checked. Discarding the record
 * instead makes the row re-issue a real one on the next poll.
 */
export function ownershipRecordsOf(
  records: SendingDomainDnsRecord[]
): SendingDomainOwnershipRecord[] {
  return records.filter(
    (r): r is SendingDomainOwnershipRecord =>
      r.purpose === 'ownership' && r.type === 'TXT' && r.value.startsWith(OWNERSHIP_VALUE_PREFIX)
  )
}

/**
 * The records a domain owner has to publish, composed from what the provider
 * reported plus the ownership token this row was minted with.
 *
 * The DKIM records come out empty while the provider is still issuing tokens,
 * which is a real state on a freshly created identity. The row is written with
 * whatever exists and the poll fills the rest in, rather than failing a create
 * over a value that arrives a moment later.
 */
export function sendingDomainDnsRecords(args: {
  domain: string
  region: string
  /** The `_quackback` token, for a row on the provider's own keys. */
  ownershipToken?: string
  identity: SesDomainIdentity | null
  /** The row's stored MAIL FROM label. */
  mailFromLabel: string
  /**
   * The row's own key records, for a row set up with a key of its own. They
   * replace the token: the key is the proof, and for `byo` also the signing
   * record.
   */
  signingKeys?: SendingDomainKeyRecord[]
  /**
   * `shared`: the identity signs with the key it already had, so its CNAMEs
   * are listed too when that key is the provider's. A key supplied elsewhere
   * cannot be read, so nothing is listed for it: the row's own key is the
   * signing record to publish, and the identity is re-keyed to it once it is
   * published (see `pending-signing-key.ts`).
   */
  dkimMode?: SendingDomainDkimMode
  /**
   * Where the return path CNAME points, for a row set up while the operator
   * serves bounce records under a domain of its own. The one CNAME then
   * replaces the MX and SPF TXT, which the operator publishes at the target.
   */
  returnPathTarget?: string | null
}): SendingDomainDnsRecord[] {
  const records: SendingDomainDnsRecord[] = args.signingKeys
    ? args.signingKeys.map(({ type, host, value, purpose }) => ({ type, host, value, purpose }))
    : [ownershipRecord(args.ownershipToken ?? '')]
  const providerKeys =
    !args.signingKeys ||
    (args.dkimMode === 'shared' &&
      (args.identity?.signingOrigin === 'ses' ||
        (!args.identity?.signingOrigin && (args.identity?.dkimTokens.length ?? 0) > 0)))
  for (const token of providerKeys ? (args.identity?.dkimTokens ?? []) : []) {
    records.push({
      type: 'CNAME',
      host: `${token}._domainkey`,
      value: sesDkimCnameTarget(token, {
        region: args.region,
        signingHostedZone: args.identity?.signingHostedZone,
      }),
      purpose: 'dkim',
    })
  }
  if (args.returnPathTarget) {
    records.push({
      type: 'CNAME',
      host: args.mailFromLabel,
      value: args.returnPathTarget,
      purpose: 'mail-from',
    })
    return records
  }
  records.push(
    {
      type: 'MX',
      host: args.mailFromLabel,
      value: sesMailFromMxValue(args.region),
      priority: SES_MAIL_FROM_MX_PRIORITY,
      purpose: 'mail-from',
    },
    {
      type: 'TXT',
      host: args.mailFromLabel,
      value: SES_MAIL_FROM_SPF_VALUE,
      purpose: 'mail-from',
    }
  )
  return records
}

/**
 * The return path CNAME target a row was set up with, or null for a row whose
 * return path is an MX and SPF TXT. Read from the row's own records, so a row
 * keeps the records it was set up with whatever the operator setting is now.
 */
export function storedReturnPathTarget(records: SendingDomainDnsRecord[]): string | null {
  return records.find((r) => r.purpose === 'mail-from' && r.type === 'CNAME')?.value ?? null
}

/** The identity of a record across a recompose: what to publish, where. */
function recordKey(r: SendingDomainDnsRecord): string {
  return `${r.type} ${r.host} ${r.value}`
}

/**
 * Carry each stored record's last check onto the recomposed set, so a lookup
 * that fails this time leaves the previous answer in place rather than none.
 */
export function withPreviousChecks(
  composed: SendingDomainDnsRecord[],
  stored: SendingDomainDnsRecord[]
): SendingDomainDnsRecord[] {
  const previous = new Map(stored.filter((r) => r.check).map((r) => [recordKey(r), r.check]))
  return composed.map((r) => {
    const check = previous.get(recordKey(r))
    return check ? { ...r, check } : r
  })
}
