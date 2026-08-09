/**
 * Usage metering for the outcome-based charge.
 *
 * ## What a billable outcome is
 *
 * A resolved AI outcome is one `assistant_involvements` row that reached a
 * terminal resolved status — `resolved_confirmed` (the customer explicitly
 * affirmed the answer) or `resolved_assumed` (they went quiet past the
 * inactivity window after a real answer). That is the product's own KPI unit,
 * defined in `assistant.involvement.ts`, one row per conversation the
 * assistant engaged, with an at-most-one-resolution guard already enforced by
 * a conditional UPDATE. Nothing new is being invented to bill from.
 *
 * A hand-off (`handed_off`) is explicitly not billable: the assistant did not
 * resolve anything, a human did.
 *
 * ## Derived, not counted
 *
 * The ledger is built by *querying the product* for resolved involvements
 * that have no ledger row yet, rather than by incrementing a counter when a
 * resolution happens. Two reasons, and both matter:
 *
 *  - **A resolution can be undone.** `voidAssumedResolutionForConversation()`
 *    moves an assumed resolution back to `active` when the customer returns
 *    needing help. A counter incremented at resolution time would already
 *    have charged for it. Deriving from current state means a resolution that
 *    is voided before the sweep sees it is never billed at all.
 *  - **It is rebuildable.** If the ledger is ever lost or the sweep is off for
 *    a day, re-running it produces the same rows. A counter cannot be
 *    reconstructed.
 *
 * `(meter, source_id)` is unique **forever**, not per period. One resolved
 * conversation is one billable outcome; if it is voided and later resolves
 * again, that is the same conversation being finished, not a second sale.
 */

import {
  and,
  assistantInvolvements,
  billingUsageEvents,
  db,
  eq,
  gte,
  inArray,
  isNull,
  sql,
} from '@/lib/server/db'
import { logger } from '@/lib/server/logger'
import { AI_INBOX_BUCKETS } from '../assistant/assistant.involvement'
import type { BillingConfig } from './billing.config'
import type { BillingProviderClient } from './provider/client'

const log = logger.child({ component: 'billing-usage' })

/** The only usage meter today. A ledger key, stable across releases. */
export const OUTCOME_METER = 'resolved_outcome'

/**
 * Statuses that count as a billable resolution.
 *
 * Read from `AI_INBOX_BUCKETS.resolved` rather than restated, so the billing
 * definition of "resolved" and the inbox's definition can never drift apart —
 * if the product ever changes what it calls resolved, the invoice follows.
 */
export const BILLABLE_INVOLVEMENT_STATUSES = AI_INBOX_BUCKETS.resolved

export interface DeriveResult {
  /** Ledger rows created by this pass. */
  created: number
  /** Resolved involvements considered. */
  candidates: number
}

/**
 * Insert ledger rows for resolved outcomes that have none.
 *
 * Two steps rather than one `INSERT … SELECT`, because ids are TypeIDs
 * generated in the application layer and stored as UUIDs — SQL cannot mint
 * one. That is safe: `ON CONFLICT DO NOTHING` against the unique
 * `(meter, source_id)` index absorbs both a concurrent sweep and a re-run, so
 * the widened window between reading candidates and inserting them costs a
 * discarded insert, never a duplicate charge.
 *
 * `until` lets a caller derive a closed period without a moving boundary.
 */
