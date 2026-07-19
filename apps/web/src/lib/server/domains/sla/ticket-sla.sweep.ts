/**
 * Ticket TTR sweeps (support platform §4.6) — the scan/claim twins of
 * ticket-sla.service.ts's lazy recorders, split out of that module to keep
 * both under the domain max-lines budget. The ticket TTR clock gets its own
 * skeleton here rather than widening sla.sweep.ts's conversation sweeps:
 * the conversation skeleton is bound to the conversations table and iterates
 * a three-clock descriptor table, while a ticket carries exactly ONE clock —
 * a small parallel skeleton reads cleaner than a table-polymorphic one. All
 * three twins keep the conversation side's invariants (see its docs): SQL
 * only narrows the scan, the recording/claiming rule lives in JS, and every
 * stamp write is the shared guarded jsonb-merge (commitTicketStamp) every
 * other stamp writer uses, so a lazy settle, a pause/resume, or a re-apply
 * racing the sweep can never produce a duplicate event or clobber a newer
 * stamp.
 *
 * Wiring + claim ordering (mirroring the conversation side — see
 * sla.sweep.ts's module doc):
 *  - sweepOverdueTicketSlaBreaches rides the per-minute
 *    sla-breach-sweep-queue tick (the REPORTING axis): claims the breach-noted
 *    marker and appends the sla_events row, atomically in one transaction;
 *  - sweepApproachingTicketSlaBreaches / sweepTicketSlaBreachTriggers ride
 *    workflow-sweep.ts's 5-minute sweepSlaTimerTriggers (the workflow-TRIGGER
 *    axis): they scan candidates WITHOUT claiming, and the fire-once marker
 *    is claimed by the caller only AFTER the candidate's dispatch was
 *    successfully enqueued (claim-after-enqueue — see
 *    claimTicketSlaTimerTriggerMarker's doc). Dispatch needs the ticket's
 *    linked CUSTOMER conversation, so back-office tickets are never returned
 *    as candidates; their marker is claimed inline instead — see
 *    resolveTicketTriggerTarget.
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
  commitTicketStamp,
  insertTicketClockEvent,
  type TicketSlaApplied,
} from './ticket-sla.service'
import type { StampExecutor } from './sla.service'

// Upper bound on tickets handled per sweep run; anything beyond waits for the
// next tick (the SQL filter keeps re-finding them).
const TICKET_SWEEP_BATCH_LIMIT = 500

/** A row the ticket sweep scan selects: the SLA stamp plus the EventTicketRef
 *  fields the two timer-trigger sweeps need to build each candidate's
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
 * Claim `markerField` on a scanned ticket's stamp via the shared guarded
 * merge-write (commitTicketStamp), with the claim's canonical guard shape so
 * the call sites can't drift (identical to the conversation side's
 * claimSlaClockMarker — see its doc):
 *
 *  - identity CAS on `(appliedAt, pausedAt: null)` — the stamp must still be
 *    the exact un-paused application the scan read;
 *  - the TTR deadline PINNED to the scanned one — a pause+resume cycle
 *    between scan and claim keeps pausedAt null but shifts the deadline;
 *  - the marker itself still unset — the fire-once/record-once CAS;
 *  - `resolvedAt` still unset — EVERY claim re-checks it (A2, not just the
 *    reporting sweep's): a settle landing between scan and claim doesn't
 *    change `appliedAt`/`pausedAt`, so the identity CAS alone wouldn't catch
 *    it, and the claim must miss rather than mark a clock that already
 *    resolved itself.
 */
async function claimTicketSlaMarker(
  ticketId: TicketId,
  appliedAt: string,
  markerField: keyof TicketSlaApplied,
  dueAt: string,
  at: Date,
  executor: StampExecutor = db
): Promise<boolean> {
  return commitTicketStamp(
    ticketId,
    { [markerField]: at.toISOString() },
    at,
    { appliedAt, pausedAt: null },
    {
      unsetFields: [markerField, 'resolvedAt'],
      pinnedFields: { timeToResolveDueAt: dueAt },
    },
    executor
  )
}

