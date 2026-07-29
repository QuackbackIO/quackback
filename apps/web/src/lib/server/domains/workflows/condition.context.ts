/**
 * The condition-context resolver (§4.6, Slice 4): reads the DB once to build the
 * `ConditionContext` snapshot the pure evaluator reads. The engine resolves this
 * once per trigger and reuses it across every condition in the workflow, so
 * evaluation stays DB-free and the snapshot is a single consistent instant.
 *
 * The triggering message (if any) is passed in by the caller — it comes from the
 * trigger event, not a query — so a "message contains X" condition sees the
 * message that fired the workflow, not merely the conversation's latest.
 *
 * `person`/`company` (person.attr.*, company.attr.*, person.email) are
 * resolved by one extra query alongside the rest (resolvePersonCompanyContext
 * below): the visitor principal's own attributes/email, plus their linked
 * company's attributes via principal.company_id. An anonymous visitor or one
 * with no company simply misses the corresponding join — the evaluator's
 * unresolved-subject contract (condition.evaluator.ts) already handles an
 * absent subject, so no special-casing is needed here beyond returning an
 * attribute-less snapshot. That join is skippable (`opts.resolvePersonCompany`
 * below) when the caller already knows nothing will ever read it.
 *
 * `ticket` (ticket.type) is resolved the same way, from the conversation's
 * paired CUSTOMER ticket (resolveTicketContext below) and behind its own
 * skip flag (`opts.resolveTicket`). Resolving it from the conversation rather
 * than from the trigger's payload is what makes it survive a resume: a run
 * parked at a wait re-resolves its snapshot from the conversation alone.
 */
import {
  db,
  and,
  eq,
  conversations,
  principal,
  user,
  companies,
  tickets,
  ticketConversations,
} from '@/lib/server/db'
import type { ConversationId, PrincipalId } from '@quackback/ids'
import { listTagsForConversation } from '@/lib/server/domains/conversation/conversation-tag.service'
import { segmentIdsForPrincipal } from '@/lib/server/domains/segments/segment-membership.service'
import { getOfficeHoursSchedule } from '@/lib/server/domains/settings/settings.office-hours'
import { isWithinOfficeHours } from '@/lib/shared/office-hours'
import { parseUserAttributes } from '@/lib/server/domains/users/user.attributes'
import { realEmail } from '@/lib/shared/anonymous-email'
import type { ConditionContext } from './condition.evaluator'

/**
 * The visitor principal's own attributes/email plus their company's
 * attributes, one query: principal -> (left) user -> (left) companies via
 * principal.company_id. Both joins miss cleanly for an anonymous visitor
 * (no userId) or an unlinked one (no companyId) — resolveConditionContext
 * folds the misses into `person`/`company` staying attribute-less, which the
 * evaluator's unresolved-subject contract already treats as a non-match.
 */
/** The unresolved shape resolvePersonCompanyContext returns when the caller's
 *  live workflows don't reference any person/company field — same "attribute-
 *  less snapshot" the evaluator's unresolved-subject contract already treats
 *  identically to an anonymous visitor's real miss, so skipping the join is
 *  observably indistinguishable from running it and finding nothing. */
const UNRESOLVED_PERSON_COMPANY = {
  person: { email: null, attributes: {} },
  company: null,
} as const

async function resolvePersonCompanyContext(principalId: PrincipalId): Promise<{
  person: { email: string | null; attributes: Record<string, unknown> }
  company: { attributes: Record<string, unknown> } | null
}> {
  const [row] = await db
    .select({
      userEmail: user.email,
      userMetadata: user.metadata,
      companyAttributes: companies.customAttributes,
    })
    .from(principal)
    .leftJoin(user, eq(user.id, principal.userId))
    .leftJoin(companies, eq(companies.id, principal.companyId))
    .where(eq(principal.id, principalId))
    .limit(1)

  return {
    // realEmail() strips the synthetic anonymous placeholder — an anonymous
    // visitor (no user row at all) already reads null via the left join.
    person: {
      email: realEmail(row?.userEmail ?? null),
      attributes: parseUserAttributes(row?.userMetadata ?? null),
    },
    company: row?.companyAttributes ? { attributes: row.companyAttributes } : null,
  }
}

/**
 * The CUSTOMER ticket paired with `conversationId`, as the snapshot's `ticket`
 * branch. The pair is 1:1 (ticket_conversations' two partial unique indexes —
 * see pair-thread.service.ts's PAIR RULE), so for a ticket trigger — whose
 * conversation was itself resolved FROM the ticket — this reads back the very
 * ticket that fired the workflow, and it keeps reading it on a resume, where
 * the trigger's own payload is long gone. One indexed lookup on
 * ticket_conversations' conversation index, joined to the ticket for its type.
 * Null when the conversation has no customer ticket.
 */
