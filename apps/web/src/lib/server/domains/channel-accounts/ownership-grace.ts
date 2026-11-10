/**
 * The grace period a verified sending domain gets when its ownership record
 * goes missing.
 *
 * The ownership record has to stay published: the provider identity behind a
 * domain is shared by every workspace that adds it, so the provider's verdict
 * says nothing about which of them controls the zone, and the row's own record
 * is the only thing that does. A record removed by mistake is common, though,
 * so the first check that finds it gone warns the people who manage the domain
 * and keeps it verified; the row is demoted only if the record is still gone
 * when the period ends.
 */
import type { SendingDomainId } from '@quackback/ids'
import { and, db, eq, isNull, emailSendingDomains, type EmailSendingDomain } from '@/lib/server/db'
import { logger } from '@/lib/server/logger'
import type { OwnershipAnswer } from './domain-verification'
import { notifySendingDomainOwnershipMissing } from './sending-domain-notify'

const log = logger.child({ component: 'sending-domain-ownership-grace' })

/** How long a verified domain keeps sending as itself after its ownership record is first missed. */
export const SENDING_DOMAIN_OWNERSHIP_GRACE_DAYS = 7

const GRACE_MS = SENDING_DOMAIN_OWNERSHIP_GRACE_DAYS * 24 * 60 * 60 * 1000

/**
 * How early the period may end. Only the daily sweep demotes, and its start
 * time drifts from day to day, so without slack a row could outlive the date
 * the warning gave by most of a day.
 */
export const OWNERSHIP_GRACE_SLACK_MS = 60 * 60 * 1000

/** When a verified row whose ownership record went missing at `since` is demoted. */
export function ownershipGraceEnds(since: Date): Date {
  return new Date(since.getTime() + GRACE_MS)
}

/**
 * Where a check leaves a row's grace period: `since` is when its ownership
 * record went missing (the stored moment, or now on the first miss), null when
 * no period is running; `inGrace` is whether the row keeps its proof for it.
 * Only a verified row whose zone says the record is gone has a period at all.
 */
export function ownershipGrace(
  row: Pick<EmailSendingDomain, 'status' | 'ownershipMissingSince'>,
  ownership: OwnershipAnswer,
  now: Date
): { since: Date | null; inGrace: boolean } {
  if (row.status !== 'verified' || ownership !== 'absent') return { since: null, inGrace: false }
  const since = row.ownershipMissingSince ?? now
  return {
    since,
    inGrace: now.getTime() < ownershipGraceEnds(since).getTime() - OWNERSHIP_GRACE_SLACK_MS,
  }
}

/**
 * Start a row's grace period and warn its managers. Conditional, so whichever
 * check sees the first miss, and however many see it at once, the warning goes
 * out once. Returns the row when this call started the period, else null.
 */
export async function startOwnershipGrace(
  id: SendingDomainId,
  since: Date
): Promise<EmailSendingDomain | null> {
  const [started] = await db
    .update(emailSendingDomains)
    .set({ ownershipMissingSince: since })
    .where(and(eq(emailSendingDomains.id, id), isNull(emailSendingDomains.ownershipMissingSince)))
    .returning()
  if (!started) return null
  log.warn(
    { sending_domain_id: id, domain: started.domain },
    'sending domain ownership record is missing; keeping it verified for the grace period'
  )
  await notifySendingDomainOwnershipMissing(started, ownershipGraceEnds(since))
  return started
}
