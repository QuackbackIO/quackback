/**
 * SLA engine — selects policies for tickets, attaches/manages clocks.
 *
 * Public API used by ticket.service / ticket.threads:
 *   - selectPolicyForTicket
 *   - attachClocksOnCreate
 *   - onPublicAgentReply
 *   - onCustomerReply
 *   - onStatusTransition
 *
 * All side effects also write a `ticket_activity` row for the timeline.
 */

import {
  db,
  eq,
  and,
  or,
  isNull,
  asc,
  inArray,
  sql,
  slaPolicies,
  slaTargets,
  ticketSlaClocks,
  businessHours,
  tickets,
  type SlaPolicy,
  type SlaTarget,
  type TicketSlaClock,
  type Ticket,
} from '@/lib/server/db'
import type { TicketId, SlaPolicyId, PrincipalId, InboxId, TeamId } from '@quackback/ids'
import type { SlaTargetKind, TicketStatusCategory, TicketPriority } from '@/lib/server/db'
import {
  addBusinessMinutes,
  elapsedBusinessMs,
  type BusinessHoursLike,
} from './business-hours.calc'
import { writeActivity } from '../tickets/ticket.service'

// ---------------------------------------------------------------------------
// policy selection
// ---------------------------------------------------------------------------

interface PolicyMatchInput {
  inboxId: InboxId | null
  primaryTeamId: TeamId | null
  priority: TicketPriority
}

export async function selectPolicyForTicket(input: PolicyMatchInput): Promise<SlaPolicy | null> {
  // We pull all enabled, non-archived candidates that could match (inbox/team/workspace),
  // then narrow by appliesToPriorities + scope precedence in JS — table is small.
  const candidates = await db
    .select()
    .from(slaPolicies)
    .where(
      and(
        eq(slaPolicies.enabled, true),
        isNull(slaPolicies.archivedAt),
        or(
          eq(slaPolicies.scope, 'workspace'),
          input.primaryTeamId != null
            ? and(eq(slaPolicies.scope, 'team'), eq(slaPolicies.scopeTeamId, input.primaryTeamId))
            : sql`false`,
          input.inboxId != null
            ? and(eq(slaPolicies.scope, 'inbox'), eq(slaPolicies.scopeInboxId, input.inboxId))
            : sql`false`
        )
      )
    )
    .orderBy(asc(slaPolicies.priority), asc(slaPolicies.createdAt))

  const matchesPriority = (p: SlaPolicy): boolean => {
    if (!p.appliesToPriorities || p.appliesToPriorities.length === 0) return true
    return (p.appliesToPriorities as readonly string[]).includes(input.priority)
  }

  // Precedence: inbox > team > workspace, then ordering by (priority, createdAt) within each group.
  const groups: Record<'inbox' | 'team' | 'workspace', SlaPolicy[]> = {
    inbox: [],
    team: [],
    workspace: [],
  }
  for (const p of candidates) {
    if (!matchesPriority(p)) continue
    groups[p.scope as 'inbox' | 'team' | 'workspace'].push(p)
  }
  return groups.inbox[0] ?? groups.team[0] ?? groups.workspace[0] ?? null
}

// ---------------------------------------------------------------------------
// clock attachment / lifecycle
// ---------------------------------------------------------------------------

async function loadBusinessHours(policy: SlaPolicy): Promise<BusinessHoursLike | null> {
  if (!policy.businessHoursId) return null
  const row = await db.query.businessHours.findFirst({
    where: eq(businessHours.id, policy.businessHoursId),
  })
  if (!row) return null
  return {
    timezone: row.timezone,
    schedule: row.schedule,
    holidays: row.holidays ?? [],
  }
}

async function loadTargets(policyId: SlaPolicyId): Promise<Map<SlaTargetKind, SlaTarget>> {
  const rows = await db.select().from(slaTargets).where(eq(slaTargets.policyId, policyId))
  const map = new Map<SlaTargetKind, SlaTarget>()
  for (const r of rows) map.set(r.kind as SlaTargetKind, r)
  return map
}

async function startClock(opts: {
  ticket: Ticket
  policy: SlaPolicy
  target: SlaTarget
  hours: BusinessHoursLike | null
  startedAt: Date
  actorPrincipalId: PrincipalId | null
}): Promise<TicketSlaClock | null> {
  const { ticket, policy, target, hours, startedAt, actorPrincipalId } = opts
  const dueAt = addBusinessMinutes(startedAt, target.minutes, hours)
  // Concurrency guard: skip if an active clock for (ticket, kind) already exists.
  const existing = await db.query.ticketSlaClocks.findFirst({
    where: and(
      eq(ticketSlaClocks.ticketId, ticket.id),
      eq(ticketSlaClocks.kind, target.kind),
      inArray(ticketSlaClocks.state, ['running', 'paused'])
    ),
  })
  if (existing) return existing
  const [created] = await db
    .insert(ticketSlaClocks)
    .values({
      ticketId: ticket.id,
      policyId: policy.id,
      targetId: target.id,
      kind: target.kind,
      state: 'running',
      targetMinutes: target.minutes,
      startedAt,
      dueAt,
    })
    .returning()
  await writeActivity(ticket.id as TicketId, actorPrincipalId, 'sla.clock_started', {
    clockId: created.id,
    kind: target.kind,
    dueAt: dueAt.toISOString(),
    targetMinutes: target.minutes,
    policyId: policy.id,
  })
  return created
}