/**
 * The scan skeleton shared by the three ticket sweep passes below: fetch
 * every non-deleted ticket with an active (non-paused) SLA whose stamp
 * satisfies `buildWindowSql` (batched at TICKET_SWEEP_BATCH_LIMIT), re-check
 * `isEligible` in JS (SQL only narrows the scan; the recording/claiming rule
 * always lives in JS, per every sweep in this domain) and hand the candidate
 * to `visit`. The skeleton itself never writes: claiming is each pass's own
 * choice (the reporting sweep claims + inserts atomically inside its visit;
 * the trigger sweeps leave the dispatchable candidates' claims to their
 * caller — see this module's doc for the claim-after-enqueue ordering).
 *
 * The WHERE repeats the `tickets_sla_unsettled_idx` partial-index predicate
 * VERBATIM as its own top-level AND clause (migration 0212; the same
 * convention the conversation sweep keeps for conversations_sla_unsettled_idx
 * — see sla.sweep.ts's scanSlaClockCandidates), so the planner can prove the
 * index applies via a literal clause match instead of having to reason
 * through the OR structure of `buildWindowSql`. Soft-deleted tickets are
 * excluded outright (no analogue on the conversation side, which has no
 * deletedAt): a deleted ticket's clock must neither report a breach nor fire
 * a workflow. Status-category-blind beyond that, mirroring the conversation
 * sweeps' documented status-blindness: a pending ticket under a no-pause
 * policy legitimately keeps running and can breach, and whether a breach on
 * an unusual status is actionable is left to the workflow's own conditions.
 */
