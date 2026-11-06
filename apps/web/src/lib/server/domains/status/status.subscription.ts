/**
 * Status page subscriber pipeline (Status Product Spec §5, §7 decision 1).
 * Subscribers are always principals — no raw-email store, mirroring
 * `changelog-subscription.service.ts`. Unique per principal (upsert on
 * conflict), page-wide or component-scoped.
 */
import {
  db,
  eq,
  and,
  gte,
  isNull,
  desc,
  lt,
  or,
  ilike,
  sql,
  statusSubscriptions,
  principal,
  user,
} from '@/lib/server/db'
import type { PrincipalId, StatusComponentId, StatusSubscriptionId } from '@quackback/ids'
import { NotFoundError } from '@/lib/shared/errors'
import { logger } from '@/lib/server/logger'
import { getTierLimits } from '@/lib/server/domains/settings/tier-limits.service'
import { TierLimitError } from '@/lib/server/errors/tier-limit-error'
import type {
  StatusSubscriptionScope,
  StatusSubscriptionSource,
  StatusSubscriptionStatus,
  StatusSubscriptionAdminRow,
  StatusSubscriptionListResult,
  StatusSubscriptionCounts,
  StatusSubscriptionCsvImportResult,
  StatusSubscriptionExportRow,
} from './status.types'

const log = logger.child({ component: 'status-subscriptions' })

/** Subscribe (or re-subscribe) a principal. Idempotent: clears a prior
 *  unsubscribe but always applies the new scope/componentIds/source. Only for
 *  the person's own action (self-serve); admin paths use
 *  `subscribeUnlessOptedOut`, which never overrides an opt-out. */
/** A transaction handle, or the shared client, for the subscriber writes below. */
type StatusDb = Pick<typeof db, 'select' | 'execute' | 'insert'>

/**
 * The page-wide active-subscriber budget for one transaction. The transaction
 * holds the slot lock, so the count read here is the count every admission in
 * the transaction sees. Only new active subscriptions take a slot.
 */
interface SubscriberSlots {
  limit: number | null
  active: number
}

/** The plan's subscriber cap, read before a transaction opens: the read uses
 *  its own connection, which a transaction holding the only one would wait on. */
async function subscriberLimit(): Promise<number | null> {
  return (await getTierLimits()).maxStatusSubscribers
}

