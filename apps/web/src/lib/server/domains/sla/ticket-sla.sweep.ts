/**
 * Ticket TTR sweeps (support platform §4.6) — the scan/claim twins of
 * ticket-sla.service.ts's lazy recorders, split out of that module to keep
 * both under the domain max-lines budget. The ticket TTR clock gets its own
 * skeleton here rather than widening sla.service.ts's conversation sweeps:
 * the conversation skeleton is bound to the conversations table and iterates
 * a three-clock descriptor table, while a ticket carries exactly ONE clock —
 * a small parallel skeleton reads cleaner than a table-polymorphic one. All
 * three twins keep the conversation side's invariants (see its docs): SQL
 * only narrows the scan, the recording/claiming rule lives in JS, and every
 * claim is the same jsonb-merge CAS every other stamp writer uses, so a lazy
 * settle, a pause/resume, or a re-apply racing the sweep can never produce a
 * duplicate event or clobber a newer stamp.
 *
 * Wiring: sweepOverdueTicketSlaBreaches rides the per-minute
 * sla-breach-sweep-queue tick (reporting axis — records the
 * `time_to_resolve_breached` sla_events row even for back-office tickets);
 * sweepApproachingTicketSlaBreaches / sweepTicketSlaBreachTriggers ride
 * workflow-sweep.ts's 5-minute sweepSlaTimerTriggers (workflow-trigger axis —
 * dispatch needs the ticket's linked CUSTOMER conversation, so back-office
 * tickets are claimed but never dispatched; see resolveTicketTriggerTarget).
 */
import {
  db,
  and,
  eq,
  isNull,
  isNotNull,
  sql,
  tickets,
  ticketConversations,
  conversations,
} from '@/lib/server/db'
import type { ConversationId, SlaPolicyId, TicketId } from '@quackback/ids'
import type { EventConversationRef, EventTicketRef } from '@/lib/server/events/types'
import {
  insertTicketClockEvent,
  ticketSlaStampGuard,
  type TicketSlaApplied,
} from './ticket-sla.service'

// Upper bound on tickets handled per sweep run; anything beyond waits for the
// next tick (the SQL filter keeps re-finding them).
const TICKET_SWEEP_BATCH_LIMIT = 500

/** A row the ticket sweep scan selects: the SLA stamp plus the EventTicketRef
 *  fields the two timer-trigger sweeps need to build each claimed candidate's
 *  `ticket` ref (webhook payload parity with the ticket domain's own events —
 *  see ticket.webhooks.ts's ticketRef). */
interface TicketSlaSweepRow {
  id: TicketId
  slaApplied: unknown
  number: number
  type: EventTicketRef['type']
  priority: EventTicketRef['priority']
  assigneePrincipalId: string | null
  assigneeTeamId: string | null
}

/** Build the EventTicketRef a dispatched ticket-clock trigger embeds, from a
 *  scan row (same field mapping as ticket.webhooks.ts's ticketRef). */
function ticketRefFromRow(row: TicketSlaSweepRow): EventTicketRef {
  return {
    id: row.id,
    number: row.number,
    type: row.type,
    priority: row.priority,
    assignedPrincipalId: row.assigneePrincipalId,
    assignedTeamId: row.assigneeTeamId,
  }
}

/**
 * Claim `markerField` on `ticketId`'s stamp via the same guarded jsonb-merge
 * CAS every stamp writer in this domain uses (ticketSlaStampGuard), narrowed
 * to the exact due date and to the marker still being unset — optionally ALSO
 * re-checking `resolvedAt` under that same guard (only
 * sweepOverdueTicketSlaBreaches passes it, closing the race a lazy settle
 * landing between this sweep's SELECT and its own UPDATE would otherwise slip
 * through: the settle doesn't change `appliedAt`/`pausedAt`, so the guard
 * alone wouldn't catch it — see sla.service.ts's sweepOverdueSlaBreaches doc,
 * which this mirrors). Returns whether the claim landed. Shared by all three
 * sweep passes so the CAS predicate can't drift between them.
 */