async function resolveTicketContext(
  conversationId: ConversationId
): Promise<ConditionContext['ticket']> {
  const [row] = await db
    .select({ ticketTypeId: tickets.ticketTypeId })
    .from(ticketConversations)
    .innerJoin(tickets, eq(tickets.id, ticketConversations.ticketId))
    .where(
      and(
        eq(ticketConversations.conversationId, conversationId),
        eq(ticketConversations.ticketType, 'customer')
      )
    )
    .limit(1)
  // A ticket predating the type registry has no ticketTypeId; `ticket.type`
  // reads unresolved either way, so the two cases need no distinction.
  return row ? { typeId: row.ticketTypeId } : null
}

/**
 * Build the condition snapshot for a conversation at instant `at` (default now).
 * Returns null when the conversation is gone. `opts.message` is the triggering
 * message body, if the trigger carried one.
 */
export async function resolveConditionContext(
  conversationId: ConversationId,
  opts: {
    message?: { body: string; senderType?: 'visitor' | 'agent' } | null
    at?: Date
    /** Threaded straight onto the returned snapshot — see ConditionContext's
     *  doc. Only resumeWorkflowRun ever passes this. */
    blockAnswer?: ConditionContext['blockAnswer']
    /** Threaded straight onto the returned snapshot — see ConditionContext's
     *  doc (Phase C, slice C-6). Only resumeWorkflowRun ever passes this. */
    assistantOutcome?: ConditionContext['assistantOutcome']
    /**
     * Whether to run resolvePersonCompanyContext's principal->user->companies
     * join at all. Default true. The dispatcher (dispatcher.ts) is the one
     * caller that ever passes `false`: it already has every live workflow for
     * this trigger in hand before resolving context, so it can cheaply check
     * whether ANY of them actually references a person./company. field
     * (audience or a graph condition) and skip the join entirely when none do
     * — a plain conversation-only workflow no longer pays for a join whose
     * result it can never read. Does NOT gate `person.segmentIds`
     * (segmentIdsForPrincipal below): that resolution predates this flag,
     * costs its own separate query, and `person.segments` isn't part of the
     * NEW join this flag controls.
     */
    resolvePersonCompany?: boolean
    /**
     * Whether to look the paired customer ticket up at all. Default true.
     * Same shape and same rationale as `resolvePersonCompany` above: the
     * dispatcher already holds every live workflow for this trigger, so it
     * skips the lookup when none of them reads `ticket.type` — an unpaired
     * snapshot is indistinguishable from a conversation with no customer
     * ticket, which the evaluator's unresolved-subject contract already
     * handles.
     */
    resolveTicket?: boolean
  } = {}
): Promise<ConditionContext | null> {
  const at = opts.at ?? new Date()
  const resolvePersonCompany = opts.resolvePersonCompany ?? true
  const resolveTicket = opts.resolveTicket ?? true
  const [conv] = await db
    .select({
      status: conversations.status,
      channel: conversations.channel,
      priority: conversations.priority,
      waitingSince: conversations.waitingSince,
      csatRating: conversations.csatRating,
      visitorPrincipalId: conversations.visitorPrincipalId,
      customAttributes: conversations.customAttributes,
      assignedTeamId: conversations.assignedTeamId,
    })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1)
  if (!conv) return null

  // Independent reads — run them together. Office hours come from the
  // workspace settings-blob schedule (the canonical hours source), evaluated
  // 24/7-open when disabled.
  const [tags, segmentIds, officeHoursSchedule, personCompany, ticket] = await Promise.all([
    listTagsForConversation(conversationId),
    segmentIdsForPrincipal(conv.visitorPrincipalId),
    getOfficeHoursSchedule(),
    resolvePersonCompany
      ? resolvePersonCompanyContext(conv.visitorPrincipalId)
      : Promise.resolve(UNRESOLVED_PERSON_COMPANY),
    resolveTicket ? resolveTicketContext(conversationId) : Promise.resolve(null),
  ])
  const officeHours = isWithinOfficeHours(officeHoursSchedule, at)

  const waitingMinutes = conv.waitingSince
    ? Math.max(0, Math.floor((at.getTime() - conv.waitingSince.getTime()) / 60000))
    : null

  return {
    conversation: {
      status: conv.status,
      channel: conv.channel,
      priority: conv.priority,
      waitingMinutes,
      tagIds: tags.map((t) => t.id),
      assignedTeamId: conv.assignedTeamId,
      // Raw envelopes; conversation.attr.<key> predicates unwrap on read.
      attributes: conv.customAttributes ?? {},
      visitorPrincipalId: conv.visitorPrincipalId,
    },
    message: opts.message ?? null,
    person: {
      segmentIds: [...segmentIds],
      email: personCompany.person.email,
      attributes: personCompany.person.attributes,
    },
    company: personCompany.company,
    ticket,
    officeHours,
    csatRating: conv.csatRating ?? null,
    blockAnswer: opts.blockAnswer ?? null,
    assistantOutcome: opts.assistantOutcome ?? null,
  }
}