/**
 * Bind the matching policy + start first_response and resolution clocks.
 * Best-effort; throws nothing the caller must catch (caller wraps in try/catch).
 */
export async function attachClocksOnCreate(
  ticket: Ticket,
  actorPrincipalId: PrincipalId | null
): Promise<{ policy: SlaPolicy | null; started: TicketSlaClock[] }> {
  const policy = await selectPolicyForTicket({
    inboxId: (ticket.inboxId as InboxId | null) ?? null,
    primaryTeamId: (ticket.primaryTeamId as TeamId | null) ?? null,
    priority: ticket.priority as TicketPriority,
  })
  if (!policy) return { policy: null, started: [] }

  // Persist the binding on the ticket header (best-effort — concurrent updates won't conflict here).
  if (ticket.slaPolicyId !== policy.id) {
    await db
      .update(tickets)
      .set({ slaPolicyId: policy.id as SlaPolicyId })
      .where(eq(tickets.id, ticket.id))
  }
  await writeActivity(ticket.id as TicketId, actorPrincipalId, 'sla.policy_assigned', {
    policyId: policy.id,
    policyName: policy.name,
  })

  const targets = await loadTargets(policy.id as SlaPolicyId)
  const hours = await loadBusinessHours(policy)
  const startedAt = new Date()

  const started: TicketSlaClock[] = []
  for (const kind of ['first_response', 'resolution'] as const) {
    const t = targets.get(kind)
    if (!t) continue
    const clock = await startClock({
      ticket,
      policy,
      target: t,
      hours,
      startedAt,
      actorPrincipalId,
    })
    if (clock) started.push(clock)
  }
  return { policy, started }
}

async function loadPolicyAndHours(
  policyId: SlaPolicyId
): Promise<{ policy: SlaPolicy; hours: BusinessHoursLike | null } | null> {
  const policy = await db.query.slaPolicies.findFirst({ where: eq(slaPolicies.id, policyId) })
  if (!policy) return null
  const hours = await loadBusinessHours(policy)
  return { policy, hours }
}

/**
 * Mark the first-response clock met and start a next_response clock if the
 * policy defines one (it's restarted on each customer reply, see `onCustomerReply`).
 * Idempotent — safe to call repeatedly; only acts when first_response is still running.
 */
export async function onPublicAgentReply(
  ticket: Ticket,
  actorPrincipalId: PrincipalId | null
): Promise<void> {
  const now = new Date()
  // Mark first_response as met if running.
  const fr = await db.query.ticketSlaClocks.findFirst({
    where: and(
      eq(ticketSlaClocks.ticketId, ticket.id),
      eq(ticketSlaClocks.kind, 'first_response'),
      inArray(ticketSlaClocks.state, ['running', 'paused'])
    ),
  })
  if (fr) {
    await db
      .update(ticketSlaClocks)
      .set({ state: 'met', metAt: now })
      .where(eq(ticketSlaClocks.id, fr.id))
    await writeActivity(ticket.id as TicketId, actorPrincipalId, 'sla.met', {
      clockId: fr.id,
      kind: 'first_response',
    })
  }
  // Mark next_response as met if running (agent answered the customer's last question).
  const nr = await db.query.ticketSlaClocks.findFirst({
    where: and(
      eq(ticketSlaClocks.ticketId, ticket.id),
      eq(ticketSlaClocks.kind, 'next_response'),
      inArray(ticketSlaClocks.state, ['running', 'paused'])
    ),
  })
  if (nr) {
    await db
      .update(ticketSlaClocks)
      .set({ state: 'met', metAt: now })
      .where(eq(ticketSlaClocks.id, nr.id))
    await writeActivity(ticket.id as TicketId, actorPrincipalId, 'sla.met', {
      clockId: nr.id,
      kind: 'next_response',
    })
  }
}

/**
 * Customer authored a public reply — start (or restart) a next_response clock.
 */
export async function onCustomerReply(
  ticket: Ticket,
  actorPrincipalId: PrincipalId | null
): Promise<void> {
  if (!ticket.slaPolicyId) return
  const ctx = await loadPolicyAndHours(ticket.slaPolicyId as SlaPolicyId)
  if (!ctx) return
  const targets = await loadTargets(ctx.policy.id as SlaPolicyId)
  const target = targets.get('next_response')
  if (!target) return

  // Cancel any existing running/paused next_response clock first.
  await db
    .update(ticketSlaClocks)
    .set({ state: 'cancelled' })
    .where(
      and(
        eq(ticketSlaClocks.ticketId, ticket.id),
        eq(ticketSlaClocks.kind, 'next_response'),
        inArray(ticketSlaClocks.state, ['running', 'paused'])
      )
    )

  await startClock({
    ticket,
    policy: ctx.policy,
    target,
    hours: ctx.hours,
    startedAt: new Date(),
    actorPrincipalId,
  })
}

