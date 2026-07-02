/**
 * Inbox memberships — N:M between principals and inboxes.
 * Distinct from team_memberships to allow cross-team staffing.
 */
import { db, eq, and, asc, inboxMemberships, inboxes, type InboxMembership } from '@/lib/server/db'
import type { Inbox } from '@/lib/shared/db-types'
import type { InboxMembershipRole } from '@/lib/server/db'
import type { InboxId, InboxMembershipId, PrincipalId } from '@quackback/ids'
import { NotFoundError, ValidationError } from '@/lib/shared/errors'
import {
  dispatchInboxMembershipAdded,
  dispatchInboxMembershipUpdated,
  dispatchInboxMembershipRemoved,
  type EventActor,
} from '@/lib/server/events/dispatch'
import type { EventInboxMembershipRef } from '@/lib/server/events/types'

const inboxMembershipActor: EventActor = { type: 'service', displayName: 'inbox-membership-system' }

function inboxMembershipRef(m: InboxMembership): EventInboxMembershipRef {
  return {
    id: m.id,
    inboxId: m.inboxId,
    principalId: m.principalId,
    role: m.role,
  }
}

export interface AddInboxMembershipInput {
  inboxId: InboxId
  principalId: PrincipalId
  role?: InboxMembershipRole
}

export async function addInboxMembership(input: AddInboxMembershipInput): Promise<InboxMembership> {
  if (!input.inboxId) throw new ValidationError('INBOX_REQUIRED', 'inboxId required')
  if (!input.principalId) throw new ValidationError('PRINCIPAL_REQUIRED', 'principalId required')

  const existing = await db.query.inboxMemberships.findFirst({
    where: and(
      eq(inboxMemberships.inboxId, input.inboxId),
      eq(inboxMemberships.principalId, input.principalId)
    ),
  })
  if (existing) return existing

  const [created] = await db
    .insert(inboxMemberships)
    .values({
      inboxId: input.inboxId,
      principalId: input.principalId,
      role: input.role ?? 'agent',
    })
    .returning()
  void dispatchInboxMembershipAdded(inboxMembershipActor, inboxMembershipRef(created)).catch(
    () => {}
  )
  return created
}

export async function updateInboxMembershipRole(
  membershipId: InboxMembershipId,
  role: InboxMembershipRole
): Promise<InboxMembership> {
  const existing = await db.query.inboxMemberships.findFirst({
    where: eq(inboxMemberships.id, membershipId),
  })
  if (!existing) throw new NotFoundError('INBOX_MEMBERSHIP_NOT_FOUND', 'Membership not found')
  if (existing.role === role) return existing
  const previousRole = existing.role
  const [updated] = await db
    .update(inboxMemberships)
    .set({ role })
    .where(eq(inboxMemberships.id, membershipId))
    .returning()
  void dispatchInboxMembershipUpdated(
    inboxMembershipActor,
    inboxMembershipRef(updated),
    previousRole
  ).catch(() => {})
  return updated
}

export async function removeInboxMembership(membershipId: InboxMembershipId): Promise<void> {
  const snapshot = await db.query.inboxMemberships.findFirst({
    where: eq(inboxMemberships.id, membershipId),
  })
  await db.delete(inboxMemberships).where(eq(inboxMemberships.id, membershipId))
  if (snapshot) {
    void dispatchInboxMembershipRemoved(inboxMembershipActor, inboxMembershipRef(snapshot)).catch(
      () => {}
    )
  }
}

export async function listMembershipsForInbox(inboxId: InboxId): Promise<InboxMembership[]> {
  return db
    .select()
    .from(inboxMemberships)
    .where(eq(inboxMemberships.inboxId, inboxId))
    .orderBy(asc(inboxMemberships.createdAt))
}

export async function listInboxesForPrincipal(
  principalId: PrincipalId
): Promise<InboxMembership[]> {
  return db
    .select()
    .from(inboxMemberships)
    .where(eq(inboxMemberships.principalId, principalId))
    .orderBy(asc(inboxMemberships.createdAt))
}

/**
 * Same as listInboxesForPrincipal, but joins through to the inboxes table so
 * the caller gets full inbox rows (name, slug, etc) instead of bare membership
 * rows. Used by the agent queue sidebar's "By inbox" group.
 */
export async function listInboxRowsForPrincipal(principalId: PrincipalId): Promise<Inbox[]> {
  const rows = await db
    .select({
      inbox: inboxes,
    })
    .from(inboxMemberships)
    .innerJoin(inboxes, eq(inboxMemberships.inboxId, inboxes.id))
    .where(eq(inboxMemberships.principalId, principalId))
    .orderBy(asc(inboxes.name))
  return rows.map((r) => r.inbox)
}