async function claimTicketSlaMarker(
  ticketId: TicketId,
  applied: TicketSlaApplied,
  markerField: string,
  dueAt: string,
  at: Date,
  extraUnsetFields: string[] = []
): Promise<boolean> {
  const claimed = await db
    .update(tickets)
    .set({
      slaApplied: sql`${tickets.slaApplied} || ${JSON.stringify({
        [markerField]: at.toISOString(),
      })}::jsonb`,
      updatedAt: at,
    })
    .where(
      and(
        ticketSlaStampGuard(ticketId, applied.appliedAt, null),
        sql`(${tickets.slaApplied} ->> 'timeToResolveDueAt') = ${dueAt}`,
        sql`(${tickets.slaApplied} ->> ${markerField}) IS NULL`,
        ...extraUnsetFields.map((field) => sql`(${tickets.slaApplied} ->> ${field}) IS NULL`)
      )
    )
    .returning({ id: tickets.id })
  return claimed.length > 0
}

/**
 * The scan-and-claim skeleton shared by the three ticket sweep passes below:
 * fetch every non-deleted ticket with an active (non-paused) SLA whose stamp
 * satisfies `buildWindowSql` (batched at TICKET_SWEEP_BATCH_LIMIT), re-check
 * `isEligible` in JS (SQL only narrows the scan; the recording/claiming rule
 * always lives in JS, per every sweep in this domain) and, if still eligible,
 * atomically claim `markerField` via claimTicketSlaMarker. `onClaimed` runs
 * only after a landed claim: the one place the three passes diverge (log an
 * sla_events row vs. resolve the customer conversation and push a
 * workflow-trigger candidate).
 *
 * The WHERE repeats the `tickets_sla_unsettled_idx` partial-index predicate
 * VERBATIM as its own top-level AND clause (migration 0212; the same
 * convention the conversation sweep keeps for conversations_sla_unsettled_idx
 * — see sla.service.ts's scanAndClaimSlaClocks), so the planner can prove the
 * index applies via a literal clause match instead of having to reason
 * through the OR structure of `buildWindowSql`. Soft-deleted tickets are
 * excluded outright (no analogue on the conversation side, which has no
 * deletedAt): a deleted ticket's clock must neither report a breach nor fire
 * a workflow. Status-category-blind beyond that, mirroring the conversation
 * sweeps' documented status-blindness: a pending ticket under a no-pause
 * policy legitimately keeps running and can breach, and whether a breach on
 * an unusual status is actionable is left to the workflow's own conditions.
 */
async function scanAndClaimTicketSla(
  at: Date,
  buildWindowSql: (nowIso: string) => ReturnType<typeof sql>,
  isEligible: (applied: TicketSlaApplied, dueAt: string) => boolean,
  markerField: keyof TicketSlaApplied,
  extraUnsetFields: (keyof TicketSlaApplied)[],
  onClaimed: (row: TicketSlaSweepRow, applied: TicketSlaApplied, dueAt: string) => Promise<void>
): Promise<void> {
  const nowIso = at.toISOString() // ISO-8601 compares lexicographically = chronologically
  const rows = await db
    .select({
      id: tickets.id,
      slaApplied: tickets.slaApplied,
      number: tickets.number,
      type: tickets.type,
      priority: tickets.priority,
      assigneePrincipalId: tickets.assigneePrincipalId,
      assigneeTeamId: tickets.assigneeTeamId,
    })
    .from(tickets)
    .where(
      and(
        isNotNull(tickets.slaApplied),
        isNull(tickets.deletedAt),
        sql`(${tickets.slaApplied} ->> 'pausedAt') IS NULL`,
        // Redundant given isNotNull + buildWindowSql's own settled-field arm —
        // repeated VERBATIM as its own top-level clause, matching
        // tickets_sla_unsettled_idx's predicate (migration 0212), so the
        // planner proves the partial index applies via a literal match.
        sql`${tickets.slaApplied} IS NOT NULL AND (${tickets.slaApplied} ->> 'resolvedAt') IS NULL`,
        buildWindowSql(nowIso)
      )
    )
    .limit(TICKET_SWEEP_BATCH_LIMIT)

  for (const row of rows) {
    // Re-check in JS (the recording rule lives here; SQL only narrows the scan).
    const applied = row.slaApplied as TicketSlaApplied
    if (applied.pausedAt) continue // paused clocks are stopped, never eligible
    const dueAt = applied.timeToResolveDueAt
    if (!dueAt || !isEligible(applied, dueAt)) continue
    const landed = await claimTicketSlaMarker(
      row.id,
      applied,
      markerField,
      dueAt,
      at,
      extraUnsetFields
    )
    if (!landed) continue // settled, paused, re-applied, or claimed meanwhile
    await onClaimed(row, applied, dueAt)
  }
}