/**
 * React to a status category transition. Pauses/resumes/cancels clocks per
 * policy flags; marks resolution clock met on solved.
 */
export async function onStatusTransition(
  ticket: Ticket,
  fromCategory: TicketStatusCategory | null,
  toCategory: TicketStatusCategory,
  actorPrincipalId: PrincipalId | null
): Promise<void> {
  if (!ticket.slaPolicyId) return
  const policy = await db.query.slaPolicies.findFirst({
    where: eq(slaPolicies.id, ticket.slaPolicyId as SlaPolicyId),
  })
  if (!policy) return
  const hours = await loadBusinessHours(policy)
  const now = new Date()

  const isPausing = (cat: TicketStatusCategory): boolean =>
    (cat === 'pending' && policy.pauseOnPending) || (cat === 'on_hold' && policy.pauseOnOnHold)

  const wasPausing = fromCategory ? isPausing(fromCategory) : false
  const nowPausing = isPausing(toCategory)

  if (!wasPausing && nowPausing) {
    // Pause all running clocks.
    const running = await db
      .select()
      .from(ticketSlaClocks)
      .where(and(eq(ticketSlaClocks.ticketId, ticket.id), eq(ticketSlaClocks.state, 'running')))
    for (const c of running) {
      await db
        .update(ticketSlaClocks)
        .set({ state: 'paused', pausedAt: now })
        .where(eq(ticketSlaClocks.id, c.id))
      await writeActivity(ticket.id as TicketId, actorPrincipalId, 'sla.paused', {
        clockId: c.id,
        kind: c.kind,
        reason: toCategory,
      })
    }
  } else if (wasPausing && !nowPausing) {
    // Resume all paused clocks: shift dueAt by the time we were paused.
    const paused = await db
      .select()
      .from(ticketSlaClocks)
      .where(and(eq(ticketSlaClocks.ticketId, ticket.id), eq(ticketSlaClocks.state, 'paused')))
    for (const c of paused) {
      const pausedFor = c.pausedAt ? now.getTime() - new Date(c.pausedAt).getTime() : 0
      // Recompute remaining business minutes and re-derive dueAt from now.
      // Elapsed business-time so far = elapsedBusinessMs(startedAt, pausedAt, hours).
      const elapsedMs = elapsedBusinessMs(
        new Date(c.startedAt),
        c.pausedAt ? new Date(c.pausedAt) : now,
        hours
      )
      const totalMs = c.targetMinutes * 60_000
      const remainingMinutes = Math.max(1, Math.round((totalMs - elapsedMs) / 60_000))
      const newDueAt = addBusinessMinutes(now, remainingMinutes, hours)
      await db
        .update(ticketSlaClocks)
        .set({
          state: 'running',
          pausedAt: null,
          accumulatedPausedMs: (c.accumulatedPausedMs ?? 0) + Math.max(0, pausedFor),
          dueAt: newDueAt,
        })
        .where(eq(ticketSlaClocks.id, c.id))
      await writeActivity(ticket.id as TicketId, actorPrincipalId, 'sla.resumed', {
        clockId: c.id,
        kind: c.kind,
        newDueAt: newDueAt.toISOString(),
        pausedMs: pausedFor,
      })
    }
  }

  if (toCategory === 'solved') {
    // Mark resolution as met if still active.
    const res = await db.query.ticketSlaClocks.findFirst({
      where: and(
        eq(ticketSlaClocks.ticketId, ticket.id),
        eq(ticketSlaClocks.kind, 'resolution'),
        inArray(ticketSlaClocks.state, ['running', 'paused'])
      ),
    })
    if (res) {
      await db
        .update(ticketSlaClocks)
        .set({ state: 'met', metAt: now })
        .where(eq(ticketSlaClocks.id, res.id))
      await writeActivity(ticket.id as TicketId, actorPrincipalId, 'sla.met', {
        clockId: res.id,
        kind: 'resolution',
      })
    }
  } else if (toCategory === 'closed') {
    // Cancel all still-active clocks.
    const active = await db
      .select()
      .from(ticketSlaClocks)
      .where(
        and(
          eq(ticketSlaClocks.ticketId, ticket.id),
          inArray(ticketSlaClocks.state, ['running', 'paused'])
        )
      )
    for (const c of active) {
      await db
        .update(ticketSlaClocks)
        .set({ state: 'cancelled' })
        .where(eq(ticketSlaClocks.id, c.id))
    }
  } else if (fromCategory && (fromCategory === 'solved' || fromCategory === 'closed')) {
    // Reopen — toCategory is already narrowed to a non-terminal state here.
    // Start a fresh resolution clock if policy has the target.
    const targets = await loadTargets(policy.id as SlaPolicyId)
    const t = targets.get('resolution')
    if (t) {
      await startClock({
        ticket,
        policy,
        target: t,
        hours,
        startedAt: now,
        actorPrincipalId,
      })
    }
  }
}
