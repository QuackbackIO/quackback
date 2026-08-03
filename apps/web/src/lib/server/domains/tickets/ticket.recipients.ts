/**
 * Portal-aware recipient resolver for ticket notifications.
 *
 * The notification dispatcher only knows about `principalId`s, but a ticket
 * can also reference its requester / participants by `contactId` (CRM-side).
 * When a contact is later linked to a portal user (`contact_user_links`),
 * that user's principal becomes a legitimate notification target.
 *
 * This module performs the contact → user → principal expansion in one
 * indexed SQL roundtrip and returns:
 *   - `principalIds`: every additional principal the dispatcher should
 *     consider (deduped, excludes nothing — the dispatcher decides).
 *   - `portalLinked`: the SUBSET of `principalIds` that were resolved via
 *     a contact link (i.e. portal users reached by ownership, not RBAC).
 *     The dispatcher uses this set both to (a) bypass the staff RBAC check
 *     for those principals and (b) drop them from non-public threads.
 */

import {
  db,
  eq,
  inArray,
  contactUserLinks,
  principal,
  ticketParticipants,
  type Ticket,
} from '@/lib/server/db'
import type { ContactId, PrincipalId, TicketId } from '@quackback/ids'

export interface PortalLinkedRecipients {
  /** Additional principals to consider as recipients (deduped). */
  principalIds: ReadonlyArray<PrincipalId>
  /**
   * The subset of `principalIds` reached via a contact link. The dispatcher
   * trusts these principals by ownership (bypassing the staff RBAC check)
   * and drops them from non-public thread audiences.
   */
  portalLinked: ReadonlySet<PrincipalId>
}

/**
 * Given a set of contact IDs, return every principal whose `userId` is linked
 * to one of those contacts via `contact_user_links`.
 *
 * Single SQL: `contact_user_links ⋈ principal ON principal.user_id = link.user_id`.
 * Both sides are indexed (`contact_user_links_user_idx`, `principal.user_id`).
 */
export async function resolvePrincipalsForContacts(
  contactIds: ReadonlyArray<ContactId>
): Promise<PrincipalId[]> {
  if (contactIds.length === 0) return []
  const rows = await db
    .selectDistinct({ id: principal.id })
    .from(contactUserLinks)
    .innerJoin(principal, eq(principal.userId, contactUserLinks.userId))
    .where(inArray(contactUserLinks.contactId, contactIds as ContactId[]))
  return rows.map((r) => r.id as PrincipalId)
}

/**
 * Resolve the additional portal-linked recipient set for a ticket.
 *
 * Inputs (read once):
 *   - `ticket.requesterContactId`
 *   - `ticket_participants` rows for this ticket (both principalId and contactId variants)
 *
 * Output:
 *   - `principalIds` = (participants.principalId ∪ resolvePrincipalsForContacts(requesterContactId ∪ participants.contactId))
 *   - `portalLinked` = principals reached only via the contact-link branch.
 *     Direct-`principalId` participants are NOT marked as portal-linked, even
 *     if they happen to be portal users — they're already addressable by RBAC.
 */
export async function resolvePortalLinkedRecipients(
  ticket: Pick<Ticket, 'id' | 'requesterContactId'>
): Promise<PortalLinkedRecipients> {
  const participants = await db
    .select({
      principalId: ticketParticipants.principalId,
      contactId: ticketParticipants.contactId,
    })
    .from(ticketParticipants)
    .where(eq(ticketParticipants.ticketId, ticket.id as TicketId))

  const directPrincipalIds = new Set<PrincipalId>()
  const contactIdSet = new Set<ContactId>()
  if (ticket.requesterContactId) contactIdSet.add(ticket.requesterContactId as ContactId)
  for (const p of participants) {
    if (p.principalId) directPrincipalIds.add(p.principalId as PrincipalId)
    if (p.contactId) contactIdSet.add(p.contactId as ContactId)
  }

  const linkedPrincipalIds =
    contactIdSet.size > 0 ? await resolvePrincipalsForContacts(Array.from(contactIdSet)) : []

  const portalLinked = new Set<PrincipalId>()
  for (const id of linkedPrincipalIds) {
    // Only mark as portal-linked if the principal isn't already a direct
    // participant (direct participants are addressable by RBAC).
    if (!directPrincipalIds.has(id)) portalLinked.add(id)
  }

  const all = new Set<PrincipalId>(directPrincipalIds)
  for (const id of linkedPrincipalIds) all.add(id)

  return { principalIds: Array.from(all), portalLinked }
}