/**
 * The ticket breach sweep (run every minute by sla-breach-sweep-queue,
 * alongside the conversation pass): find tickets whose stamped TTR deadline
 * has passed with no settle and no breach noted yet, and record the breach —
 * ticket-anchored (`time_to_resolve_breached` with ticket_id set,
 * conversation_id NULL), so a back-office ticket's breach is a first-class
 * reportable fact even though it can never dispatch a workflow trigger (see
 * the trigger sweeps' doc below).
 *
 * Exactly-once + pause-aware per scanAndClaimTicketSla's doc: each breach is
 * CLAIMED before its event is logged, the claim's CAS additionally re-checks
 * `resolvedAt` itself (the lazy-settle race — see claimTicketSlaMarker), and
 * a currently-paused stamp never breaches. Returns the number recorded.
 */
export async function sweepOverdueTicketSlaBreaches(
  at: Date = new Date()
): Promise<{ recorded: number }> {
  let recorded = 0
  await scanAndClaimTicketSla(
    at,
    (nowIso) => sql`(
          (${tickets.slaApplied} ->> 'timeToResolveDueAt') < ${nowIso}
          AND (${tickets.slaApplied} ->> 'resolvedAt') IS NULL
          AND (${tickets.slaApplied} ->> 'resolutionBreachedAt') IS NULL
        )`,
    (applied, dueAt) =>
      !applied.resolvedAt &&
      !applied.resolutionBreachedAt &&
      at.getTime() > new Date(dueAt).getTime(),
    'resolutionBreachedAt',
    ['resolvedAt'],
    async (row, applied, dueAt) => {
      await insertTicketClockEvent(row.id, applied.policyId, 'time_to_resolve_breached', dueAt, at)
      recorded++
    }
  )
  return { recorded }
}

/** One claimed ticket-clock trigger candidate, ready for workflow-sweep.ts to
 *  dispatch as a synthetic sla.approaching_breach / sla.breached event. The
 *  conversation side of the payload (conversationId + conversation ref) is
 *  the ticket's linked CUSTOMER conversation, resolved at claim time — ALL
 *  workflow runs are conversation-context, so a ticket clock's trigger must
 *  ride the conversation the ticket is anchored to. */
export interface TicketSlaTimerTriggerCandidate {
  conversationId: ConversationId
  conversation: EventConversationRef
  ticketId: TicketId
  ticket: EventTicketRef
  policyId: SlaPolicyId
  clock: 'time_to_resolve'
  dueAt: string
}

/**
 * Resolve the dispatch target for a claimed ticket-clock candidate: the
 * ticket's linked CUSTOMER conversation (ticket_conversations where
 * ticketType = 'customer' — the same join event-trigger.ts's
 * resolveTicketConversationId uses for the ticket.created /
 * ticket.status_changed triggers), plus the conversation row's
 * EventConversationRef fields. Returns null when the ticket has no customer
 * conversation — a BACK-OFFICE ticket. In that case the caller still keeps
 * the fire-once marker it claimed (a later tick must not re-claim and
 * re-attempt a dispatch that can never succeed) but SKIPS the dispatch
 * entirely: there is no conversation context to run a workflow against.
 * This is a documented v1 limitation — back-office TTR breaches still record
 * their sla_events rows via sweepOverdueTicketSlaBreaches above (the
 * reporting axis needs no conversation); only the workflow-trigger axis is
 * conversation-bound. Per-claim lookups (not a scan join) keep the scan
 * query's verbatim partial-index predicate provable; claims are rare (each
 * marker fires at most once per SLA application), so the extra two SELECTs
 * per claim never hot-path.
 */
async function resolveTicketTriggerTarget(
  ticketId: TicketId
): Promise<{ conversationId: ConversationId; conversation: EventConversationRef } | null> {
  const [link] = await db
    .select({ conversationId: ticketConversations.conversationId })
    .from(ticketConversations)
    .where(
      and(
        eq(ticketConversations.ticketId, ticketId),
        eq(ticketConversations.ticketType, 'customer')
      )
    )
    .limit(1)
  if (!link) return null
  const conversationId = link.conversationId as ConversationId
  const [conv] = await db
    .select({
      status: conversations.status,
      channel: conversations.channel,
      priority: conversations.priority,
      assignedTeamId: conversations.assignedTeamId,
    })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1)
  if (!conv) return null // link outlived its conversation (cascade races the claim)
  return {
    conversationId,
    conversation: {
      id: conversationId,
      status: conv.status as EventConversationRef['status'],
      channel: conv.channel as EventConversationRef['channel'],
      priority: conv.priority as EventConversationRef['priority'],
      assignedTeamId: conv.assignedTeamId,
    },
  }
}