async function lockSubscriberSlots(exec: StatusDb, limit: number | null): Promise<SubscriberSlots> {
  // No cap means nothing to count, so unlimited plans never serialize on the lock.
  if (limit === null) return { limit, active: 0 }
  await exec.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext('quackback:status_subscriber_slot'))`
  )
  const [row] = await exec
    .select({ count: sql<number>`count(*)::int` })
    .from(statusSubscriptions)
    .where(isNull(statusSubscriptions.unsubscribedAt))
  return { limit, active: row?.count ?? 0 }
}

/** Takes one slot for a new active subscription, or refuses once the plan's cap is full. */
function admitNewSubscriber(slots: SubscriberSlots): void {
  if (slots.limit === null) return
  if (slots.active >= slots.limit) {
    throw new TierLimitError({
      limit: 'maxStatusSubscribers',
      current: slots.active,
      max: slots.limit,
      message: `You've reached your plan's status subscribers limit (${slots.limit}). Upgrade to add more.`,
    })
  }
  slots.active += 1
}

/** Whether the person has a row at all, and whether that row is active. */
async function subscriptionState(
  exec: StatusDb,
  principalId: PrincipalId
): Promise<{ exists: boolean; active: boolean }> {
  const [row] = await exec
    .select({ unsubscribedAt: statusSubscriptions.unsubscribedAt })
    .from(statusSubscriptions)
    .where(eq(statusSubscriptions.principalId, principalId))
    .limit(1)
  return { exists: row !== undefined, active: row !== undefined && row.unsubscribedAt === null }
}

export async function subscribe(
  principalId: PrincipalId,
  scope: StatusSubscriptionScope,
  componentIds: StatusComponentId[],
  source: StatusSubscriptionSource
): Promise<void> {
  log.debug({ principal_id: principalId, scope, source }, 'status subscribe')
  const limit = await subscriberLimit()
  await db.transaction(async (tx) => {
    const slots = await lockSubscriberSlots(tx, limit)
    const state = await subscriptionState(tx, principalId)
    if (!state.active) admitNewSubscriber(slots)
    await tx
      .insert(statusSubscriptions)
      .values({ principalId, scope, componentIds, source, unsubscribedAt: null })
      .onConflictDoUpdate({
        target: statusSubscriptions.principalId,
        set: { scope, componentIds, unsubscribedAt: null },
      })
  })
}

/** Admin-side subscribe (manual add, CSV import), page-wide. Someone who
 *  unsubscribed stays unsubscribed: the conflict update only applies to an
 *  active row, so an opted-out row returns nothing. Returns whether the
 *  person is now subscribed. A brand-new row takes a slot; an existing
 *  active or opted-out row does not. */
async function subscribeUnlessOptedOut(
  exec: StatusDb,
  principalId: PrincipalId,
  source: StatusSubscriptionSource,
  slots: SubscriberSlots
): Promise<boolean> {
  const state = await subscriptionState(exec, principalId)
  if (!state.exists) admitNewSubscriber(slots)
  const rows = await exec
    .insert(statusSubscriptions)
    .values({ principalId, scope: 'page', componentIds: [], source, unsubscribedAt: null })
    .onConflictDoUpdate({
      target: statusSubscriptions.principalId,
      set: { scope: 'page', componentIds: [] },
      setWhere: isNull(statusSubscriptions.unsubscribedAt),
    })
    .returning({ id: statusSubscriptions.id })
  return rows.length > 0
}

/** Soft opt-out — keeps the row (and its `source` provenance) for audit. */
export async function unsubscribe(principalId: PrincipalId): Promise<void> {
  log.debug({ principal_id: principalId }, 'status unsubscribe')
  await db
    .update(statusSubscriptions)
    .set({ unsubscribedAt: new Date() })
    .where(eq(statusSubscriptions.principalId, principalId))
}

/** Clears a prior unsubscribe and updates scope/componentIds; a no-op create
 *  when no row exists yet (falls through to the same upsert as `subscribe`). */
export async function resubscribe(
  principalId: PrincipalId,
  scope: StatusSubscriptionScope,
  componentIds: StatusComponentId[],
  source: StatusSubscriptionSource = 'self_serve'
): Promise<void> {
  await subscribe(principalId, scope, componentIds, source)
}

export async function getMySubscription(
  principalId: PrincipalId
): Promise<StatusSubscriptionStatus> {
  const row = await db.query.statusSubscriptions.findFirst({
    where: eq(statusSubscriptions.principalId, principalId),
  })
  if (!row) {
    return {
      principalId,
      subscribed: false,
      scope: 'page',
      componentIds: [],
      source: null,
      unsubscribedAt: null,
    }
  }
  return {
    principalId,
    subscribed: row.unsubscribedAt === null,
    scope: row.scope,
    componentIds: row.componentIds as StatusComponentId[],
    source: row.source,
    unsubscribedAt: row.unsubscribedAt,
  }
}

export async function listStatusSubscriptions(params: {
  cursor?: string
  limit?: number
  search?: string
}): Promise<StatusSubscriptionListResult> {
  const { cursor, limit = 20, search } = params
  const conditions = []

  if (cursor) {
    const cursorRow = await db.query.statusSubscriptions.findFirst({
      where: eq(statusSubscriptions.id, cursor as StatusSubscriptionId),
      columns: { createdAt: true },
    })
    if (cursorRow) {
      conditions.push(lt(statusSubscriptions.createdAt, cursorRow.createdAt))
    }
  }

  const term = search?.trim()
  if (term) {
    const pattern = `%${term}%`
    conditions.push(or(ilike(user.email, pattern), ilike(principal.displayName, pattern)))
  }

  const rows = await db
    .select({
      id: statusSubscriptions.id,
      principalId: statusSubscriptions.principalId,
      scope: statusSubscriptions.scope,
      componentIds: statusSubscriptions.componentIds,
      source: statusSubscriptions.source,
      unsubscribedAt: statusSubscriptions.unsubscribedAt,
      createdAt: statusSubscriptions.createdAt,
      displayName: principal.displayName,
      email: user.email,
    })
    .from(statusSubscriptions)
    .innerJoin(principal, eq(statusSubscriptions.principalId, principal.id))
    .leftJoin(user, eq(principal.userId, user.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(statusSubscriptions.createdAt))
    .limit(limit + 1)

  const hasMore = rows.length > limit
  const items = hasMore ? rows.slice(0, limit) : rows

  const result: StatusSubscriptionAdminRow[] = items.map((r) => ({
    id: r.id,
    principalId: r.principalId,
    displayName: r.displayName,
    email: r.email,
    scope: r.scope,
    componentIds: r.componentIds as StatusComponentId[],
    source: r.source,
    unsubscribedAt: r.unsubscribedAt,
    createdAt: r.createdAt,
  }))

  return {
    items: result,
    nextCursor: hasMore && items.length > 0 ? items[items.length - 1].id : null,
    hasMore,
  }
}

export async function getStatusSubscriptionCounts(): Promise<StatusSubscriptionCounts> {
  const rows = await db.query.statusSubscriptions.findMany({ columns: { unsubscribedAt: true } })
  const total = rows.length
  const active = rows.filter((r) => r.unsubscribedAt === null).length
  return { total, active, unsubscribed: total - active }
}

/** Admin "add a subscriber" by a single email. Matches an EXISTING account
 *  (case-insensitive) and subscribes the principal page-wide; never creates a
 *  portal account. 404s a clear message when no account matches the email.
 *  Someone who unsubscribed is skipped, not re-subscribed: returns
 *  `{ subscribed: false }`. */
export async function addStatusSubscriberByEmail(email: string): Promise<{ subscribed: boolean }> {
  const normalized = email.trim().toLowerCase()
  const matched = await db
    .select({ principalId: principal.id })
    .from(user)
    .innerJoin(principal, eq(principal.userId, user.id))
    .where(sql`lower(${user.email}) = ${normalized}`)
    .limit(1)

  const row = matched[0]
  if (!row) {
    throw new NotFoundError('STATUS_SUBSCRIBER_NOT_FOUND', 'No matching user for that email')
  }

  const limit = await subscriberLimit()

  return db.transaction(async (tx) => {
    const slots = await lockSubscriberSlots(tx, limit)
    return { subscribed: await subscribeUnlessOptedOut(tx, row.principalId, 'admin', slots) }
  })
}

/**
 * Admin CSV bulk import of subscriber emails. Mirrors
 * `importChangelogSubscribersFromEmails`: normalize + dedupe, match EXISTING
 * accounts by lower(email), skip (never create) unmatched, and upsert each
 * match page-wide with the `csv_import` source. A matched person who
 * unsubscribed is skipped too: an import never overrides an opt-out. Returns
 * the tallies so the UI can say what was skipped and why.
 */
export async function importStatusSubscribersFromEmails(
  emails: string[]
): Promise<StatusSubscriptionCsvImportResult> {
  const normalized = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))]
  if (normalized.length === 0) {
    return { imported: 0, skipped: 0, optedOut: 0, total: 0 }
  }

  // One transaction: a file that would take the workspace past its plan cap is
  // refused whole, so an admin never sees a partial import.
  const limit = await subscriberLimit()
  return db.transaction(async (tx) => {
    const slots = await lockSubscriberSlots(tx, limit)
    let imported = 0
    let optedOut = 0
    for (const email of normalized) {
      const matched = await tx
        .select({ principalId: principal.id })
        .from(user)
        .innerJoin(principal, eq(principal.userId, user.id))
        .where(sql`lower(${user.email}) = ${email}`)
        .limit(1)

      const row = matched[0]
      if (!row) continue

      if (await subscribeUnlessOptedOut(tx, row.principalId, 'csv_import', slots)) imported++
      else optedOut++
    }

    return {
      imported,
      skipped: normalized.length - imported - optedOut,
      optedOut,
      total: normalized.length,
    }
  })
}

/** Admin "remove" on one subscriber from the list. Sets the same opt-out
 *  `unsubscribe` sets and keeps the row, so the person's history and their own
 *  re-subscribe path are unchanged. Someone already opted out is left alone
 *  (their original opt-out time stays), and reports `{ removed: false }`. */
export async function removeStatusSubscriberByAdmin(
  principalId: PrincipalId
): Promise<{ removed: boolean }> {
  const state = await subscriptionState(db, principalId)
  if (!state.active) return { removed: false }
  await unsubscribe(principalId)
  log.info({ principal_id: principalId }, 'status subscriber removed by admin')
  return { removed: true }
}

/** Full unpaginated subscriber set for the admin CSV export — the same
 *  principal + user join the list read uses, minus the cursor/limit window. */
export async function listAllStatusSubscribersForExport(): Promise<StatusSubscriptionExportRow[]> {
  const rows = await db
    .select({
      scope: statusSubscriptions.scope,
      componentIds: statusSubscriptions.componentIds,
      source: statusSubscriptions.source,
      unsubscribedAt: statusSubscriptions.unsubscribedAt,
      createdAt: statusSubscriptions.createdAt,
      displayName: principal.displayName,
      email: user.email,
    })
    .from(statusSubscriptions)
    .innerJoin(principal, eq(statusSubscriptions.principalId, principal.id))
    .leftJoin(user, eq(principal.userId, user.id))
    .orderBy(desc(statusSubscriptions.createdAt))

  return rows.map((r) => ({
    displayName: r.displayName,
    email: r.email,
    scope: r.scope,
    componentCount: (r.componentIds as StatusComponentId[]).length,
    source: r.source,
    createdAt: r.createdAt,
    unsubscribedAt: r.unsubscribedAt,
  }))
}

/** Still-active subscriptions created since `date` (the overview's weekly delta). */
export async function countStatusSubscriptionsSince(date: Date): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(statusSubscriptions)
    .where(
      and(gte(statusSubscriptions.createdAt, date), isNull(statusSubscriptions.unsubscribedAt))
    )
  return row?.count ?? 0
}

/** Count-only variant of `getActiveSubscribersForComponents` — same pool,
 *  without materializing every principal id (the editor's "emailed ~N"
 *  marker only needs the number). */
export async function countActiveSubscribersForComponents(
  affectedComponentIds: StatusComponentId[]
): Promise<number> {
  const scopeFilter =
    affectedComponentIds.length === 0
      ? eq(statusSubscriptions.scope, 'page')
      : or(
          eq(statusSubscriptions.scope, 'page'),
          and(
            eq(statusSubscriptions.scope, 'components'),
            sql`
              EXISTS (
                SELECT 1 FROM jsonb_array_elements_text(${statusSubscriptions.componentIds}) cid
                WHERE cid = ANY(ARRAY[${sql.join(
                  affectedComponentIds.map((id) => sql`${id}`),
                  sql`, `
                )}]::text[])
              )
            `
          )
        )

  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(statusSubscriptions)
    .where(and(isNull(statusSubscriptions.unsubscribedAt), scopeFilter))
  return row?.count ?? 0
}

/** Principals actively subscribed to the whole page or to at least one of
 *  `affectedComponentIds` — the base pool events/targets.ts's
 *  `getStatusSubscriberTargets` should further gate by audience visibility. */
export async function getActiveSubscribersForComponents(
  affectedComponentIds: StatusComponentId[]
): Promise<PrincipalId[]> {
  const rows = await getActiveSubscriptionsForComponents(affectedComponentIds)
  return rows.map((r) => r.principalId)
}

/** The active subscriptions an incident affecting these components reaches,
 *  with what each one follows: the whole page, or the components it chose. */
export async function getActiveSubscriptionsForComponents(
  affectedComponentIds: StatusComponentId[]
): Promise<
  Array<{ principalId: PrincipalId; scope: StatusSubscriptionScope; componentIds: string[] }>
> {
  const columns = {
    principalId: statusSubscriptions.principalId,
    scope: statusSubscriptions.scope,
    componentIds: statusSubscriptions.componentIds,
  }
  if (affectedComponentIds.length === 0) {
    return db
      .select(columns)
      .from(statusSubscriptions)
      .where(and(isNull(statusSubscriptions.unsubscribedAt), eq(statusSubscriptions.scope, 'page')))
  }

  const componentOverlap = sql`
    EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(${statusSubscriptions.componentIds}) cid
      WHERE cid = ANY(ARRAY[${sql.join(
        affectedComponentIds.map((id) => sql`${id}`),
        sql`, `
      )}]::text[])
    )
  `

  return db
    .select(columns)
    .from(statusSubscriptions)
    .where(
      and(
        isNull(statusSubscriptions.unsubscribedAt),
        or(
          eq(statusSubscriptions.scope, 'page'),
          and(eq(statusSubscriptions.scope, 'components'), componentOverlap)
        )
      )
    )
}