export async function deriveOutcomeUsage(until: Date = new Date()): Promise<DeriveResult> {
  const candidates = await db
    .select({
      id: assistantInvolvements.id,
      // A resolution's timestamp is when it ended. `createdAt` is the fallback
      // for a row whose terminal write predates `endedAt` being set — the
      // ledger needs a non-null occurrence time for the meter event.
      occurredAt: sql<Date>`COALESCE(${assistantInvolvements.endedAt}, ${assistantInvolvements.createdAt})`,
    })
    .from(assistantInvolvements)
    .where(
      and(
        inArray(assistantInvolvements.status, [...BILLABLE_INVOLVEMENT_STATUSES]),
        // The bound is interpolated as an explicit ISO timestamptz rather than
        // bound through `lte(sql\`…\`, date)`: a raw SQL expression carries no
        // column type for Drizzle to infer from, so the driver receives a bare
        // Date it cannot encode.
        sql`COALESCE(${assistantInvolvements.endedAt}, ${assistantInvolvements.createdAt}) <= ${until.toISOString()}::timestamptz`
      )
    )

  if (candidates.length === 0) return { created: 0, candidates: 0 }

  const inserted = await db
    .insert(billingUsageEvents)
    .values(
      candidates.map((row) => ({
        meter: OUTCOME_METER,
        sourceId: row.id,
        quantity: 1,
        occurredAt: new Date(row.occurredAt),
      }))
    )
    .onConflictDoNothing({
      target: [billingUsageEvents.meter, billingUsageEvents.sourceId],
    })
    .returning({ id: billingUsageEvents.id })

  if (inserted.length > 0) {
    log.info({ created: inserted.length, meter: OUTCOME_METER }, 'derived billable outcomes')
  }
  return { created: inserted.length, candidates: candidates.length }
}

export interface PushResult {
  reported: number
  failed: number
}

/**
 * Push unreported ledger rows to the provider.
 *
 * Each row is reported with its own id as the provider-side deduplication
 * identifier, so the provider counts it once even if this process crashes
 * between a successful call and the local `reported_at` write. That is the
 * important property: the local flag is an optimisation, and correctness does
 * not depend on it.
 */
export async function pushOutcomeUsage(
  client: BillingProviderClient,
  customerRef: string,
  config: BillingConfig,
  plan: keyof BillingConfig['catalogue'],
  limit = 200
): Promise<PushResult> {
  const meterName = config.catalogue[plan]?.outcomeMeter
  if (!meterName) {
    // The plan does not charge per outcome. Rows still accumulate — the
    // ledger is the record of what happened, not of what was sold — but there
    // is nothing to report.
    return { reported: 0, failed: 0 }
  }

  const pending = await db
    .select({
      id: billingUsageEvents.id,
      quantity: billingUsageEvents.quantity,
      occurredAt: billingUsageEvents.occurredAt,
    })
    .from(billingUsageEvents)
    .where(and(eq(billingUsageEvents.meter, OUTCOME_METER), isNull(billingUsageEvents.reportedAt)))
    .orderBy(billingUsageEvents.occurredAt)
    .limit(limit)

  let reported = 0
  let failed = 0
  for (const row of pending) {
    try {
      await client.reportMeterEvent({
        meter: meterName,
        customer: customerRef,
        value: row.quantity,
        identifier: row.id,
        timestamp: Math.floor(row.occurredAt.getTime() / 1000),
      })
      await db
        .update(billingUsageEvents)
        .set({ reportedAt: new Date() })
        .where(eq(billingUsageEvents.id, row.id))
      reported++
    } catch (error) {
      failed++
      log.warn({ err: error, usageId: row.id }, 'usage push failed; will retry')
      // Stop on the first failure rather than hammering a provider that is
      // rate-limiting or down. The next tick resumes from the same row.
      break
    }
  }
  if (reported > 0) log.info({ reported, failed }, 'usage reported')
  return { reported, failed }
}

/** Ledger totals for the admin surface. */
export async function usageSummary(since: Date): Promise<{
  total: number
  reported: number
  pending: number
}> {
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      reported: sql<number>`count(*) FILTER (WHERE ${billingUsageEvents.reportedAt} IS NOT NULL)::int`,
    })
    .from(billingUsageEvents)
    .where(
      and(
        eq(billingUsageEvents.meter, OUTCOME_METER),
        gte(billingUsageEvents.occurredAt, since)
      )
    )
  const total = row?.total ?? 0
  const reported = row?.reported ?? 0
  return { total, reported, pending: total - reported }
}