/**
 * Scan for tickets whose unsettled TTR clock enters the approaching-breach
 * lead window (`due - leadMinutes <= now < due`) and claim
 * `resolutionWarningFiredAt` for each — CAS-guarded exactly like
 * sweepOverdueTicketSlaBreaches's `resolutionBreachedAt` claim, just on a
 * different marker field, so the two never block each other (mirroring the
 * conversation side's distinct-marker rule). Pause-aware the same way.
 * Already-due clocks are excluded — those are sla.breached's job, not a
 * warning. Returns the claimed, dispatchable candidates for the caller
 * (workflow-sweep.ts); back-office tickets are claimed but never returned
 * (see resolveTicketTriggerTarget's doc).
 */
export async function sweepApproachingTicketSlaBreaches(
  leadMinutes: number,
  at: Date = new Date()
): Promise<TicketSlaTimerTriggerCandidate[]> {
  const horizon = new Date(at.getTime() + leadMinutes * 60_000).toISOString()
  const claimed: TicketSlaTimerTriggerCandidate[] = []
  await scanAndClaimTicketSla(
    at,
    (nowIso) => sql`(
          (${tickets.slaApplied} ->> 'timeToResolveDueAt') > ${nowIso}
          AND (${tickets.slaApplied} ->> 'timeToResolveDueAt') <= ${horizon}
          AND (${tickets.slaApplied} ->> 'resolvedAt') IS NULL
          AND (${tickets.slaApplied} ->> 'resolutionBreachedAt') IS NULL
          AND (${tickets.slaApplied} ->> 'resolutionWarningFiredAt') IS NULL
        )`,
    (applied, dueAt) => {
      if (applied.resolvedAt || applied.resolutionBreachedAt) return false
      if (applied.resolutionWarningFiredAt) return false
      const dueMs = new Date(dueAt).getTime()
      return dueMs > at.getTime() && dueMs <= at.getTime() + leadMinutes * 60_000
    },
    'resolutionWarningFiredAt',
    [],
    async (row, applied, dueAt) => {
      const target = await resolveTicketTriggerTarget(row.id)
      if (!target) return // back-office ticket: marker claimed, dispatch skipped (v1)
      claimed.push({
        ...target,
        ticketId: row.id,
        ticket: ticketRefFromRow(row),
        policyId: applied.policyId,
        clock: 'time_to_resolve',
        dueAt,
      })
    }
  )
  return claimed
}

/**
 * Scan for tickets whose unsettled TTR clock has passed its due date and
 * claim `resolutionBreachTriggerFiredAt` for each — independent of (and in
 * addition to) sweepOverdueTicketSlaBreaches's own `resolutionBreachedAt`
 * claim above: different marker field, so whichever of the per-minute
 * reporting sweep or this 5-minute trigger sweep runs first never blocks the
 * other. No lead time: this fires the instant `now >= due`, same as the
 * reporting sweep's own breach detection. Returns the claimed, dispatchable
 * candidates for the caller (workflow-sweep.ts); back-office tickets are
 * claimed but never returned (see resolveTicketTriggerTarget's doc).
 */
export async function sweepTicketSlaBreachTriggers(
  at: Date = new Date()
): Promise<TicketSlaTimerTriggerCandidate[]> {
  const claimed: TicketSlaTimerTriggerCandidate[] = []
  await scanAndClaimTicketSla(
    at,
    (nowIso) => sql`(
          (${tickets.slaApplied} ->> 'timeToResolveDueAt') < ${nowIso}
          AND (${tickets.slaApplied} ->> 'resolvedAt') IS NULL
          AND (${tickets.slaApplied} ->> 'resolutionBreachTriggerFiredAt') IS NULL
        )`,
    (applied, dueAt) => {
      if (applied.resolvedAt) return false
      if (applied.resolutionBreachTriggerFiredAt) return false
      return at.getTime() > new Date(dueAt).getTime()
    },
    'resolutionBreachTriggerFiredAt',
    [],
    async (row, applied, dueAt) => {
      const target = await resolveTicketTriggerTarget(row.id)
      if (!target) return // back-office ticket: marker claimed, dispatch skipped (v1)
      claimed.push({
        ...target,
        ticketId: row.id,
        ticket: ticketRefFromRow(row),
        policyId: applied.policyId,
        clock: 'time_to_resolve',
        dueAt,
      })
    }
  )
  return claimed
}
