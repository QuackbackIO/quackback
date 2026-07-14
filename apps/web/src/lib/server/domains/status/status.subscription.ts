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
 *  unsubscribe but always applies the new scope/componentIds/source. */
export async function subscribe(
  principalId: PrincipalId,
  scope: StatusSubscriptionScope,
  componentIds: StatusComponentId[],
  source: StatusSubscriptionSource
): Promise<void> {
  log.debug({ principal_id: principalId, scope, source }, 'status subscribe')
  await db
    .insert(statusSubscriptions)
    .values({ principalId, scope, componentIds, source, unsubscribedAt: null })
    .onConflictDoUpdate({
      target: statusSubscriptions.principalId,
      set: { scope, componentIds, unsubscribedAt: null },
    })
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
 *  portal account. 404s a clear message when no account matches the email. */
export async function addStatusSubscriberByEmail(email: string): Promise<void> {
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

  await subscribe(row.principalId, 'page', [], 'admin')
}

/**
 * Admin CSV bulk import of subscriber emails. Mirrors
 * `importChangelogSubscribersFromEmails`: normalize + dedupe, match EXISTING
 * accounts by lower(email), skip (never create) unmatched, and upsert each
 * match page-wide with the `csv_import` source. Returns the imported/skipped
 * tallies so the UI can surface the skipped count.
 */
export async function importStatusSubscribersFromEmails(
  emails: string[]
): Promise<StatusSubscriptionCsvImportResult> {
  const normalized = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))]
  if (normalized.length === 0) {
    return { imported: 0, skipped: 0, total: 0 }
  }

  let imported = 0
  for (const email of normalized) {
    const matched = await db
      .select({ principalId: principal.id })
      .from(user)
      .innerJoin(principal, eq(principal.userId, user.id))
      .where(sql`lower(${user.email}) = ${email}`)
      .limit(1)

    const row = matched[0]
    if (!row) continue

    await subscribe(row.principalId, 'page', [], 'csv_import')
    imported++
  }

  return { imported, skipped: normalized.length - imported, total: normalized.length }
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
  if (affectedComponentIds.length === 0) {
    const pageRows = await db
      .select({ principalId: statusSubscriptions.principalId })
      .from(statusSubscriptions)
      .where(and(isNull(statusSubscriptions.unsubscribedAt), eq(statusSubscriptions.scope, 'page')))
    return pageRows.map((r) => r.principalId)
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

  const rows = await db
    .select({ principalId: statusSubscriptions.principalId })
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
  return rows.map((r) => r.principalId)
}
