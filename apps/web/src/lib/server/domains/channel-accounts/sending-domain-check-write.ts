/**
 * Writing what one check of a sending domain found.
 *
 * This is the one place a domain stops verifying, whether the daily sweep, the
 * watch job or a person's click found it. Only a check that started from a
 * verified row may take it off verified, and only through a conditional
 * update, so when two checks find it failing at once exactly one of them
 * reports the demotion. The demotion and the rest of the write commit
 * together; the caller tells the managers after the commit.
 */
import type { SendingDomainId } from '@quackback/ids'
import { and, db, eq, sql, emailSendingDomains, type EmailSendingDomain } from '@/lib/server/db'

/** Every column a check writes besides the status. */
type CheckFields = Partial<
  Pick<
    typeof emailSendingDomains.$inferInsert,
    | 'dnsRecords'
    | 'preflight'
    | 'ownershipMissingSince'
    | 'ownershipWarningClaimedAt'
    | 'ownershipWarningSentAt'
    | 'lastCheckedAt'
    | 'updatedAt'
  >
>

/**
 * Save a check's findings. A `verified` verdict leaves the status alone: the
 * move to verified is made on its own, conditionally, by the caller. Any other
 * verdict never overwrites a verified status unless this check started from a
 * verified row and its conditional demotion won; a row promoted while a check
 * that began on it as pending was reading stays verified. `demoted` is true
 * only for the check whose update moved the row off verified.
 */
export async function saveSendingDomainCheck(
  id: SendingDomainId,
  check: {
    status: EmailSendingDomain['status']
    wasVerified: boolean
    now: Date
    fields: CheckFields
  }
): Promise<{ demoted: boolean; written: EmailSendingDomain | undefined }> {
  const { status, wasVerified, now, fields } = check
  const promoted = status === 'verified'
  return db.transaction(async (tx) => {
    const [moved] =
      promoted || !wasVerified
        ? []
        : await tx
            .update(emailSendingDomains)
            .set({ status, updatedAt: now })
            .where(and(eq(emailSendingDomains.id, id), eq(emailSendingDomains.status, 'verified')))
            .returning({ id: emailSendingDomains.id })
    const [written] = await tx
      .update(emailSendingDomains)
      .set({
        ...(promoted
          ? {}
          : {
              status: sql`CASE WHEN ${emailSendingDomains.status} = 'verified' THEN ${emailSendingDomains.status} ELSE ${status} END`,
            }),
        ...fields,
      })
      .where(eq(emailSendingDomains.id, id))
      .returning()
    return { demoted: !!moved, written }
  })
}
