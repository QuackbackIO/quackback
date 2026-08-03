/**
 * SLA escalation tick — idempotent worker invoked by an external scheduler.
 *
 * Two passes per call:
 *   1. Mark any running clock whose `dueAt <= now` as 'breached'; emit
 *      `sla.breached` activity + `ticket_sla_breach` notification (best-effort).
 *   2. For each enabled escalation rule: find still-running clocks whose
 *      `(dueAt - leadMinutes * 60s) <= now` AND
 *      `(lastEscalatedAt IS NULL OR lastEscalatedAt < (dueAt - leadMinutes * 60s))`
 *      AND `kind = rule.targetKind`. Resolve recipients, dispatch in_app
 *      notifications, insert `sla_escalation_log`, set `lastEscalatedAt = now`.
 *
 * Concurrency: each clock UPDATE uses a `WHERE state=...` filter so two
 * overlapping ticks won't both flip the same row; only one INSERT ever happens
 * per (clock, tick window).
 */

import {
  db,
  eq,
  and,
  lte,
  isNull,
  or,
  sql,
  ticketSlaClocks,
  escalationRules,
  slaEscalationLog,
  tickets,
  inboxMemberships,
  type TicketSlaClock,
  type EscalationRule,
} from '@/lib/server/db'
import type { TicketId, PrincipalId, InboxId } from '@quackback/ids'
import { writeActivity } from '../tickets/ticket.service'

export interface RunEscalationTickOptions {
  now?: Date
  batchSize?: number
}

export interface RunEscalationTickResult {
  breached: number
  escalated: number
  considered: number
}

export async function runEscalationTick(
  opts: RunEscalationTickOptions = {}
): Promise<RunEscalationTickResult> {
  const now = opts.now ?? new Date()
  const limit = opts.batchSize ?? 200
  const result: RunEscalationTickResult = { breached: 0, escalated: 0, considered: 0 }

  // ---- 1. Mark breaches ----
  const dueClocks = await db
    .select()
    .from(ticketSlaClocks)
    .where(and(eq(ticketSlaClocks.state, 'running'), lte(ticketSlaClocks.dueAt, now)))
    .limit(limit)

  for (const c of dueClocks) {
    const updated = await db
      .update(ticketSlaClocks)
      .set({ state: 'breached', breachedAt: now })
      .where(and(eq(ticketSlaClocks.id, c.id), eq(ticketSlaClocks.state, 'running')))
      .returning()
    if (updated.length === 0) continue
    result.breached++
    await writeActivity(c.ticketId as TicketId, null, 'sla.breached', {
      clockId: c.id,
      kind: c.kind,
      dueAt: c.dueAt instanceof Date ? c.dueAt.toISOString() : String(c.dueAt),
    })
    // Best-effort breach notification to assignee (if any).
    await dispatchBreachNotification(c.ticketId as TicketId, c.kind)
  }

  // ---- 2. Run escalation rules ----
  const rules = await db.select().from(escalationRules).where(eq(escalationRules.enabled, true))

  for (const rule of rules) {
    // due_at - lead_minutes * interval '1 min' <= now
    const candidates = await db
      .select()
      .from(ticketSlaClocks)
      .where(
        and(
          eq(ticketSlaClocks.state, 'running'),
          eq(ticketSlaClocks.kind, rule.targetKind),
          eq(ticketSlaClocks.policyId, rule.policyId),
          sql`(${ticketSlaClocks.dueAt} - (${rule.leadMinutes}::int * interval '1 minute')) <= ${now}`,
          or(
            isNull(ticketSlaClocks.lastEscalatedAt),
            sql`${ticketSlaClocks.lastEscalatedAt} < (${ticketSlaClocks.dueAt} - (${rule.leadMinutes}::int * interval '1 minute'))`
          )
        )
      )
      .limit(limit)

    for (const c of candidates) {
      result.considered++
      const updated = await db
        .update(ticketSlaClocks)
        .set({ lastEscalatedAt: now })
        .where(
          and(
            eq(ticketSlaClocks.id, c.id),
            // re-check anti-spam anchor under WHERE to avoid double-fire across ticks
            or(
              isNull(ticketSlaClocks.lastEscalatedAt),
              sql`${ticketSlaClocks.lastEscalatedAt} < (${ticketSlaClocks.dueAt} - (${rule.leadMinutes}::int * interval '1 minute'))`
            )
          )
        )
        .returning()
      if (updated.length === 0) continue

      const recipients = await resolveRecipients(rule, c)
      const channels = (rule.channels ?? []) as readonly string[]

      // Dispatch in_app notifications (best-effort).
      if (channels.includes('in_app') && recipients.length > 0) {
        await dispatchEscalationNotifications(c.ticketId as TicketId, c.kind, rule.name, recipients)
      }
      // Note: 'email' / 'webhook' channels logged but not yet wired (v1).
      if (channels.some((ch) => ch !== 'in_app')) {
        console.log(
          `[sla.escalations] non-in_app channels deferred for rule ${rule.id} (clock ${c.id})`
        )
      }

      await db.insert(slaEscalationLog).values({
        clockId: c.id,
        ruleId: rule.id,
        firedAt: now,
        recipientPrincipalIds: recipients,
        channels: rule.channels,
        context: {
          kind: c.kind,
          ticketId: c.ticketId,
          leadMinutes: rule.leadMinutes,
        },
      })
      await writeActivity(c.ticketId as TicketId, null, 'sla.escalated', {
        clockId: c.id,
        kind: c.kind,
        ruleId: rule.id,
        ruleName: rule.name,
        recipientCount: recipients.length,
      })
      result.escalated++
    }
  }

  return result
}

