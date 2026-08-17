/**
 * Push this workspace's team seats to the control plane.
 *
 * Same predicate the control plane used when it still read tenant databases:
 * identified humans (`principal.type = 'user'`) holding admin/member. Portal
 * end-users, anonymous visitors and service principals are not seats.
 *
 * Self-host has no control-plane URL: this is a successful no-op, not a
 * retry. A configured URL that does not answer stays on the job lease.
 */
import { and, db, eq, inArray, principal, user } from '@/lib/server/db'
import { pushWorkspaceMembership } from '@/lib/server/control-plane/client'
import { logger } from '@/lib/server/logger'
import type { ClaimedJob } from '@/lib/server/jobs/job-queue'

const log = logger.child({ component: 'membership-sync' })

export function isControlPlaneConfigured(): boolean {
  const raw = process.env.QUACKBACK_CONTROL_PLANE_URL
  return typeof raw === 'string' && raw.length > 0
}

/** The team addresses the control plane should record for this workspace. */
export async function listTeamSeatEmails(): Promise<string[]> {
  const rows = await db
    .select({ email: user.email })
    .from(principal)
    .innerJoin(user, eq(principal.userId, user.id))
    .where(and(eq(principal.type, 'user'), inArray(principal.role, ['admin', 'member'])))

  const emails = new Set<string>()
  for (const row of rows) {
    const key = row.email?.trim().toLowerCase()
    if (key) emails.add(key)
  }
  return [...emails]
}

export async function runMembershipSync(_job: ClaimedJob): Promise<void> {
  if (!isControlPlaneConfigured()) {
    log.debug('membership-sync skipped: no control plane')
    return
  }
  const emails = await listTeamSeatEmails()
  await pushWorkspaceMembership(emails)
}