async function scanTicketSlaCandidates(
  at: Date,
  buildWindowSql: (nowIso: string) => ReturnType<typeof sql>,
  isEligible: (applied: TicketSlaApplied, dueAt: string) => boolean,
  visit: (row: TicketSlaSweepRow, applied: TicketSlaApplied, dueAt: string) => Promise<void>
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
    await visit(row, applied, dueAt)
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
 * Exactly-once + atomic per the claim's doc: each breach is CLAIMED and its
 * event INSERTED in one transaction — the claim's CAS loses to any lazy
 * settle / pause / re-apply racing it, and the transaction means the marker
 * and its event land together or not at all (a failure between them would
 * otherwise leave a claimed marker with no event: the breach silently lost
 * from the log while the stamp suppresses every later attempt). A
 * currently-paused stamp never breaches. Returns the number recorded.
 */
export async function sweepOverdueTicketSlaBreaches(
  at: Date = new Date()
): Promise<{ recorded: number }> {
  let recorded = 0
  await scanTicketSlaCandidates(
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
    async (row, applied, dueAt) => {
      await db.transaction(async (tx) => {
        const landed = await claimTicketSlaMarker(
          row.id,
          applied.appliedAt,
          'resolutionBreachedAt',
          dueAt,
          at,
          tx
        )
        if (!landed) return // settled, paused, re-applied, or claimed meanwhile
        await insertTicketClockEvent(
          row.id,
          applied.policyId,
          'time_to_resolve_breached',
          dueAt,
          at,
          tx
        )
        recorded++
      })
    }
  )
  return { recorded }
}

/** One scanned ticket-clock trigger candidate, ready for workflow-sweep.ts to
 *  dispatch as a synthetic sla.approaching_breach / sla.breached event. The
 *  conversation side of the payload (conversationId + conversation ref) is
 *  the ticket's linked CUSTOMER conversation, resolved at scan time — ALL
 *  workflow runs are conversation-context, so a ticket clock's trigger must
 *  ride the conversation the ticket is anchored to. The candidate is scanned
 *  WITHOUT its fire-once marker claimed (claim-after-enqueue — see
 *  claimTicketSlaTimerTriggerMarker), so it carries everything the
 *  post-enqueue claim's CAS re-verifies: `appliedAt` pins the stamp identity
 *  and `dueAt` pins the deadline it computed from. */
export interface TicketSlaTimerTriggerCandidate {
  conversationId: ConversationId
  conversation: EventConversationRef
  ticketId: TicketId
  ticket: EventTicketRef
  policyId: SlaPolicyId
  clock: 'time_to_resolve'
  dueAt: string
  appliedAt: string
}

/**
 * Resolve the dispatch target for a scanned ticket-clock candidate: the
 * ticket's linked CUSTOMER conversation (ticket_conversations where
 * ticketType = 'customer' — the same join event-trigger.ts's
 * resolveTicketConversationId uses for the ticket.created /
 * ticket.status_changed triggers), plus the conversation row's
 * EventConversationRef fields. Returns null when the ticket has no customer
 * conversation — a BACK-OFFICE ticket. The caller then claims the fire-once
 * marker INLINE (a later tick must not keep re-scanning and re-resolving a
 * candidate that can never dispatch) but never returns it for dispatch:
 * there is no conversation context to run a workflow against. This is a
 * documented v1 limitation — back-office TTR breaches still record their
 * sla_events rows via sweepOverdueTicketSlaBreaches above (the reporting axis
 * needs no conversation); only the workflow-trigger axis is
 * conversation-bound. Per-candidate lookups (not a scan join) keep the scan
 * query's verbatim partial-index predicate provable.
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
  if (!conv) return null // link outlived its conversation (cascade races the scan)
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
 * Claim the fire-once marker for a scanned timer-trigger candidate — called
 * by workflow-sweep.ts ONLY after the candidate's dispatch enqueue succeeded
 * (claim-after-enqueue, mirroring the conversation side's
 * claimSlaTimerTriggerMarker — see its doc for why the order is
 * enqueue-then-claim). The claim's CAS re-checks `resolvedAt` (see
 * claimTicketSlaMarker): a settle landing between scan and claim keeps the
 * marker unstamped — the stamp then truthfully records that this trigger
 * never fired for the settled clock.
 */
export async function claimTicketSlaTimerTriggerMarker(
  candidate: Pick<TicketSlaTimerTriggerCandidate, 'ticketId' | 'dueAt' | 'appliedAt'>,
  marker: 'warning' | 'breach',
  at: Date
): Promise<boolean> {
  return claimTicketSlaMarker(
    candidate.ticketId,
    candidate.appliedAt,
    marker === 'warning' ? 'resolutionWarningFiredAt' : 'resolutionBreachTriggerFiredAt',
    candidate.dueAt,
    at
  )
}

/**
 * Scan for tickets whose unsettled TTR clock enters the approaching-breach
 * lead window (`due - leadMinutes <= now < due`) and return each as an
 * unclaimed candidate (claim-after-enqueue — see
 * claimTicketSlaTimerTriggerMarker; the `resolutionWarningFiredAt` marker is
 * claimed by the caller post-enqueue). Pause-aware the same way
 * sweepOverdueTicketSlaBreaches is. Already-due clocks are excluded — those
 * are sla.breached's job, not a warning. Returns the dispatchable candidates
 * for the caller (workflow-sweep.ts); back-office tickets are claimed inline
 * but never returned (see resolveTicketTriggerTarget's doc).
 */
export async function sweepApproachingTicketSlaBreaches(
  leadMinutes: number,
  at: Date = new Date()
): Promise<TicketSlaTimerTriggerCandidate[]> {
  const horizon = new Date(at.getTime() + leadMinutes * 60_000).toISOString()
  const candidates: TicketSlaTimerTriggerCandidate[] = []
  await scanTicketSlaCandidates(
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
    async (row, applied, dueAt) => {
      const target = await resolveTicketTriggerTarget(row.id)
      if (!target) {
        // Back-office ticket: no dispatch exists to protect from loss, so the
        // fire-once marker is claimed inline (stops the re-scan) — the
        // documented v1 limitation, unchanged by claim-after-enqueue.
        await claimTicketSlaMarker(row.id, applied.appliedAt, 'resolutionWarningFiredAt', dueAt, at)
        return
      }
      candidates.push({
        ...target,
        ticketId: row.id,
        ticket: ticketRefFromRow(row),
        policyId: applied.policyId,
        clock: 'time_to_resolve',
        dueAt,
        appliedAt: applied.appliedAt,
      })
    }
  )
  return candidates
}

/**
 * Scan for tickets whose unsettled TTR clock has passed its due date and
 * return each as an unclaimed candidate (claim-after-enqueue — see
 * claimTicketSlaTimerTriggerMarker; the `resolutionBreachTriggerFiredAt`
 * marker is claimed by the caller post-enqueue). The breach-trigger marker is
 * independent of (and in addition to) sweepOverdueTicketSlaBreaches's own
 * `resolutionBreachedAt` claim above: different marker field, so whichever of
 * the per-minute reporting sweep or this 5-minute trigger sweep runs first
 * never blocks the other. No lead time: this fires the instant `now >= due`,
 * same as the reporting sweep's own breach detection. Returns the
 * dispatchable candidates for the caller (workflow-sweep.ts); back-office
 * tickets are claimed inline but never returned (see
 * resolveTicketTriggerTarget's doc).
 */
export async function sweepTicketSlaBreachTriggers(
  at: Date = new Date()
): Promise<TicketSlaTimerTriggerCandidate[]> {
  const candidates: TicketSlaTimerTriggerCandidate[] = []
  await scanTicketSlaCandidates(
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
    async (row, applied, dueAt) => {
      const target = await resolveTicketTriggerTarget(row.id)
      if (!target) {
        // Back-office ticket: claimed inline, never dispatched — see
        // sweepApproachingTicketSlaBreaches above.
        await claimTicketSlaMarker(
          row.id,
          applied.appliedAt,
          'resolutionBreachTriggerFiredAt',
          dueAt,
          at
        )
        return
      }
      candidates.push({
        ...target,
        ticketId: row.id,
        ticket: ticketRefFromRow(row),
        policyId: applied.policyId,
        clock: 'time_to_resolve',
        dueAt,
        appliedAt: applied.appliedAt,
      })
    }
  )
  return candidates
}
