/**
 * The automatic check on domains that are being set up.
 *
 * A pending domain inside its check window is looked at every ten minutes, so
 * publishing the right records turns it live without anybody clicking. The
 * lookups are ours first: they are free, and they say whether anything in the
 * zone moved. The provider is asked only when something did, or when its last
 * answer is old enough (every third tick), which keeps a fleet of pending
 * domains well under the provider's management API rate.
 *
 * Per workspace and cheap when idle: one query against this workspace's own
 * table, which returns nothing for almost every workspace, and no lookups at
 * all on a server that cannot provision domains.
 */
import {
  and,
  asc,
  db,
  eq,
  gt,
  sql,
  emailSendingDomains,
  type SendingDomainDnsRecord,
} from '@/lib/server/db'
import { logger } from '@/lib/server/logger'
import { systemResolver } from '@/lib/server/dns/resolver'
import { checkRecords } from './record-check'
import { customSendingDomainsAvailable, refreshSendingDomain } from './sending-identity'

const log = logger.child({ component: 'sending-domain-watch' })

/**
 * How old the provider's answer may be before a tick asks again regardless.
 * Just under three ten-minute ticks, so scheduling jitter cannot skip one.
 */
export const PROVIDER_RECHECK_MS = 25 * 60 * 1000

/**
 * How long one tick may spend before it stops and leaves the remaining domains
 * for the next one. Domains least recently checked go first, so the ones left
 * over lead the next tick.
 */
export const WATCH_BUDGET_MS = 20_000

/** A check's meaning, without the time it was taken. */
function checkKey(r: SendingDomainDnsRecord): string {
  const c = r.check
  return `${r.type} ${r.host} ${r.value} ${c?.state ?? '-'} ${c?.seen ?? ''} ${c?.reason ?? ''}`
}

/** Whether any record's check says something different from before. */
export function checksChanged(
  before: SendingDomainDnsRecord[],
  after: SendingDomainDnsRecord[]
): boolean {
  if (before.length !== after.length) return true
  return before.some((r, i) => checkKey(r) !== checkKey(after[i]))
}

export async function watchSendingDomains(
  now: Date = new Date(),
  opts: { clock?: () => number } = {}
): Promise<{ watched: number; providerChecks: number }> {
  const clock = opts.clock ?? Date.now
  if (!customSendingDomainsAvailable()) return { watched: 0, providerChecks: 0 }

  const rows = await db
    .select()
    .from(emailSendingDomains)
    .where(
      and(eq(emailSendingDomains.status, 'pending'), gt(emailSendingDomains.autoCheckUntil, now))
    )
    .orderBy(sql`${emailSendingDomains.lastCheckedAt} ASC NULLS FIRST`, asc(emailSendingDomains.id))
  if (rows.length === 0) return { watched: 0, providerChecks: 0 }

  const started = clock()
  let watched = 0
  let providerChecks = 0
  for (const row of rows) {
    if (clock() - started >= WATCH_BUDGET_MS) {
      log.info({ left: rows.length - watched }, 'sending domain watch out of time; rest next tick')
      break
    }
    watched += 1
    try {
      const stored = row.dnsRecords ?? []
      const checked = await checkRecords(row.domain, stored, systemResolver, now)
      const due =
        !row.lastCheckedAt || now.getTime() - row.lastCheckedAt.getTime() >= PROVIDER_RECHECK_MS
      if (due || checksChanged(stored, checked)) {
        providerChecks += 1
        await refreshSendingDomain(row.id)
      } else {
        await db
          .update(emailSendingDomains)
          .set({ dnsRecords: checked, updatedAt: now })
          .where(eq(emailSendingDomains.id, row.id))
      }
    } catch (err) {
      // One domain's failure must not stop the others being watched.
      log.warn(
        { err, sending_domain_id: row.id, domain: row.domain },
        'sending domain watch failed'
      )
    }
  }
  return { watched, providerChecks }
}
