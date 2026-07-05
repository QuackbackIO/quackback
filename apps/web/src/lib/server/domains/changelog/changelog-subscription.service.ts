/**
 * Changelog subscriber pipeline (Changelog Settings §2, opt-out model).
 *
 * `changelog_subscriptions` is the dedicated subscriber source, additive to
 * the legacy linked-post subscribers (see `getChangelogSubscriberTargets` in
 * events/targets.ts, which unions both). This module owns every write to
 * that table: lazy auto-subscribe at the principal-touch seams, self-serve
 * subscribe/unsubscribe, admin CSV import, and status lookups for the
 * People-directory per-user toggle.
 */
import { db, eq, sql, changelogSubscriptions, principal, user } from '@/lib/server/db'
import type { PrincipalId } from '@quackback/ids'
import { logger } from '@/lib/server/logger'
import { getChangelogSettings } from '@/lib/server/domains/settings/settings.changelog'
import type {
  ChangelogSubscriptionSource,
  ChangelogSubscriptionStatus,
  ChangelogCsvImportResult,
} from './changelog-subscription.types'

const log = logger.child({ component: 'changelog-subscriptions' })

/**
 * Subscribe (or re-subscribe) a principal. Idempotent: a re-subscribe after
 * a prior unsubscribe clears `unsubscribedAt` but keeps the original
 * `source` (the provenance of how they first joined).
 */
async function upsertSubscription(
  principalId: PrincipalId,
  source: ChangelogSubscriptionSource
): Promise<void> {
  await db
    .insert(changelogSubscriptions)
    .values({ principalId, source })
    .onConflictDoUpdate({
      target: changelogSubscriptions.principalId,
      set: { unsubscribedAt: null },
    })
}

/**
 * Lazy auto-subscribe, called from the principal-touch seams (widget
 * identify, first portal account creation, conversation contact capture)
 * when `changelog.autoSubscribe` is on. A no-op once a row exists — even a
 * previously-unsubscribed principal is NOT re-subscribed by this path (only
 * an explicit self-serve/admin action clears an unsubscribe); it only fills
 * in principals with no subscription row at all.
 */
export async function ensureAutoSubscribed(principalId: PrincipalId): Promise<void> {
  const { autoSubscribe } = await getChangelogSettings()
  if (!autoSubscribe) return

  await db
    .insert(changelogSubscriptions)
    .values({ principalId, source: 'auto' })
    .onConflictDoNothing({ target: changelogSubscriptions.principalId })
}

/** Self-serve Subscribe button on the public changelog page. */
export async function subscribeSelfServe(principalId: PrincipalId): Promise<void> {
  log.debug({ principal_id: principalId }, 'self-serve changelog subscribe')
  await upsertSubscription(principalId, 'self_serve')
}

/** Admin manually subscribing a person from the People directory. */
export async function subscribeAdmin(principalId: PrincipalId): Promise<void> {
  log.debug({ principal_id: principalId }, 'admin changelog subscribe')
  await upsertSubscription(principalId, 'admin')
}

/** Soft opt-out — keeps the row (and its `source` provenance) for audit. */
export async function unsubscribeChangelog(principalId: PrincipalId): Promise<void> {
  log.debug({ principal_id: principalId }, 'changelog unsubscribe')
  await db
    .update(changelogSubscriptions)
    .set({ unsubscribedAt: new Date() })
    .where(eq(changelogSubscriptions.principalId, principalId))
}

export async function getChangelogSubscriptionStatus(
  principalId: PrincipalId
): Promise<ChangelogSubscriptionStatus> {
  const row = await db.query.changelogSubscriptions.findFirst({
    where: eq(changelogSubscriptions.principalId, principalId),
  })
  if (!row) {
    return { principalId, subscribed: false, source: null, unsubscribedAt: null }
  }
  return {
    principalId,
    subscribed: row.unsubscribedAt === null,
    source: row.source,
    unsubscribedAt: row.unsubscribedAt,
  }
}

/**
 * Admin CSV import of subscriber emails (Email header column). Only matches
 * EXISTING accounts by email — this pipeline subscribes people, it never
 * creates portal accounts from a spreadsheet. Case-insensitive match,
 * de-duplicated. Requires explicit admin consent (enforced at the caller —
 * the settings UI shows the consent-warning copy before this runs).
 */
export async function importChangelogSubscribersFromEmails(
  emails: string[]
): Promise<ChangelogCsvImportResult> {
  const normalized = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))]
  if (normalized.length === 0) {
    return { imported: 0, skipped: 0, total: 0 }
  }

  let imported = 0
  for (const email of normalized) {
    const matchedPrincipal = await db
      .select({ principalId: principal.id })
      .from(user)
      .innerJoin(principal, eq(principal.userId, user.id))
      .where(sql`lower(${user.email}) = ${email}`)
      .limit(1)

    const row = matchedPrincipal[0]
    if (!row) continue

    await upsertSubscription(row.principalId, 'csv_import')
    imported++
  }

  return { imported, skipped: normalized.length - imported, total: normalized.length }
}