// ---------------------------------------------------------------------------
// recipients
// ---------------------------------------------------------------------------

async function resolveRecipients(rule: EscalationRule, clock: TicketSlaClock): Promise<string[]> {
  switch (rule.recipientType) {
    case 'principals':
      return [...(rule.recipientPrincipalIds ?? [])]
    case 'team': {
      // Team membership lookup — for v1 we trust caller-provided team in rule
      // and emit notifications targeted at the team via the recipient list.
      // We include only directly-listed principals; team-fanout is best done
      // by the notification dispatcher in a future phase.
      return [...(rule.recipientPrincipalIds ?? [])]
    }
    case 'assignee': {
      const ticket = await db.query.tickets.findFirst({
        where: eq(tickets.id, clock.ticketId as TicketId),
      })
      const id = ticket?.assigneePrincipalId
      return id ? [id as string] : []
    }
    case 'inbox_members': {
      const ticket = await db.query.tickets.findFirst({
        where: eq(tickets.id, clock.ticketId as TicketId),
      })
      if (!ticket?.inboxId) return []
      const rows = await db
        .select({ principalId: inboxMemberships.principalId })
        .from(inboxMemberships)
        .where(eq(inboxMemberships.inboxId, ticket.inboxId as InboxId))
      return rows.map((r) => r.principalId as string)
    }
    default:
      return []
  }
}

// ---------------------------------------------------------------------------
// notifications
// ---------------------------------------------------------------------------

async function dispatchBreachNotification(ticketId: TicketId, kind: string): Promise<void> {
  try {
    const ticket = await db.query.tickets.findFirst({ where: eq(tickets.id, ticketId) })
    if (!ticket) return
    const { notifyTicketSlaBreach } = await import('../tickets/ticket.notifications')
    await notifyTicketSlaBreach(ticket, kind)
    // Phase 7.5: outbound webhook event.
    try {
      const { dispatchTicketSlaBreach } = await import('@/lib/server/events/dispatch')
      await dispatchTicketSlaBreach(
        { type: 'service', displayName: 'sla-engine' },
        ticket as unknown as Record<string, unknown>,
        kind
      )
    } catch (err) {
      console.warn('[sla.escalations] dispatchTicketSlaBreach failed', err)
    }
  } catch (err) {
    console.warn('[sla.escalations] dispatchBreachNotification failed', err)
  }
}

async function dispatchEscalationNotifications(
  ticketId: TicketId,
  kind: string,
  ruleName: string,
  recipients: string[]
): Promise<void> {
  if (recipients.length === 0) return
  try {
    const ticket = await db.query.tickets.findFirst({ where: eq(tickets.id, ticketId) })
    if (!ticket) return
    const { notifyTicketSlaWarning } = await import('../tickets/ticket.notifications')
    await notifyTicketSlaWarning(ticket, kind, ruleName, recipients as PrincipalId[])
    // Phase 7.5: outbound webhook event.
    try {
      const { dispatchTicketSlaWarning } = await import('@/lib/server/events/dispatch')
      await dispatchTicketSlaWarning(
        { type: 'service', displayName: 'sla-engine' },
        ticket as unknown as Record<string, unknown>,
        kind,
        ruleName
      )
    } catch (err) {
      console.warn('[sla.escalations] dispatchTicketSlaWarning failed', err)
    }
  } catch (err) {
    console.warn('[sla.escalations] dispatchEscalationNotifications failed', err)
  }
}
