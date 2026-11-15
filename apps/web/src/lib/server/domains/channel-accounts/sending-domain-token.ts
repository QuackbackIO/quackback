/**
 * The ownership token issued to a sending row on the provider's own keys.
 *
 * When this workspace added the same name on Settings > Domains, the row is
 * issued that domain's token, so one `_quackback` record proves both. That
 * token was minted for the domain row in this workspace's own database and
 * never derived, so it says no more and no less than a fresh one would: only
 * someone who can write in the zone can publish it, and no other workspace's
 * database holds it.
 *
 * It goes to one sending row only. If another sending row here already carries
 * it, a fresh token is minted, so no two sending rows ever share one. The
 * check and the claim run under a transaction-scoped lock on the name. A domain
 * added at any other name, even one above this, is never used.
 */
import { and, db, domains, eq, ne, sql, emailSendingDomains } from '@/lib/server/db'
import type { SendingDomainId } from '@quackback/ids'
import { toAsciiDomain } from '@/lib/server/utils/mail-domain'
import { mintOwnershipToken, ownershipRecord } from './sending-domain-records'

export async function issueOwnershipToken(row: {
  id: SendingDomainId
  domain: string
}): Promise<string> {
  const name = toAsciiDomain(row.domain)
  if (!name) return mintOwnershipToken()
  // Under a lock on the name, check and claim in one step: the token is
  // written onto this row before the lock is released, so a second row being
  // issued at the same moment sees it taken.
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`quackback:domain-token:${name}`}))`
    )
    const [added] = await tx
      .select({ token: domains.ownershipToken })
      .from(domains)
      .where(eq(domains.name, name))
      .limit(1)
    if (!added?.token) return mintOwnershipToken()
    const record = ownershipRecord(added.token)
    const [taken] = await tx
      .select({ id: emailSendingDomains.id })
      .from(emailSendingDomains)
      .where(
        and(
          ne(emailSendingDomains.id, row.id),
          sql`${emailSendingDomains.dnsRecords} @> ${JSON.stringify([{ purpose: record.purpose, value: record.value }])}::jsonb`
        )
      )
      .limit(1)
    if (taken) return mintOwnershipToken()
    // The claim: this row's ownership record, ahead of whatever it held.
    await tx
      .update(emailSendingDomains)
      .set({
        dnsRecords: sql`${JSON.stringify([record])}::jsonb || COALESCE((SELECT jsonb_agg(r) FROM jsonb_array_elements(${emailSendingDomains.dnsRecords}) r WHERE r->>'purpose' <> 'ownership'), '[]'::jsonb)`,
      })
      .where(eq(emailSendingDomains.id, row.id))
    return added.token
  })
}
